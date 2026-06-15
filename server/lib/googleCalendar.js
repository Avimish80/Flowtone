// Google Calendar provider — thin wrapper over the Calendar REST API v3.
//
// This is the only file that talks to Google. The sync engine (calendarSync.js)
// depends on this shape (ensureCalendar / upsertEvent / deleteEvent / listChanges)
// so a different provider (Apple CalDAV, Outlook Graph) can be slotted in later.
//
// Scope used: https://www.googleapis.com/auth/calendar.app.created
//   — lets us create + manage calendars WE create, and nothing else the user owns.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const FLOWTONE_CALENDAR_SUMMARY = 'Flow Gigs';
export const SYNC_TIME_ZONE = 'Europe/London';

/**
 * Exchange an OAuth authorization code for tokens.
 * @returns {Promise<{access_token, refresh_token, expires_in}>}
 */
export async function exchangeCodeForTokens(code, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || 'Token exchange failed');
  }
  return data;
}

/**
 * Return a valid access token for the given credentials row, refreshing if
 * it's missing or within 60s of expiry. The caller persists `changed` tokens.
 * @param {{access_token, refresh_token, token_expires_at}} creds
 * @returns {Promise<{accessToken: string, expiresAt: string|null, changed: boolean}>}
 */
export async function getFreshAccessToken(creds) {
  const expMs = creds.token_expires_at ? new Date(creds.token_expires_at).getTime() : 0;
  const stillValid = creds.access_token && expMs && expMs - Date.now() > 60_000;
  if (stillValid) {
    return { accessToken: creds.access_token, expiresAt: creds.token_expires_at, changed: false };
  }

  if (!creds.refresh_token) {
    throw new Error('No refresh token — calendar needs to be reconnected.');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || 'Token refresh failed');
  }

  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  return { accessToken: data.access_token, expiresAt, changed: true };
}

/** Look up the email of the connected Google account (for display only). */
export async function fetchAccountEmail(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    return data.email || '';
  } catch {
    return '';
  }
}

// ─── Internal: authed JSON call with a clear error ──────────────────────────
async function googleApi(accessToken, path, { method = 'GET', body, query } = {}) {
  const url = new URL(`${CAL_BASE}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function parseOrThrow(res, context) {
  if (res.status === 204) return null; // DELETE returns no content
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || res.statusText;
    const err = new Error(`Google Calendar ${context} failed (${res.status}): ${msg}`);
    err.statusCode = res.status;
    throw err;
  }
  return data;
}

/**
 * Find-or-create the dedicated "Flowtone Gigs" calendar.
 * If `existingId` still resolves, reuse it; otherwise create a fresh one.
 * @returns {Promise<string>} calendarId
 */
export async function ensureFlowtoneCalendar(accessToken, existingId) {
  if (existingId) {
    const res = await googleApi(accessToken, `/calendars/${encodeURIComponent(existingId)}`);
    if (res.ok) return existingId;
    // 404/410 → calendar was deleted; fall through and recreate.
  }
  const created = await parseOrThrow(
    await googleApi(accessToken, '/calendars', {
      method: 'POST',
      body: { summary: FLOWTONE_CALENDAR_SUMMARY, timeZone: SYNC_TIME_ZONE },
    }),
    'create calendar'
  );
  return created.id;
}

export async function insertEvent(accessToken, calendarId, eventBody) {
  return parseOrThrow(
    await googleApi(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: eventBody,
    }),
    'insert event'
  );
}

export async function patchEvent(accessToken, calendarId, eventId, eventBody) {
  return parseOrThrow(
    await googleApi(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: eventBody,
    }),
    'patch event'
  );
}

/** Delete is idempotent: a 404/410 (already gone) is treated as success. */
export async function deleteEvent(accessToken, calendarId, eventId) {
  const res = await googleApi(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
  if (res.ok || res.status === 404 || res.status === 410) return true;
  return parseOrThrow(res, 'delete event');
}

/**
 * Incremental list of changes on the calendar.
 * Pass the stored syncToken for a delta; omit it for an initial sync.
 * A 410 GONE means the syncToken expired → caller must do a full resync.
 *
 * @returns {Promise<{events: object[], nextSyncToken: string|null, fullResyncRequired?: true}>}
 */
export async function listChanges(accessToken, calendarId, syncToken) {
  const events = [];
  let pageToken = null;
  let nextSyncToken = null;

  do {
    // The SAME query params must be used across initial + incremental syncs,
    // so singleEvents/showDeleted are always present and timeMin is only used
    // for the initial (no-syncToken) pull.
    const query = {
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: '250',
      pageToken: pageToken || undefined,
    };
    if (syncToken) {
      query.syncToken = syncToken;
    } else {
      // Initial sync: bound history so we don't drag in years of old gigs.
      query.timeMin = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    }

    const res = await googleApi(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, { query });
    if (res.status === 410) return { events: [], nextSyncToken: null, fullResyncRequired: true };

    const data = await parseOrThrow(res, 'list events');
    if (Array.isArray(data.items)) events.push(...data.items);
    pageToken = data.nextPageToken || null;
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken };
}
