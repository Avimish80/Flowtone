// Flowtone Push Notification Manager
// Handles SW registration, subscription, and server-side scheduling.

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const PUSH_SW = '/sw-push.js';
const VAPID_PUBLIC_KEY =
  'BJWmGOrJ5Uhw71uHgDI8DvOLGwLUYuENkni_a76qZHKzwDMMns67wk6kwU2TCvTK-sXbzn7RwgfozaBtbyPBN8I';

// ─── Helpers ────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/** Returns the active PushSubscription, or null if not subscribed. */
async function getActiveSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration(PUSH_SW);
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Parse a date string ("YYYY-MM-DD") + time string ("HH:MM" or "HH:MM:SS")
 * into a local Date object.
 */
function parseLocalDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (timeStr) {
    const [hour, minute] = timeStr.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Register the push service worker and subscribe the user to push notifications.
 * @param {string} notificationLevel - 'minimal' | 'standard' | 'full'
 * @returns {{ success: boolean, reason?: string }}
 */
export async function registerPush(notificationLevel = 'standard') {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { success: false, reason: 'not_supported' };
  }

  // Register (or re-use) the push-specific SW
  const reg = await navigator.serviceWorker.register(PUSH_SW, { scope: '/' });

  // Wait until the SW is active
  await navigator.serviceWorker.ready;

  // Request permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { success: false, reason: 'denied' };
  }

  // Subscribe
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  // Persist subscription on the server
  await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription,
      userAgent: navigator.userAgent,
      notificationLevel,
    }),
  });

  return { success: true };
}

/**
 * Unsubscribe the current device from push notifications.
 */
export async function unregisterPush() {
  const sub = await getActiveSubscription();
  if (!sub) return;

  // Notify the server so it can remove the endpoint
  try {
    await fetch(`${API_BASE}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    // Best-effort — still unsubscribe locally
  }

  await sub.unsubscribe();
}

/**
 * Send an immediate test push notification to verify the pipeline works.
 */
export async function sendTestPush() {
  const sub = await getActiveSubscription();
  if (!sub) return { success: false, reason: 'not_subscribed' };

  // Send immediately — bypasses the queue entirely
  try {
    const res = await fetch(`${API_BASE}/api/push/send-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        title: '🎵 GigFlow Notifications Working!',
        body: 'You will receive reminders for gigs, lessons and invoices.',
        url: '/',
        tag: `test-${Date.now()}`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { success: true };
    return { success: false, reason: data.error || 'server_error' };
  } catch {
    return { success: false, reason: 'network_error' };
  }
}

/**
 * Returns true if this device is currently subscribed to push notifications.
 */
export async function isPushActive() {
  const sub = await getActiveSubscription();
  return !!sub;
}

/**
 * Schedule server-side push notifications for all upcoming events (next 30 days).
 * Safe to call on every app load — the server deduplicates by tag.
 *
 * @param {Array}  events            - WorkEvent records from appClient
 * @param {Array}  _clients          - Client records (reserved for future use)
 * @param {string} notificationLevel - 'minimal' | 'standard' | 'full'
 */
export async function schedulePushNotifications(
  events = [],
  _clients = [],
  notificationLevel = 'standard'
) {
  const sub = await getActiveSubscription();
  if (!sub) return; // not subscribed — nothing to schedule

  const endpoint = sub.endpoint;
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const scheduled = [];

  for (const event of events) {
    if (!event.date) continue;

    const eventDate = parseLocalDateTime(event.date, null);
    if (!eventDate) continue;

    // Only look at events starting today through +30 days
    const eventMs = eventDate.getTime();
    if (eventMs < now - 24 * 60 * 60 * 1000) continue;
    if (eventMs > now + thirtyDaysMs) continue;

    // Use location_address (the actual field name in WorkEvent)
    const venue = event.location_address || event.venue || event.location || '';

    // ── ALL LEVELS: "Leave now" alert (fires 90 min before start) ──
    if (event.start_time) {
      const startDt = parseLocalDateTime(event.date, event.start_time);
      if (startDt) {
        const leaveAt = new Date(startDt.getTime() - 90 * 60 * 1000);
        if (leaveAt.getTime() > now) {
          scheduled.push({
            endpoint,
            fireAt: leaveAt.toISOString(),
            tag: `leave-${event.id}`,
            title: `Leave soon for ${event.title}`,
            body: `Head to ${venue} to arrive on time`,
            url: `/?page=WorkEventDetail&id=${event.id}`,
          });
        }
      }
    }

    // ── STANDARD + FULL: Day-before reminder ───────────────────────
    if (notificationLevel === 'standard' || notificationLevel === 'full') {
      const dayBefore = new Date(eventDate.getTime() - 24 * 60 * 60 * 1000);
      dayBefore.setHours(9, 0, 0, 0);
      if (dayBefore.getTime() > now) {
        scheduled.push({
          endpoint,
          fireAt: dayBefore.toISOString(),
          tag: `tomorrow-${event.id}`,
          title: `Gig tomorrow: ${event.title}`,
          body: `${event.start_time || 'Check time'} at ${venue || 'venue TBC'}`,
          url: `/?page=WorkEventDetail&id=${event.id}`,
        });
      }
    }

    // ── ALL LEVELS: Post-gig invoice check ─────────────────────────
    if (event.invoice_sent !== true) {
      const dayAfter = new Date(eventDate.getTime() + 24 * 60 * 60 * 1000);
      dayAfter.setHours(9, 0, 0, 0);
      if (dayAfter.getTime() > now) {
        scheduled.push({
          endpoint,
          fireAt: dayAfter.toISOString(),
          tag: `invoice-${event.id}`,
          title: `Send invoice for ${event.title}?`,
          body: `Don't forget to invoice your client`,
          url: `/?page=WorkEvents`,
        });
      }
    }
  }

  // Fire-and-forget scheduling requests in parallel
  await Promise.allSettled(
    scheduled.map((payload) =>
      fetch(`${API_BASE}/api/push/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    )
  );
}
