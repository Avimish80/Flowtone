// GigFlow Push Notification Manager
// Handles SW registration, subscription, scheduling — 5-layer notification system.

import { getEffectivePrefs, timingToMinutes } from './notificationPrefs.js';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const VAPID_PUBLIC_KEY =
  'BJWmGOrJ5Uhw71uHgDI8DvOLGwLUYuENkni_a76qZHKzwDMMns67wk6kwU2TCvTK-sXbzn7RwgfozaBtbyPBN8I';

// ─── Helpers ────────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function getActiveSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Parse "YYYY-MM-DD" + optional "HH:MM" into a local Date */
function parseLocal(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (timeStr) {
    const [h, min] = timeStr.split(':').map(Number);
    return new Date(y, m - 1, d, h, min, 0, 0);
  }
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Schedule a push via the server. Deduplicates by tag. */
async function schedule(payload) {
  await fetch(`${API_BASE}/api/push/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Currency formatter */
function fmt(amount, currency = 'GBP') {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** fmtTime: "18:30" → "18:30" (keep 24h for international musicians) */
function fmtTime(t) {
  return t || '';
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function registerPush(notificationLevel = 'standard') {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { success: false, reason: 'not_supported' };
  }
  const reg = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { success: false, reason: 'denied' };

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription, userAgent: navigator.userAgent, notificationLevel }),
  });

  return { success: true };
}

export async function unregisterPush() {
  const sub = await getActiveSubscription();
  if (!sub) return;
  try {
    await fetch(`${API_BASE}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch { /* best-effort */ }
  await sub.unsubscribe();
}

export async function reRegisterSubscription(notificationLevel = 'standard') {
  const sub = await getActiveSubscription();
  if (!sub) return;
  try {
    await fetch(`${API_BASE}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub, userAgent: navigator.userAgent, notificationLevel }),
    });
  } catch { /* silent */ }
}

export async function sendTestPush() {
  const sub = await getActiveSubscription();
  if (!sub) return { success: false, reason: 'not_subscribed' };
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
    return res.ok ? { success: true } : { success: false, reason: data.error || 'server_error' };
  } catch {
    return { success: false, reason: 'network_error' };
  }
}

export async function isPushActive() {
  const sub = await getActiveSubscription();
  return !!sub;
}

// ─── Main scheduler ─────────────────────────────────────────────────────────

/**
 * Schedule all push notifications for the next 30 days.
 *
 * @param {Array}  events    — WorkEvent records
 * @param {Array}  clients   — Client records
 * @param {Array}  documents — Document records (invoices/estimates)
 * @param {Object} settings  — AppSettings record { notification_level, notification_prefs, default_currency }
 */
export async function schedulePushNotifications(
  events = [],
  clients = [],
  documents = [],
  settings = {}
) {
  const sub = await getActiveSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  const now = Date.now();
  const nowTs = Math.floor(now / 1000);
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const level = settings.notification_level || 'standard';
  const prefs = getEffectivePrefs(level, settings.notification_prefs || {});
  const currency = settings.default_currency || 'GBP';

  const clientMap = Object.fromEntries((clients || []).map(c => [c.id, c]));

  // Helper to only schedule if fireAt is in the future
  const push = (p) => {
    const fireTs = Math.floor(new Date(p.fireAt).getTime() / 1000);
    if (fireTs <= nowTs) return null; // already past
    if (fireTs > nowTs + thirtyDaysMs / 1000) return null; // beyond 30-day window
    return schedule({ endpoint, ...p });
  };

  const tasks = [];

  // ── Filter to upcoming/recent events ───────────────────────────────────────
  const gigEvents = events.filter(e => {
    if (!e.date || e.status === 'cancelled') return false;
    const eMs = parseLocal(e.date)?.getTime();
    if (!eMs) return false;
    return eMs >= now - 2 * 24 * 60 * 60 * 1000 && eMs <= now + thirtyDaysMs;
  });

  const nonPracticeGigs = gigEvents.filter(e => e.event_type !== 'Practice');
  const practiceEvents  = gigEvents.filter(e => e.event_type === 'Practice');

  // Invoice map: work_event_id → sent invoice (for "invoice not sent" checks)
  const sentInvoiceByEvent = {};
  for (const doc of documents) {
    if (doc.document_type === 'invoice' && doc.work_event_id && doc.status === 'sent') {
      sentInvoiceByEvent[doc.work_event_id] = doc;
    }
  }
  const allInvoices = documents.filter(d => d.document_type === 'invoice');

  // ── LAYER 1: Gig Execution ─────────────────────────────────────────────────

  // ── L1a: Day-before reminder ────────────────────────────────────────────
  if (prefs.gig_day_before?.enabled) {
    const timing = prefs.gig_day_before.timing || 'day_9am';
    for (const event of nonPracticeGigs) {
      const startDt = parseLocal(event.date, event.start_time);
      if (!startDt || startDt.getTime() < now) continue; // past
      const venue = event.location_address || '';
      const client = clientMap[event.client_id];

      let fireAt;
      if (timing === '2days_9am') {
        fireAt = new Date(parseLocal(event.date).getTime() - 2 * 24 * 60 * 60 * 1000);
        fireAt.setHours(9, 0, 0, 0);
      } else if (timing === 'day_6pm') {
        fireAt = new Date(parseLocal(event.date).getTime() - 24 * 60 * 60 * 1000);
        fireAt.setHours(18, 0, 0, 0);
      } else {
        fireAt = new Date(parseLocal(event.date).getTime() - 24 * 60 * 60 * 1000);
        fireAt.setHours(9, 0, 0, 0);
      }

      const actions = [{ action: 'open_gig', title: 'Open Gig' }];
      const actionUrls = { open_gig: `/WorkEventDetail?id=${event.id}` };
      if (venue) {
        actions.push({ action: 'navigate', title: '🗺️ Route' });
        actionUrls.navigate = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venue)}&travelmode=driving`;
      }
      if (client?.phone) {
        actions.push({ action: 'contact', title: '📞 Call' });
        actionUrls.contact = `tel:${client.phone}`;
      }

      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `day-before-${event.id}`,
        title: `${event.event_type || 'Gig'} tomorrow: ${event.title}`,
        body: `${event.start_time ? fmtTime(event.start_time) + ' · ' : ''}${venue || 'Check details'}`,
        url: `/WorkEventDetail?id=${event.id}`,
        actions,
        actionUrls,
      }));
    }
  }

  // ── L1b: Day-of morning summary ─────────────────────────────────────────
  if (prefs.gig_day_of_summary?.enabled) {
    // Group events by date
    const byDate = {};
    for (const event of nonPracticeGigs) {
      if (!event.date) continue;
      const startDt = parseLocal(event.date);
      if (startDt.getTime() < now - 24 * 60 * 60 * 1000) continue;
      byDate[event.date] = byDate[event.date] || [];
      byDate[event.date].push(event);
    }
    for (const [dateStr, dayEvents] of Object.entries(byDate)) {
      const fireAt = parseLocal(dateStr);
      fireAt.setHours(8, 0, 0, 0);
      const sorted = [...dayEvents].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
      const first = sorted[0];
      const body = dayEvents.length === 1
        ? `${first.title}${first.start_time ? ' at ' + fmtTime(first.start_time) : ''}`
        : `${dayEvents.length} events · next: ${first.title}${first.start_time ? ' at ' + fmtTime(first.start_time) : ''}`;
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `day-summary-${dateStr}`,
        title: `Today's schedule`,
        body,
        url: '/CalendarView',
        actions: [{ action: 'open_cal', title: 'Open Calendar' }],
        actionUrls: { open_cal: '/CalendarView' },
      }));
    }
  }

  // ── L1c: Load-in / call time ────────────────────────────────────────────
  if (prefs.gig_load_in?.enabled) {
    const mins = timingToMinutes(prefs.gig_load_in.timing || '60min');
    for (const event of nonPracticeGigs) {
      if (!event.start_time) continue;
      const startDt = parseLocal(event.date, event.start_time);
      if (!startDt) continue;
      const fireAt = new Date(startDt.getTime() - mins * 60 * 1000);
      const venue = event.location_address || '';
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `load-in-${event.id}`,
        title: `Call time in ${mins >= 60 ? `${mins / 60}h` : `${mins} min`}: ${event.title}`,
        body: venue ? `📍 ${venue}` : 'Check parking and venue notes',
        url: `/WorkEventDetail?id=${event.id}`,
        actions: [{ action: 'open_gig', title: 'Open Gig' }],
        actionUrls: { open_gig: `/WorkEventDetail?id=${event.id}` },
      }));
    }
  }

  // ── L1d: Leave now ──────────────────────────────────────────────────────
  if (prefs.gig_leave_now?.enabled) {
    const mins = timingToMinutes(prefs.gig_leave_now.timing || '90min');
    for (const event of nonPracticeGigs) {
      if (!event.start_time) continue;
      const venue = event.location_address || '';
      if (!venue) continue; // leave now only useful if we have a destination
      const isLesson = (event.event_type || '').toLowerCase().includes('lesson');
      if (isLesson) continue; // lessons usually at-home, skip leave alert
      const startDt = parseLocal(event.date, event.start_time);
      if (!startDt) continue;
      const fireAt = new Date(startDt.getTime() - mins * 60 * 1000);
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `leave-${event.id}`,
        title: `🚗 Leave soon for ${event.title}`,
        body: `Head to ${venue} now to arrive by ${fmtTime(event.start_time)}`,
        url: `/WorkEventDetail?id=${event.id}`,
        actions: [
          { action: 'navigate', title: '🗺️ Navigate' },
          { action: 'open_gig', title: 'Open Gig' },
        ],
        actionUrls: {
          navigate: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venue)}&travelmode=driving`,
          open_gig: `/WorkEventDetail?id=${event.id}`,
        },
      }));
    }
  }

  // ── L1e: Starting soon ──────────────────────────────────────────────────
  if (prefs.gig_starting_soon?.enabled) {
    const mins = timingToMinutes(prefs.gig_starting_soon.timing || '30min');
    for (const event of gigEvents) { // all types including lessons/practice
      if (!event.start_time) continue;
      const startDt = parseLocal(event.date, event.start_time);
      if (!startDt) continue;
      const fireAt = new Date(startDt.getTime() - mins * 60 * 1000);
      const venue = event.location_address || '';
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `soon-${event.id}`,
        title: `Starting in ${mins} min: ${event.title}`,
        body: venue ? `📍 ${venue}` : `${event.event_type || 'Event'} at ${fmtTime(event.start_time)}`,
        url: `/WorkEventDetail?id=${event.id}`,
        actions: [{ action: 'open_gig', title: 'Open' }],
        actionUrls: { open_gig: `/WorkEventDetail?id=${event.id}` },
      }));
    }
  }

  // ── LAYER 2: Finance ───────────────────────────────────────────────────────

  // ── L2a: Invoice not sent (day after event) ─────────────────────────────
  if (prefs.invoice_not_sent?.enabled) {
    // Build map of event_id → draft invoice (auto-created from estimate)
    const draftInvoiceByEvent = {};
    for (const doc of documents) {
      if (doc.document_type === 'invoice' && doc.work_event_id && doc.status === 'draft') {
        draftInvoiceByEvent[doc.work_event_id] = doc;
      }
    }
    for (const event of nonPracticeGigs) {
      if (sentInvoiceByEvent[event.id]) continue; // already sent
      const eventDt = parseLocal(event.date);
      if (!eventDt || eventDt.getTime() > now) continue; // future events — wait until after
      const fireAt = new Date(eventDt.getTime() + 24 * 60 * 60 * 1000);
      fireAt.setHours(9, 0, 0, 0);
      const draftInv = draftInvoiceByEvent[event.id];
      const url = draftInv
        ? `/DocumentDetail?id=${draftInv.id}`
        : `/WorkEventDetail?id=${event.id}`;
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `invoice-due-${event.id}`,
        title: `Send invoice for ${event.title}?`,
        body: draftInv
          ? `Invoice ready — tap to review and send`
          : `You played yesterday — create and send the invoice`,
        url,
        actions: [
          { action: 'open_invoice', title: draftInv ? 'Review Invoice' : 'Create Invoice' },
        ],
        actionUrls: { open_invoice: url },
      }));
    }
  }

  // ── L2b: Invoice due soon ───────────────────────────────────────────────
  if (prefs.invoice_due_soon?.enabled) {
    const daysBefore = prefs.invoice_due_soon.days_before ?? 2;
    for (const inv of allInvoices) {
      if (inv.status !== 'sent' || !inv.due_date) continue;
      const dueDt = parseLocal(inv.due_date);
      if (!dueDt) continue;
      const fireAt = new Date(dueDt.getTime() - daysBefore * 24 * 60 * 60 * 1000);
      fireAt.setHours(9, 0, 0, 0);
      const daysLabel = daysBefore === 1 ? 'tomorrow' : `in ${daysBefore} days`;
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `inv-due-soon-${inv.id}`,
        title: `Invoice due ${daysLabel}`,
        body: `${inv.title || inv.document_number || 'Invoice'} · ${fmt(inv.total, currency)}`,
        url: `/DocumentDetail?id=${inv.id}`,
        actions: [{ action: 'open_invoice', title: 'Open Invoice' }],
        actionUrls: { open_invoice: `/DocumentDetail?id=${inv.id}` },
      }));
    }
  }

  // ── L2c: Overdue invoice ────────────────────────────────────────────────
  if (prefs.invoice_overdue?.enabled) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    for (const inv of allInvoices) {
      if (inv.status !== 'sent' || !inv.due_date) continue;
      const dueDt = parseLocal(inv.due_date);
      if (!dueDt || dueDt.getTime() >= todayStart.getTime()) continue; // not yet overdue
      const daysOver = Math.floor((todayStart.getTime() - dueDt.getTime()) / (24 * 60 * 60 * 1000));
      // Fire at 9am today (or tomorrow if 9am already passed)
      const fireAt = new Date();
      fireAt.setHours(9, 0, 0, 0);
      if (fireAt.getTime() <= now) fireAt.setDate(fireAt.getDate() + 1);
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `inv-overdue-${inv.id}`,
        title: `Overdue invoice: ${inv.title || inv.document_number}`,
        body: `Overdue by ${daysOver} day${daysOver !== 1 ? 's' : ''} · ${fmt(inv.total, currency)}`,
        url: `/DocumentDetail?id=${inv.id}`,
        actions: [{ action: 'open_invoice', title: 'Open Invoice' }],
        actionUrls: { open_invoice: `/DocumentDetail?id=${inv.id}` },
      }));
    }
  }

  // ── L2d: Weekly unpaid summary ──────────────────────────────────────────
  if (prefs.invoice_weekly_summary?.enabled) {
    const unpaid = allInvoices.filter(i => i.status === 'sent');
    if (unpaid.length > 0) {
      const totalUnpaid = unpaid.reduce((s, i) => s + (i.total || 0), 0);
      // Next Monday at 8am
      const nextMon = new Date();
      const day = nextMon.getDay();
      const daysToMon = day === 0 ? 1 : 8 - day;
      nextMon.setDate(nextMon.getDate() + daysToMon);
      nextMon.setHours(8, 0, 0, 0);
      const unpaidUrl = unpaid.length === 1
        ? `/DocumentDetail?id=${unpaid[0].id}`
        : '/Finance?filter=sent';
      tasks.push(push({
        fireAt: nextMon.toISOString(),
        tag: `weekly-unpaid-${nextMon.toISOString().slice(0, 10)}`,
        title: `${fmt(totalUnpaid, currency)} unpaid`,
        body: `${unpaid.length} invoice${unpaid.length !== 1 ? 's' : ''} waiting to be paid`,
        url: unpaidUrl,
        actions: [{ action: 'open_finance', title: 'Open Finance' }],
        actionUrls: { open_finance: unpaidUrl },
      }));
    }
  }

  // ── LAYER 3: Admin ─────────────────────────────────────────────────────────

  // ── L3a: Missing venue warning ──────────────────────────────────────────
  if (prefs.missing_venue?.enabled) {
    for (const event of nonPracticeGigs) {
      if (event.location_address) continue; // has venue
      const startDt = parseLocal(event.date);
      if (!startDt) continue;
      const daysUntil = Math.floor((startDt.getTime() - now) / (24 * 60 * 60 * 1000));
      if (daysUntil > 7 || daysUntil < 0) continue;
      const fireAt = new Date(startDt.getTime() - 2 * 24 * 60 * 60 * 1000);
      fireAt.setHours(9, 0, 0, 0);
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `missing-venue-${event.id}`,
        title: `Missing venue: ${event.title}`,
        body: `This gig is in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} — no address saved yet`,
        url: `/WorkEventDetail?id=${event.id}`,
        actions: [{ action: 'open_gig', title: 'Add Address' }],
        actionUrls: { open_gig: `/WorkEventDetail?id=${event.id}` },
      }));
    }
  }

  // ── L3b: Unconfirmed follow-up ──────────────────────────────────────────
  if (prefs.unconfirmed_followup?.enabled) {
    for (const event of nonPracticeGigs) {
      if (event.status !== 'lead') continue;
      const startDt = parseLocal(event.date);
      if (!startDt) continue;
      const daysUntil = Math.floor((startDt.getTime() - now) / (24 * 60 * 60 * 1000));
      if (daysUntil < 3 || daysUntil > 14) continue; // only nudge 3–14 days out
      const fireAt = new Date();
      fireAt.setDate(fireAt.getDate() + 1);
      fireAt.setHours(9, 0, 0, 0);
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `unconfirmed-${event.id}`,
        title: `Still tentative: ${event.title}`,
        body: `${daysUntil} days away — is this confirmed yet?`,
        url: `/WorkEventDetail?id=${event.id}`,
        actions: [{ action: 'open_gig', title: 'Review' }],
        actionUrls: { open_gig: `/WorkEventDetail?id=${event.id}` },
      }));
    }
  }

  // ── L3c: Risk alert ─────────────────────────────────────────────────────
  if (prefs.risk_alert?.enabled) {
    for (const event of nonPracticeGigs) {
      const startDt = parseLocal(event.date);
      if (!startDt) continue;
      const daysUntil = Math.floor((startDt.getTime() - now) / (24 * 60 * 60 * 1000));
      if (daysUntil < 1 || daysUntil > 7) continue;

      const issues = [];
      if (!event.location_address) issues.push('no venue');
      if (event.status === 'lead') issues.push('not confirmed');
      if (!sentInvoiceByEvent[event.id] && !allInvoices.find(d => d.work_event_id === event.id)) {
        issues.push('no invoice');
      }
      if (issues.length < 2) continue; // only alert if 2+ issues

      const fireAt = new Date(startDt.getTime() - 3 * 24 * 60 * 60 * 1000);
      fireAt.setHours(9, 0, 0, 0);
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `risk-${event.id}`,
        title: `⚠️ ${event.title} — action needed`,
        body: `${daysUntil} days away: ${issues.join(', ')}`,
        url: `/WorkEventDetail?id=${event.id}`,
        actions: [{ action: 'open_gig', title: 'Open Gig' }],
        actionUrls: { open_gig: `/WorkEventDetail?id=${event.id}` },
      }));
    }
  }

  // ── LAYER 4: Practice ──────────────────────────────────────────────────────

  // ── L4a: Practice session reminder ─────────────────────────────────────
  if (prefs.practice_reminder?.enabled) {
    const mins = timingToMinutes(prefs.practice_reminder.timing || '30min');
    for (const event of practiceEvents) {
      if (!event.start_time) continue;
      const startDt = parseLocal(event.date, event.start_time);
      if (!startDt) continue;
      const fireAt = new Date(startDt.getTime() - mins * 60 * 1000);
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `practice-soon-${event.id}`,
        title: `Practice session in ${mins} min`,
        body: event.practice_plan || event.title || 'Time to practice',
        url: '/Practice',
        actions: [{ action: 'open_practice', title: 'Open Practice' }],
        actionUrls: { open_practice: '/Practice' },
      }));
    }
  }

  // ── L4b: Goal deadline ──────────────────────────────────────────────────
  // (goals passed via events array won't work — goal_deadline uses a separate entity)
  // We skip this here; it's handled in AppSettings/Layout where goals are loaded separately.

  // ── LAYER 5: Smart Assistant ───────────────────────────────────────────────

  // ── L5a: Daily briefing (7am tomorrow) ─────────────────────────────────
  if (prefs.daily_briefing?.enabled) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    const tomorrowEvents = nonPracticeGigs.filter(e => e.date === tomorrowStr);
    if (tomorrowEvents.length > 0) {
      const sorted = [...tomorrowEvents].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
      const first = sorted[0];
      const unpaidCount = allInvoices.filter(i => i.status === 'sent').length;

      const fireAt = new Date(tomorrow);
      fireAt.setHours(7, 0, 0, 0);

      let body = `${tomorrowEvents.length} gig${tomorrowEvents.length !== 1 ? 's' : ''}`;
      if (first.start_time) body += ` · first at ${fmtTime(first.start_time)}`;
      if (unpaidCount > 0) body += ` · ${unpaidCount} unpaid invoice${unpaidCount !== 1 ? 's' : ''}`;

      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `daily-brief-${tomorrowStr}`,
        title: `Tomorrow: ${first.title}`,
        body,
        url: '/Dashboard',
        actions: [{ action: 'open_dash', title: 'Open Dashboard' }],
        actionUrls: { open_dash: '/Dashboard' },
      }));
    }
  }

  // ── L5b: Weekly digest (next Monday 8am) ───────────────────────────────
  if (prefs.weekly_digest?.enabled) {
    const nextMon = new Date();
    const day = nextMon.getDay();
    const daysToMon = day === 0 ? 1 : 8 - day;
    nextMon.setDate(nextMon.getDate() + daysToMon);
    nextMon.setHours(8, 0, 0, 0);

    // This week's events (Mon–Sun of current week)
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() === 0 ? 6 : weekStart.getDay() - 1));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const weekGigs = nonPracticeGigs.filter(e => {
      const d = parseLocal(e.date);
      return d && d >= weekStart && d < weekEnd;
    });

    const sentThisWeek = allInvoices.filter(i => {
      if (!i.sent_at && !i.updated_at) return false;
      const d = new Date(i.sent_at || i.updated_at);
      return d >= weekStart && d < weekEnd && i.status === 'sent';
    });
    const invoicedTotal = sentThisWeek.reduce((s, i) => s + (i.total || 0), 0);
    const overdueTotal = allInvoices
      .filter(i => i.status === 'sent' && i.due_date && parseLocal(i.due_date) < new Date())
      .reduce((s, i) => s + (i.total || 0), 0);

    if (weekGigs.length > 0 || invoicedTotal > 0 || overdueTotal > 0) {
      const parts = [];
      if (weekGigs.length > 0) parts.push(`${weekGigs.length} gig${weekGigs.length !== 1 ? 's' : ''}`);
      if (invoicedTotal > 0) parts.push(`${fmt(invoicedTotal, currency)} invoiced`);
      if (overdueTotal > 0) parts.push(`${fmt(overdueTotal, currency)} overdue`);

      tasks.push(push({
        fireAt: nextMon.toISOString(),
        tag: `weekly-digest-${nextMon.toISOString().slice(0, 10)}`,
        title: `Weekly digest`,
        body: parts.join(' · ') || 'Review your week',
        url: '/Dashboard',
        actions: [
          { action: 'open_finance', title: 'Finance' },
          { action: 'open_dash', title: 'Dashboard' },
        ],
        actionUrls: {
          open_finance: '/Finance',
          open_dash: '/Dashboard',
        },
      }));
    }
  }

  // Fire all scheduling requests in parallel (ignore individual failures)
  await Promise.allSettled(tasks.filter(Boolean));
}
