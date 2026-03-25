import cron from 'node-cron';
import webpush from 'web-push';
import { getDuePushes, markPushSent, getSubscription, deleteSubscription } from './db.js';

const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  'BJWmGOrJ5Uhw71uHgDI8DvOLGwLUYuENkni_a76qZHKzwDMMns67wk6kwU2TCvTK-sXbzn7RwgfozaBtbyPBN8I';
const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY || 'MqrH8bD91pH_pYsgW0yfMZAqcw7VTpY9JiuWeZXBfRo';
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || 'mailto:support@flowtone.app';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ─── Send a single scheduled push ───────────────────────────────────
async function sendScheduledPush(push) {
  const sub = getSubscription(push.endpoint);

  if (!sub) {
    markPushSent(push.id);
    console.warn(`[scheduler] Subscription not found; marking sent. id=${push.id}`);
    return;
  }

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  const payload = JSON.stringify({
    title: push.title,
    body: push.body,
    url: push.url ?? null,
    icon: push.icon ?? null,
    tag: push.tag ?? null,
    actions: push.actions ? JSON.parse(push.actions) : null,
    actionUrls: push.action_urls ? JSON.parse(push.action_urls) : null,
  });

  try {
    await webpush.sendNotification(pushSubscription, payload);
    markPushSent(push.id);
    console.log(`[scheduler] Sent push id=${push.id} title="${push.title}"`);
  } catch (err) {
    const statusCode = err.statusCode ?? err.status;

    if (statusCode === 404 || statusCode === 410) {
      console.warn(`[scheduler] Subscription expired (${statusCode}); removing. endpoint=${push.endpoint}`);
      deleteSubscription(push.endpoint);
      markPushSent(push.id);
    } else {
      console.error(`[scheduler] Failed to send push id=${push.id}:`, err.message ?? err);
    }
  }
}

// ─── Cron job ────────────────────────────────────────────────────────
export function startScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    const nowTs = Math.floor(Date.now() / 1000);
    const duePushes = getDuePushes(nowTs);

    if (duePushes.length === 0) return;

    console.log(`[scheduler] Processing ${duePushes.length} due push(es)`);
    await Promise.allSettled(duePushes.map(sendScheduledPush));
  });

  console.log('[scheduler] Push notification scheduler started (every 5 minutes)');
}
