// Calendar sync engine — provider-agnostic core.
//
// runSyncForUser(userId) is called from the HTTP route today (on app-open and the
// "Sync now" button) and will be called by the cron scheduler in Phase 2 with NO
// changes here. All Google specifics live in googleCalendar.js behind a small
// interface, so Apple/Outlook providers can replace it later.

import { getSupabaseAdmin } from './supabaseAdmin.js';
import {
  getFreshAccessToken,
  ensureFlowtoneCalendar,
  insertEvent,
  patchEvent,
  deleteEvent,
  listChanges,
  SYNC_TIME_ZONE,
} from './googleCalendar.js';

const CREDS_TABLE = 'google_calendar_credentials';

// ─── Pure mappers (exported for unit tests) ─────────────────────────────────

/** Add whole hours to an "HH:MM" string, returning "HH:MM" (may exceed 24). */
function addHours(timeStr, hours) {
  const [h, m] = timeStr.split(':').map(Number);
  return `${String(h + hours).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Next calendar day for a YYYY-MM-DD string (all-day end dates are exclusive). */
function nextDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function mapStatusToGoogle(status) {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'lead') return 'tentative';
  return 'confirmed'; // confirmed | completed
}

function mapStatusFromGoogle(googleStatus) {
  if (googleStatus === 'cancelled') return 'cancelled';
  if (googleStatus === 'tentative') return 'lead';
  return 'confirmed';
}

/**
 * Flowtone work_event row → Google event body.
 * Handles timed and all-day events, and gigs that end after midnight.
 */
export function workEventToGcal(event) {
  const body = {
    summary: event.title || '(untitled gig)',
    status: mapStatusToGoogle(event.status),
    extendedProperties: { private: { flowtoneId: event.id } },
  };
  if (event.location_address) body.location = event.location_address;

  const descParts = [];
  if (event.event_type) descParts.push(`Type: ${event.event_type}`);
  const fee = event.total_price || event.base_price;
  if (fee) descParts.push(`Fee: ${event.currency || 'GBP'} ${fee}`);
  if (event.notes) descParts.push(event.notes);
  if (descParts.length) body.description = descParts.join('\n');

  if (event.start_time) {
    const startDt = `${event.date}T${event.start_time}:00`;
    let endDate = event.date;
    let endTime = event.end_time || addHours(event.start_time, event.event_type === 'Lesson' ? 1 : 2);
    // End on or before start → the gig runs past midnight; roll the end to next day.
    if (event.end_time && event.end_time <= event.start_time) {
      endDate = nextDay(event.date);
    } else if (Number(endTime.split(':')[0]) >= 24) {
      endDate = nextDay(event.date);
      endTime = `${String(Number(endTime.split(':')[0]) - 24).padStart(2, '0')}:${endTime.split(':')[1]}`;
    }
    body.start = { dateTime: startDt, timeZone: SYNC_TIME_ZONE };
    body.end = { dateTime: `${endDate}T${endTime}:00`, timeZone: SYNC_TIME_ZONE };
  } else {
    body.start = { date: event.date };
    body.end = { date: nextDay(event.date) };
  }
  return body;
}

/** Parse a Google ISO dateTime into Europe/London wall-clock {date, time}. */
function isoToLondonParts(iso) {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: SYNC_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour; // some envs emit 24 for midnight
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` };
}

/**
 * Google event → Flowtone work_event field patch (snake_case columns).
 * Does not decide create-vs-update or notes policy — the engine applies that.
 */
