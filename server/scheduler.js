import cron from 'node-cron';
import webpush from 'web-push';
import {
  getDuePushes,
  markPushSent,
  markPushDropped,
  pruneHandledBefore,
  getSubscription,
  deleteSubscription,
} from './db.js';
import { syncAllConnectedUsers } from './lib/calendarSync.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@flowtone.app';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.error('[scheduler] VAPID keys not set — push delivery will be disabled');
}

// A push more than this late (Mac asleep, server down) is dropped rather than
// sent: a "leave now" two hours after the gig started only does harm. Ticks
// run every 5 minutes, so normal lateness stays well inside this.
export const STALE_AFTER_SECONDS = 10 * 60;
// Handled pushes are kept a week for debugging, then pruned.
const KEEP_HANDLED_SECONDS = 7 * 24 * 60 * 60;

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

/** One queue tick: send what is due, drop what is stale, prune old history. */
export async function processDuePushes(nowTs = Math.floor(Date.now() / 1000), send = sendScheduledPush) {
  const duePushes = getDuePushes(nowTs);
  const stale = duePushes.filter((p) => p.fire_at < nowTs - STALE_AFTER_SECONDS);
  const fresh = duePushes.filter((p) => p.fire_at >= nowTs - STALE_AFTER_SECONDS);

  for (const push of stale) markPushDropped(push.id);
  if (stale.length) {
    console.warn(`[scheduler] Dropped ${stale.length} stale push(es) (more than ${STALE_AFTER_SECONDS / 60} min late)`);
  }

  if (fresh.length) {
    console.log(`[scheduler] Processing ${fresh.length} due push(es)`);
    await Promise.allSettled(fresh.map(send));
  }

  pruneHandledBefore(nowTs - KEEP_HANDLED_SECONDS);
  return { sent: fresh.length, dropped: stale.length };
}

// ─── Cron job ────────────────────────────────────────────────────────
export function startScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    await processDuePushes();
  });

  console.log('[scheduler] Push notification scheduler started (every 5 minutes)');

  // ─── Background calendar sync (every 5 minutes) ────────────────────
  // Keeps every connected calendar current even when no app is open.
  // An in-flight guard prevents overlapping ticks if a batch runs long.
  let calendarSyncRunning = false;
  cron.schedule('*/5 * * * *', async () => {
    if (calendarSyncRunning) {
      console.warn('[scheduler] Calendar sync still running; skipping this tick');
      return;
    }
    calendarSyncRunning = true;
    try {
      const res = await syncAllConnectedUsers();
      if (res.users) {
        console.log(`[scheduler] Calendar sync: ${res.ok}/${res.users} ok, ${res.failed} failed`);
      }
    } catch (err) {
      console.error('[scheduler] Calendar sync tick failed:', err.message ?? err);
    } finally {
      calendarSyncRunning = false;
    }
  });

  console.log('[scheduler] Calendar sync scheduler started (every 5 minutes)');
}
