import { Router } from 'express';
import { requireAuthenticatedUser } from '../lib/auth.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import {
  CALENDAR_SCOPE,
  exchangeCodeForTokens,
  fetchAccountEmail,
  ensureFlowtoneCalendar,
  getFreshAccessToken,
  deleteEvent,
  FLOWTONE_CALENDAR_SUMMARY,
} from '../lib/googleCalendar.js';
import { runSyncForUser } from '../lib/calendarSync.js';

const router = Router();
const CREDS_TABLE = 'google_calendar_credentials';

const REDIRECT_URI =
  process.env.GOOGLE_CALENDAR_REDIRECT_URI || 'http://localhost:3001/api/calendar/callback';

// ─── GET /api/calendar/auth-url ─────────────────────────────────────────────
// Authenticated: we embed the user id in `state` so the (unauthenticated) Google
// callback knows which account to store the token for.
router.get('/auth-url', requireAuthenticatedUser, (req, res) => {
  const origin = req.query.origin || '';
  const state = Buffer.from(JSON.stringify({ origin, uid: req.flowtoneUser.id })).toString('base64url');

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: `${CALENDAR_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token every time
    state,
  });

  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
});

// ─── GET /api/calendar/callback ─────────────────────────────────────────────
// Google redirects here (no Bearer token). User id comes from signed-in `state`.
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  let origin = '';
  let uid = '';
  try {
    const decoded = JSON.parse(Buffer.from(state || '', 'base64url').toString('utf8'));
    origin = decoded.origin || '';
    uid = decoded.uid || '';
  } catch {
    return res.status(400).send('Invalid state');
  }
  if (!origin || !uid) return res.status(400).send('Missing state');

  try {
    const tokens = await exchangeCodeForTokens(code, REDIRECT_URI);
    const email = await fetchAccountEmail(tokens.access_token);
    const calendarId = await ensureFlowtoneCalendar(tokens.access_token, '');

    const db = getSupabaseAdmin();
    await db.from(CREDS_TABLE).upsert(
      {
        user_id: uid,
        refresh_token: tokens.refresh_token || '',
        access_token: tokens.access_token,
        token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
        connected_email: email,
        calendar_id: calendarId,
        sync_enabled: true,
      },
      { onConflict: 'user_id' }
    );

    return res.redirect(`${origin}/AppSettings#calendar=connected`);
  } catch (err) {
    console.error('[calendar/callback]', err);
    return res.redirect(`${origin}/AppSettings#calendar=error`);
  }
});

// ─── POST /api/calendar/sync ────────────────────────────────────────────────
router.post('/sync', requireAuthenticatedUser, async (req, res) => {
  try {
    const result = await runSyncForUser(req.flowtoneUser.id);
    res.json(result);
  } catch (err) {
    console.error('[calendar/sync]', err);
    res.status(500).json({ error: err.message || 'Sync failed' });
  }
});

// ─── POST /api/calendar/delete-event ────────────────────────────────────────
// Remove a single event from Google immediately. Called by the client when the
// user deletes a gig in Flowtone, so a delete is a real delete (the sync engine
// can't push a deletion after the local row is already gone). Best-effort: a
// missing event or a disconnected calendar is treated as success.
router.post('/delete-event', requireAuthenticatedUser, async (req, res) => {
  try {
    const googleId = req.body?.google_calendar_event_id;
    if (!googleId || String(googleId).startsWith('local-')) {
      return res.json({ ok: true, skipped: true });
    }
    const db = getSupabaseAdmin();
    const { data: creds } = await db
      .from(CREDS_TABLE).select('*').eq('user_id', req.flowtoneUser.id).maybeSingle();
    if (!creds || !creds.refresh_token) return res.json({ ok: true, skipped: true });

    const token = await getFreshAccessToken(creds);
    const calendarId = await ensureFlowtoneCalendar(token.accessToken, creds.calendar_id);
    try {
      await deleteEvent(token.accessToken, calendarId, googleId);
    } catch (err) {
      // Already gone on Google's side → fine.
      if (err.statusCode !== 404 && err.statusCode !== 410) throw err;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[calendar/delete-event]', err);
    res.status(500).json({ error: err.message || 'Failed to delete event' });
  }
});

// ─── GET /api/calendar/status ───────────────────────────────────────────────
// Never returns tokens — only display state.
router.get('/status', requireAuthenticatedUser, async (req, res) => {
  try {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from(CREDS_TABLE)
      .select('connected_email, sync_enabled, last_synced_at, refresh_token')
      .eq('user_id', req.flowtoneUser.id)
      .maybeSingle();

    if (!data || !data.refresh_token) {
      return res.json({ connected: false });
    }
    res.json({
      connected: true,
      email: data.connected_email,
      sync_enabled: data.sync_enabled,
      last_synced_at: data.last_synced_at,
      calendar_summary: FLOWTONE_CALENDAR_SUMMARY,
    });
  } catch (err) {
    console.error('[calendar/status]', err);
    res.status(500).json({ error: 'Failed to read calendar status' });
  }
});

// ─── POST /api/calendar/toggle ──────────────────────────────────────────────
router.post('/toggle', requireAuthenticatedUser, async (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    const db = getSupabaseAdmin();
    await db.from(CREDS_TABLE).update({ sync_enabled: enabled }).eq('user_id', req.flowtoneUser.id);
    res.json({ ok: true, sync_enabled: enabled });
  } catch (err) {
    console.error('[calendar/toggle]', err);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// ─── POST /api/calendar/disconnect ──────────────────────────────────────────
router.post('/disconnect', requireAuthenticatedUser, async (req, res) => {
  try {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from(CREDS_TABLE).select('refresh_token').eq('user_id', req.flowtoneUser.id).maybeSingle();

    // Best-effort revoke at Google so the grant is fully released.
    if (data?.refresh_token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(data.refresh_token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).catch(() => {});
    }

    await db.from(CREDS_TABLE).delete().eq('user_id', req.flowtoneUser.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[calendar/disconnect]', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

export default router;
