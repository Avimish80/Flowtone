import { Router } from 'express';
import { randomUUID } from 'crypto';
import webpush from 'web-push';
import {
  upsertSubscription,
  getSubscription,
  deleteSubscription,
  insertScheduledPush,
  deleteUnsentByTagAndEndpoint,
  getDuePushes,
  markPushSent,
} from '../db.js';

const router = Router();

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@flowtone.app';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('[push] VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set as environment variables');
} else {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ─── GET /api/push/vapid-public-key ─────────────────────────────────
router.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ─── POST /api/push/subscribe ────────────────────────────────────────
// Body: { subscription: { endpoint, keys: { p256dh, auth } }, userAgent?, notificationLevel? }
router.post('/subscribe', (req, res) => {
  try {
    const { subscription, userAgent, notificationLevel } = req.body;

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'Missing required subscription fields' });
    }

    upsertSubscription({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: userAgent ?? null,
      notification_level: notificationLevel ?? 'standard',
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[push/subscribe error]', err);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// ─── POST /api/push/schedule ─────────────────────────────────────────
// Body: { endpoint, fireAt (ISO string), title, body, url?, tag?, icon?, actions?, actionUrls? }
router.post('/schedule', (req, res) => {
  try {
    const { endpoint, fireAt, title, body, url, tag, icon, actions, actionUrls } = req.body;

    if (!endpoint || !fireAt || !title || !body) {
      return res.status(400).json({ error: 'endpoint, fireAt, title, and body are required' });
    }

    const fire_at = Math.floor(new Date(fireAt).getTime() / 1000);
    if (isNaN(fire_at)) {
      return res.status(400).json({ error: 'fireAt must be a valid ISO date string' });
    }

    // Deduplicate by tag + endpoint
    if (tag) {
      deleteUnsentByTagAndEndpoint(tag, endpoint);
    }

    const id = randomUUID();

    insertScheduledPush({
      id,
      endpoint,
      fire_at,
      title,
      body,
      url: url ?? null,
      icon: icon ?? null,
      actions: actions ? JSON.stringify(actions) : null,
      action_urls: actionUrls ? JSON.stringify(actionUrls) : null,
      tag: tag ?? null,
    });

    res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error('[push/schedule error]', err);
    res.status(500).json({ error: 'Failed to schedule push notification' });
  }
});

// ─── DELETE /api/push/subscription  (or POST /api/push/unsubscribe) ─
// Body: { endpoint }
function handleUnsubscribe(req, res) {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint is required' });
    }

    deleteSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    console.error('[push/unsubscribe error]', err);
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
}

router.delete('/subscription', handleUnsubscribe);
router.post('/unsubscribe', handleUnsubscribe);

// ─── POST /api/push/send-now ─────────────────────────────────────────
// Immediately sends a push to an endpoint — bypasses the queue entirely.
// Body: { endpoint, title, body, url?, tag? }
router.post('/send-now', async (req, res) => {
  try {
    const { endpoint, title, body, url, tag } = req.body;
    if (!endpoint || !title || !body) {
      return res.status(400).json({ error: 'endpoint, title, and body are required' });
    }

    const sub = getSubscription(endpoint);
    if (!sub) {
      return res.status(404).json({ error: 'Subscription not found. Please re-enable notifications in Settings.' });
    }

    const pushSubscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    const payload = JSON.stringify({ title, body, url: url ?? '/', tag: tag ?? 'test', icon: '/icon-192x192.svg' });

    await webpush.sendNotification(pushSubscription, payload);
    res.json({ ok: true, message: 'Push sent immediately' });
  } catch (err) {
    console.error('[push/send-now error]', err);
    res.status(500).json({ error: err.message || 'Failed to send push', statusCode: err.statusCode });
  }
});

// ─── GET /api/push/debug ─────────────────────────────────────────────
// Dev-only: returns counts of subscriptions and pending pushes.
// Disabled in production unless DEBUG_TOKEN env var is set.
router.get('/debug', (req, res) => {
  const debugToken = process.env.DEBUG_TOKEN;
  if (process.env.NODE_ENV === 'production' && !debugToken) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (debugToken && req.headers['x-debug-token'] !== debugToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const nowTs = Math.floor(Date.now() / 1000);
    const duePushes = getDuePushes(nowTs);
    res.json({
      duePushes: duePushes.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
