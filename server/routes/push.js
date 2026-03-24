import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db.js';

const router = Router();

const VAPID_PUBLIC_KEY =
  'BJWmGOrJ5Uhw71uHgDI8DvOLGwLUYuENkni_a76qZHKzwDMMns67wk6kwU2TCvTK-sXbzn7RwgfozaBtbyPBN8I';

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

    const upsert = db.prepare(`
      INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, notification_level)
      VALUES (@endpoint, @p256dh, @auth, @user_agent, @notification_level)
      ON CONFLICT(endpoint) DO UPDATE SET
        p256dh             = excluded.p256dh,
        auth               = excluded.auth,
        user_agent         = excluded.user_agent,
        notification_level = excluded.notification_level
    `);

    upsert.run({
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
// Body: { endpoint, fireAt (ISO string), title, body, url?, tag?, icon?, actions? }
router.post('/schedule', (req, res) => {
  try {
    const { endpoint, fireAt, title, body, url, tag, icon, actions } = req.body;

    if (!endpoint || !fireAt || !title || !body) {
      return res.status(400).json({ error: 'endpoint, fireAt, title, and body are required' });
    }

    const fireAtTs = Math.floor(new Date(fireAt).getTime() / 1000);
    if (isNaN(fireAtTs)) {
      return res.status(400).json({ error: 'fireAt must be a valid ISO date string' });
    }

    // Deduplicate by tag + endpoint — remove any unsent rows with same tag+endpoint
    if (tag) {
      db.prepare(`
        DELETE FROM scheduled_pushes
        WHERE tag = ? AND endpoint = ? AND sent = 0
      `).run(tag, endpoint);
    }

    const id = randomUUID();

    db.prepare(`
      INSERT INTO scheduled_pushes (id, endpoint, fire_at, title, body, url, icon, actions, tag)
      VALUES (@id, @endpoint, @fire_at, @title, @body, @url, @icon, @actions, @tag)
    `).run({
      id,
      endpoint,
      fire_at: fireAtTs,
      title,
      body,
      url: url ?? null,
      icon: icon ?? null,
      actions: actions ? JSON.stringify(actions) : null,
      tag: tag ?? null,
    });

    res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error('[push/schedule error]', err);
    res.status(500).json({ error: 'Failed to schedule push notification' });
  }
});

// ─── DELETE /api/push/subscription ──────────────────────────────────
// Body: { endpoint }
router.delete('/subscription', (req, res) => {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint is required' });
    }

    const result = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[push/delete subscription error]', err);
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

export default router;
