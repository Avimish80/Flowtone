// "Link iPhone calendar": imports events from chosen device calendars into
// Flowtone as WorkEvents, then keeps them in step on every app open.
//
// Identity: each imported event carries device_event_key (iPhone event id, plus
// the occurrence date for recurring series, whose occurrences share one id).
// Re-linking or re-syncing never duplicates. An existing Flowtone event at the
// same date/time with the same title (e.g. one pulled from Google Calendar) is
// linked instead of copied.
//
// The link (calendars, start date, AI check, keys already reviewed) lives in
// localStorage: calendar ids are specific to this phone.
import { format, addYears, subDays } from "date-fns";
import { appClient } from "@/api/appClient";
import { flowtoneJson } from "@/lib/flowtoneApi";
import { isNativeApp, listDeviceEvents } from "@/lib/nativeDevice";
import { authStorageKey, isPreviewModeEnabled } from "@/lib/supabaseClient";

const LINK_KEY = "flowtone_device_calendar_link";
const FUTURE_YEARS = 1;

// The link (and its "already reviewed" keys) belongs to one account: a phone
// that switches between phone-only mode, the local stack and production, or
// between accounts, must not inherit another's reviewed keys. Account ids are
// unique per database, so the id alone tells them apart; the database's
// address is left out so the same account reached at a new address (the Mac
// over Tailscale instead of Wi-Fi) keeps its link.
function currentUserId() {
  try { return JSON.parse(localStorage.getItem(authStorageKey()))?.user?.id || null; } catch { return null; }
}

function linkStorageKey() {
  if (isPreviewModeEnabled()) return `${LINK_KEY}:preview`;
  return `${LINK_KEY}:user:${currentUserId() || "anon"}`;
}

export function getCalendarLink() {
  try {
    const key = linkStorageKey();
    let raw = localStorage.getItem(key);
    const userId = currentUserId();
    if (userId && !isPreviewModeEnabled()) {
      // Links saved before 27 Oct 2026 were keyed "<prefix>:<database url>:<user id>".
      // Carry the most recently synced one over (unless this account already
      // has a link), then drop them all so an Unlink stays unlinked.
      const old = Object.keys(localStorage).filter((k) => k.startsWith(`${LINK_KEY}:`) && k !== key && k.endsWith(`:${userId}`));
      if (old.length) {
        if (!raw) {
          const synced = (k) => { try { return JSON.parse(localStorage.getItem(k))?.lastSyncAt || ""; } catch { return ""; } };
          raw = localStorage.getItem(old.sort((a, b) => synced(b).localeCompare(synced(a)))[0]);
          localStorage.setItem(key, raw);
        }
        old.forEach((k) => localStorage.removeItem(k));
      }
    }
    return JSON.parse(raw) || null;
  } catch { return null; }
}

function saveCalendarLink(link) {
  try { localStorage.setItem(linkStorageKey(), JSON.stringify(link)); } catch { /* storage full/blocked */ }
}

export function unlinkCalendars() {
  try { localStorage.removeItem(linkStorageKey()); } catch { /* ignore */ }
}

function eventKey(e) {
  return e.is_recurring ? `${e.id}@${e.date}` : e.id;
}