export function gcalToWorkEvent(gevent) {
  const patch = {
    title: gevent.summary || '(untitled gig)',
    status: mapStatusFromGoogle(gevent.status),
    location_address: gevent.location || '',
    google_calendar_event_id: gevent.id,
  };
  if (gevent.start?.dateTime) {
    const s = isoToLondonParts(gevent.start.dateTime);
    patch.date = s.date;
    patch.start_time = s.time;
    patch.end_time = gevent.end?.dateTime ? isoToLondonParts(gevent.end.dateTime).time : '';
  } else if (gevent.start?.date) {
    patch.date = gevent.start.date;
    patch.start_time = '';
    patch.end_time = '';
  }
  return patch;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

function realGoogleId(event) {
  const id = event.google_calendar_event_id;
  // Ignore the legacy "local-gcal-*" sentinel the old stub wrote.
  return id && !id.startsWith('local-') ? id : null;
}

const ms = (v) => (v ? new Date(v).getTime() : 0);

/**
 * Run a full two-way sync for one user. Idempotent: safe to call repeatedly.
 * @returns {Promise<{skipped?: boolean, reason?: string, pushed: number, pulled: number, last_synced_at: string}>}
 */
export async function runSyncForUser(userId) {
  const db = getSupabaseAdmin();

  const { data: creds, error: credErr } = await db
    .from(CREDS_TABLE).select('*').eq('user_id', userId).maybeSingle();
  if (credErr) throw credErr;
  if (!creds || !creds.refresh_token) return { skipped: true, reason: 'not_connected', pushed: 0, pulled: 0 };
  if (!creds.sync_enabled) return { skipped: true, reason: 'sync_disabled', pushed: 0, pulled: 0 };

  // 1. Fresh token + ensure the dedicated calendar exists.
  const token = await getFreshAccessToken(creds);
  const credUpdate = {};
  if (token.changed) {
    credUpdate.access_token = token.accessToken;
    credUpdate.token_expires_at = token.expiresAt;
  }
  const calendarId = await ensureFlowtoneCalendar(token.accessToken, creds.calendar_id);
  if (calendarId !== creds.calendar_id) credUpdate.calendar_id = calendarId;

  // 2. PULL remote delta first (so push can defer to a newer remote version).
  let remote = await listChanges(token.accessToken, calendarId, creds.sync_token || null);
  if (remote.fullResyncRequired) {
    remote = await listChanges(token.accessToken, calendarId, null);
  }
  const remoteById = new Map();
  for (const ge of remote.events) remoteById.set(ge.id, ge);

  // 3. Load this user's events.
  const { data: events, error: evErr } = await db
    .from('work_events').select('*').eq('user_id', userId);
  if (evErr) throw evErr;

  const lastSync = ms(creds.last_synced_at);
  const pushedGoogleIds = new Set();
  let pushed = 0;
  let pulled = 0;

  // 4. PUSH local changes.
  for (const event of events) {
    if (!event.date) continue; // not calendarable
    const gid = realGoogleId(event);
    const localChanged = !creds.last_synced_at || ms(event.updated_at) > lastSync;

    // Brand-new local event → insert.
    if (!gid) {
      if (event.status === 'cancelled') continue; // nothing to create
      const created = await insertEvent(token.accessToken, calendarId, workEventToGcal(event));
      await db.from('work_events').update({ google_calendar_event_id: created.id }).eq('id', event.id);
      pushedGoogleIds.add(created.id);
      pushed++;
      continue;
    }

    const rem = remoteById.get(gid);
    // Remote is newer → let the pull phase apply it; don't overwrite.
    if (rem && ms(rem.updated) > ms(event.updated_at)) continue;
    if (!localChanged) continue;

    if (event.status === 'cancelled') {
      await deleteEvent(token.accessToken, calendarId, gid);
      pushedGoogleIds.add(gid);
      pushed++;
      continue;
    }

    try {
      await patchEvent(token.accessToken, calendarId, gid, workEventToGcal(event));
      pushedGoogleIds.add(gid);
      pushed++;
    } catch (err) {
      // Event was deleted on Google's side → reflect that locally.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.from('work_events').update({ status: 'cancelled' }).eq('id', event.id);
      } else {
        throw err;
      }
    }
  }

  // 5. APPLY remote changes that we didn't just push.
  const byGoogleId = new Map(events.map(e => [realGoogleId(e), e]).filter(([k]) => k));
  const byFlowtoneId = new Map(events.map(e => [e.id, e]));

  for (const ge of remote.events) {
    if (pushedGoogleIds.has(ge.id)) continue;
    const flowtoneId = ge.extendedProperties?.private?.flowtoneId;
    const local = byGoogleId.get(ge.id) || (flowtoneId ? byFlowtoneId.get(flowtoneId) : null);

    if (ge.status === 'cancelled') {
      if (local && local.status !== 'cancelled') {
        await db.from('work_events').update({ status: 'cancelled' }).eq('id', local.id);
        pulled++;
      }
      continue;
    }

    const patch = gcalToWorkEvent(ge);

    if (local) {
      // Last-writer-wins: only apply if the remote edit is newer.
      if (ms(ge.updated) > ms(local.updated_at)) {
        await db.from('work_events').update(patch).eq('id', local.id);
        pulled++;
      }
    } else {
      // A gig the user created directly in the Flowtone Gigs calendar.
      const { data: createdRows } = await db.from('work_events').insert({
        user_id: userId,
        event_type: 'Gig',
        currency: 'GBP',
        ...patch,
      }).select('id').limit(1);
      const newId = createdRows?.[0]?.id;
      // Stamp the Google event with our id so future syncs match cleanly.
      if (newId) {
        await patchEvent(token.accessToken, calendarId, ge.id, {
          extendedProperties: { private: { flowtoneId: newId } },
        }).catch(() => {});
      }
      pulled++;
    }
  }

  // 6. Persist sync cursor + timestamp (stamped LAST so applied pulls aren't
  //    seen as local changes on the next run).
  const nowIso = new Date().toISOString();
  credUpdate.last_synced_at = nowIso;
  if (remote.nextSyncToken) credUpdate.sync_token = remote.nextSyncToken;
  await db.from(CREDS_TABLE).update(credUpdate).eq('user_id', userId);

  return { pushed, pulled, last_synced_at: nowIso };
}
