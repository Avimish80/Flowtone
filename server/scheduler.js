import cron from 'node-cron';
import webpush from 'web-push';
import db from './db.js';

const VAPID_PUBLIC_KEY =
  'BJWmGOrJ5Uhw71uHgDI8DvOLGwLUYuENkni_a76qZHKzwDMMns67wk6kwU2TCvTK-sXbzn7RwgfozaBtbyPBN8I';
const VAPID_PRIVATE_KEY = 'MqrH8bD91pH_pYsgW0yfMZAqcw7VTpY9JiuWeZXBfRo';

webpush.setVapidDetails(
  'mailto:support@flowtone.app',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// ─── Prepared statements ─────────────────────────────────────────────
const getDuePushes = db.prepare(`
  SELECT * FROM scheduled_pushes
  WHERE sent = 0 AND fire_at <= ?
`);

const markSent = db.prepare(`
  UPDATE scheduled_pushes SET sent = 1 WHERE id = ?
`);

const deleteSubscription = db.prepare(`
  DELETE FROM push_subscriptions WHERE endpoint = ?
`);

const getSubscription = db.prepare(`
  SELECT * FROM push_subscriptions WHERE endpoint = ?
`);

// ─── Send a single scheduled push ───────────────────────────────────
async function sendScheduledPush(push) {
  const sub = getSubscription.get(push.endpoint);

  if (!sub) {
    // Subscription no longer exists — clean up the scheduled row
    markSent.run(push.id);
    console.warn(`[scheduler] Subscription not found for endpoint; marking sent. id=${push.id}`);
    return;
  }

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  };

  const payload = JSON.stringify({
    title: push.title,
    body: push.body,
    url: push.url ?? null,
    icon: push.icon ?? null,
    tag: push.tag ?? null,
    actions: push.actions ? JSON.parse(push.actions) : null,
  });

  try {
    await webpush.sendNotification(pushSubscription, payload);
    markSent.run(push.id);
    console.log(`[scheduler] Sent push id=${push.id} title="${push.title}"`);
  } catch (err) {
    const statusCode = err.statusCode ?? err.status;

    // 404 or 410 means the subscription has been unregistered by the browser
    if (statusCode === 404 || statusCode === 410) {
      console.warn(
        `[scheduler] Subscription expired/gone (${statusCode}); removing. endpoint=${push.endpoint}`
      );
      deleteSubscription.run(push.endpoint);
      markSent.run(push.id);
    } else {
      // Transient error — leave sent=0 so it retries next tick
      console.error(`[scheduler] Failed to send push id=${push.id}:`, err.message ?? err);
    }
  }
}

// ─── Cron job ────────────────────────────────────────────────────────
export function startScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    const nowTs = Math.floor(Date.now() / 1000);
    const duePushes = getDuePushes.all(nowTs);

    if (duePushes.length === 0) return;

    console.log(`[scheduler] Processing ${duePushes.length} due push(es)`);

    // Send in parallel; errors are handled per-push inside sendScheduledPush
    await Promise.allSettled(duePushes.map(sendScheduledPush));
  });

  console.log('[scheduler] Push notification scheduler started (every 5 minutes)');
}