function normTitle(t) {
  return String(t || "").toLowerCase().replace(/^cancelled:\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function guessEventType(title) {
  const t = String(title || "").toLowerCase();
  if (/\b(lesson|student|tuition|teaching|class)\b/.test(t)) return "Lesson";
  if (/\brehears/.test(t)) return "Rehearsal";
  if (/\b(session|studio|recording|record)\b/.test(t)) return "Session";
  return "Gig";
}

// Fields to write when an already-linked event changes on the phone. A blank
// calendar location never erases one added in Flowtone (e.g. a venue filled in
// later); the calendar only wins when it actually has a value.
function changedCalendarFields(device, existing) {
  const f = calendarFields(device);
  if (!f.location_address) delete f.location_address;
  return Object.fromEntries(Object.entries(f).filter(([k, v]) => (existing[k] || "") !== (v || "")));
}

// Device event -> WorkEvent fields owned by the calendar (never fee/client).
function calendarFields(e) {
  return {
    title: e.title || "(untitled)",
    date: e.date,
    start_time: e.start_time,
    end_time: e.end_time,
    location_address: e.location,
  };
}

// EventKit caps a single query span, so read the range a year at a time.
async function readDeviceRange(from, to, calendarIds) {
  const wanted = new Set(calendarIds);
  const out = [];
  let cursor = from;
  while (cursor < to) {
    const chunkEnd = addYears(cursor, 1) < to ? addYears(cursor, 1) : to;
    const chunk = await listDeviceEvents(cursor, chunkEnd);
    out.push(...chunk.filter((e) => wanted.has(e.calendar_id)));
    cursor = chunkEnd;
  }
  // A multi-day event can appear in two chunks; keep one.
  const seen = new Set();
  return out.filter((e) => {
    const k = eventKey(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Builds the import plan without writing anything. Each row:
 * { key, device, action: "new"|"update"|"link"|"same"|"duplicate", existing, event_type }
 * ("duplicate" = the gig is already in Flowtone via another linked calendar;
 * nothing is written for it.)
 */
export async function buildImportPlan({ calendarIds, fromDate }) {
  const from = new Date(fromDate + "T00:00:00");
  const to = addYears(new Date(), FUTURE_YEARS);
  const [deviceEvents, workEvents] = await Promise.all([
    readDeviceRange(from, to, calendarIds),
    appClient.entities.WorkEvent.list(),
  ]);

  const byKey = new Map(workEvents.filter((w) => w.device_event_key).map((w) => [w.device_event_key, w]));
  // Same gig = same date + same title; times only count when both sides have
  // one (an all-day entry and a timed entry of the same gig are one gig).
  const bySlot = new Map();
  for (const w of workEvents) {
    const slot = `${w.date}|${normTitle(w.title)}`;
    bySlot.set(slot, [...(bySlot.get(slot) || []), w]);
  }
  const findSame = (device) =>
    (bySlot.get(`${device.date}|${normTitle(device.title)}`) || []).find(
      (w) => !w.start_time || !device.start_time || w.start_time === device.start_time
    );

  return deviceEvents.map((device) => {
    const key = eventKey(device);
    const linked = byKey.get(key);
    if (linked) {
      const changes = changedCalendarFields(device, linked);
      const changed = Object.keys(changes).length > 0;
      return { key, device, existing: linked, action: changed ? "update" : "same", changes, event_type: linked.event_type };
    }
    const dup = findSame(device);
    // Already linked to another calendar's copy of this gig: keep that link,
    // just don't import a second copy.
    if (dup?.device_event_key) return { key, device, existing: dup, action: "duplicate", event_type: dup.event_type };
    if (dup) return { key, device, existing: dup, action: "link", event_type: dup.event_type };
    return { key, device, existing: null, action: "new", event_type: guessEventType(device.title) };
  });
}

/** Optional AI pass: marks which "new" rows look like personal entries. */
export async function classifyWithAI(rows) {
  const candidates = rows.filter((r) => r.action === "new");
  const verdicts = new Map();
  for (let i = 0; i < candidates.length; i += 150) {
    const batch = candidates.slice(i, i + 150);
    const { results = [] } = await flowtoneJson("/api/ai/classify-calendar-events", {
      method: "POST",
      timeoutMs: 60000,
      body: JSON.stringify({
        events: batch.map((r, j) => ({ i: j, title: r.device.title, date: r.device.date, start_time: r.device.start_time, location: r.device.location })),
      }),
    });
    for (const res of results) {
      const row = batch[res.i];
      if (row) verdicts.set(row.key, res);
    }
  }
  return rows.map((r) => {
    const v = verdicts.get(r.key);
    return v ? { ...r, ai_work: v.work, event_type: v.work ? v.event_type : r.event_type } : r;
  });
}

async function defaultCurrency() {
  try {
    const [settings] = await appClient.entities.AppSettings.list();
    return settings?.default_currency || settings?.currency || "GBP";
  } catch {
    return "GBP";
  }
}

/** Writes the selected rows. Returns counts by outcome. */
export async function applyImportPlan(rows) {
  const today = format(new Date(), "yyyy-MM-dd");
  const currency = await defaultCurrency();
  const counts = { created: 0, updated: 0, linked: 0 };
  for (const r of rows) {
    const f = calendarFields(r.device);
    if (r.action === "new") {
      await appClient.entities.WorkEvent.create({
        ...f,
        event_type: r.event_type || "Gig",
        status: r.device.date < today ? "completed" : "confirmed",
        currency,
        notes: r.device.notes || "",
        device_event_key: r.key,
        device_calendar_id: r.device.calendar_id,
        created_from_device: true,
      });
      counts.created++;
    } else if (r.action === "update") {
      await appClient.entities.WorkEvent.update(r.existing.id, r.changes);
      counts.updated++;
    } else if (r.action === "link") {
      await appClient.entities.WorkEvent.update(r.existing.id, {
        device_event_key: r.key,
        device_calendar_id: r.device.calendar_id,
      });
      counts.linked++;
    }
  }
  return counts;
}

/**
 * Saves the link after the first import. reviewedKeys = every row the user saw
 * (imported or unticked), so auto-sync never re-offers what they skipped.
 */
export function saveLinkAfterImport({ calendarIds, fromDate, aiCheck, reviewedKeys }) {
  saveCalendarLink({
    calendarIds,
    fromDate,
    aiCheck: !!aiCheck,
    linkedAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString(),
    seenKeys: reviewedKeys,
  });
}

let syncing = null;

/**
 * Called on app open: pulls new events from linked calendars and applies
 * time/title/location changes to already-linked ones. Looks back 60 days for
 * late edits; anything older was settled by the first import.
 */
export function syncLinkedCalendars() {
  if (syncing) return syncing;
  syncing = (async () => {
    const link = getCalendarLink();
    if (!isNativeApp() || !link?.calendarIds?.length) return null;
    const recent = format(subDays(new Date(), 60), "yyyy-MM-dd");
    const fromDate = link.fromDate > recent ? link.fromDate : recent;
    let rows = await buildImportPlan({ calendarIds: link.calendarIds, fromDate });
    const seen = new Set(link.seenKeys || []);
    rows = rows.filter((r) => r.action === "update" || r.action === "link" || (r.action === "new" && !seen.has(r.key)));
    const offeredKeys = rows.map((r) => r.key);
    if (link.aiCheck && rows.some((r) => r.action === "new")) {
      try { rows = await classifyWithAI(rows); } catch { /* AI down: import everything new */ }
      rows = rows.filter((r) => r.ai_work !== false);
    }
    const counts = await applyImportPlan(rows);
    const fresh = getCalendarLink() || link;
    saveCalendarLink({
      ...fresh,
      lastSyncAt: new Date().toISOString(),
      seenKeys: [...new Set([...(fresh.seenKeys || []), ...offeredKeys])],
    });
    return counts;
  })().finally(() => { syncing = null; });
  return syncing;
}
