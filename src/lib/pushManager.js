// Flowtone Push Notification Manager
// Handles SW registration, subscription, scheduling — 5-layer notification system.

import { getEffectivePrefs, timingToMinutes } from './notificationPrefs.js';
import { gigsMissingFee, importedEventsIncomplete, hasFee } from './missingInfo.js';
import { getSupabaseClient, isPreviewModeEnabled } from './supabaseClient.js';
import {
  isNative,
  areLocalRemindersOn,
  enableLocalReminders,
  disableLocalReminders,
  scheduleLocalReminders,
  sendLocalTest,
} from './localNotifications.js';

/** Current session's access token, sent as a Bearer header so the server can
 *  verify (not just trust) which user a push subscription belongs to —
 *  needed for server-initiated pushes like "new lead received". */
async function getAccessToken() {
  if (isPreviewModeEnabled()) return null;
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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

/** Local "yyyy-MM-dd" of a Date — used to date-suffix recurring tags.
 *  iOS/WebKit ignores `renotify`, so a push reusing an existing tag silently
 *  replaces the old notification (no banner, no sound). Recurring daily
 *  reminders must get a fresh tag per fire-date to actually pop. */
function localDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Daily nags repeat for this many mornings, so they keep coming even if the
 *  app isn't opened (each open re-plans and moves the window forward). */
const NAG_DAYS = 3;
/** The morning digest is planned this many days ahead. */
const DIGEST_DAYS = 7;

/** The next `count` local mornings at hh:mm, starting today if that time is still ahead. */
function nextMornings(count, hours = 9, minutes = 0) {
  const first = new Date();
  first.setHours(hours, minutes, 0, 0);
  if (first.getTime() <= Date.now()) first.setDate(first.getDate() + 1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
}

// Short labels for grouping open suggestions in the morning digest: [one, many].
const SUGGESTION_LABELS = {
  invoice_overdue:       ['overdue invoice', 'overdue invoices'],
  gig_missing_fee:       ['gig needs a fee', 'gigs need a fee'],
  gig_missing_client:    ['gig needs a client', 'gigs need a client'],
  gig_missing_contact:   ['client needs an email', 'clients need an email'],
  gig_missing_location:  ['gig needs a location', 'gigs need a location'],
  gig_ready_to_invoice:  ['gig ready to invoice', 'gigs ready to invoice'],
  invoice_ready_to_send: ['invoice ready to send', 'invoices ready to send'],
  invoice_ready_no_email:['invoice ready, no email', 'invoices ready, no email'],
  invoice_draft_stale:   ['draft invoice waiting', 'draft invoices waiting'],
  lead_new_unanswered:   ['new enquiry to answer', 'new enquiries to answer'],
  lead_quote_no_reply:   ['quote with no reply', 'quotes with no reply'],
};

function clip(text, max = 72) {
  const t = String(text || '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Top open suggestions (ActionItems) as short phrases: grouped by type, highest
 * priority first, at most `limit`. A type with one item uses that item's own
 * title; several become "4 gigs need a client".
 */
export function summarizeSuggestions(actionItems = [], limit = 3) {
  const now = Date.now();
  const groups = new Map();
  for (const item of actionItems) {
    if (item.status !== 'open') continue;
    if (item.snoozed_until && new Date(item.snoozed_until).getTime() > now) continue;
    // Group items all share the type "group", so each one is its own entry and
    // keeps its own title ("64 past gigs still have no fee"); singles bucket by type.
    const key = item.item_type === 'group' ? `group:${item.id}` : (item.item_type || item.id);
    const g = groups.get(key) || { type: item.item_type, items: [], priority: 0 };
    g.items.push(item);
    g.priority = Math.max(g.priority, item.priority || 0);
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort(
    (a, b) => b.priority - a.priority || b.items.length - a.items.length
  );
  const phrases = sorted.slice(0, limit).map((g) => {
    const label = SUGGESTION_LABELS[g.type];
    if (g.items.length === 1 || !label) {
      return g.items.length === 1 ? clip(g.items[0].title) : `${g.items.length} × ${clip(g.items[0].title, 40)}`;
    }
    return `${g.items.length} ${label[1]}`;
  });
  return { phrases, more: Math.max(0, sorted.length - limit) };
}

// ─── Public API ─────────────────────────────────────────────────────────────
// On the iOS app every entry point routes to iOS local notifications
// (localNotifications.js); the web keeps server-scheduled web push.

export async function registerPush(notificationLevel = 'standard') {
  if (isNative()) return enableLocalReminders();
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

  const token = await getAccessToken();
  await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ subscription, userAgent: navigator.userAgent, notificationLevel }),
  });

  return { success: true };
}

export async function unregisterPush() {
  if (isNative()) return disableLocalReminders();
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
  if (isNative()) return;
  const sub = await getActiveSubscription();
  if (!sub) return;
  try {
    const token = await getAccessToken();
    await fetch(`${API_BASE}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ subscription: sub, userAgent: navigator.userAgent, notificationLevel }),
    });
  } catch { /* silent */ }
}

export async function sendTestPush() {
  if (isNative()) return sendLocalTest();
  const sub = await getActiveSubscription();
  if (!sub) return { success: false, reason: 'not_subscribed' };
  try {
    const res = await fetch(`${API_BASE}/api/push/send-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        title: '🎵 Flowtone Notifications Working!',
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
  if (isNative()) return areLocalRemindersOn();
  const sub = await getActiveSubscription();
  return !!sub;
}

// ─── Main scheduler ─────────────────────────────────────────────────────────

/**
 * Schedule all reminders for the next 30 days: iOS local notifications on the
 * iOS app, server-scheduled web push elsewhere (only if this browser is subscribed).
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
  settings = {},
  actionItems = null
) {
  const native = isNative();
  const sub = native ? null : await getActiveSubscription();
  if (!native && !sub) return;

  // Open suggestions for the morning digest (callers may pass them in).
  if (!actionItems) {
    try {
      const { appClient } = await import('@/api/appClient');
      actionItems = await appClient.entities.ActionItem.filter({ status: 'open' });
    } catch {
      actionItems = [];
    }
  }

  const plan = buildReminderPlan(events, clients, documents, settings, actionItems);
  if (native) return scheduleLocalReminders(plan);

  // Replace this browser's whole plan on the server, so reminders for gigs
  // that were cancelled or moved don't linger. Older servers lack /replan:
  // fall back to one request per push (ignore individual failures).
  const replaced = await fetch(`${API_BASE}/api/push/replan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint, pushes: plan }),
  }).then((res) => res.ok).catch(() => false);
  if (replaced) return;
  await Promise.allSettled(plan.map((p) => schedule({ endpoint: sub.endpoint, ...p })));
}

/**
 * Work out every reminder due in the next 30 days, honouring the user's
 * notification level and prefs. Pure: returns
 * [{ fireAt, tag, title, body, url, actions, actionUrls }].
 */
export function buildReminderPlan(
  events = [],
  clients = [],
  documents = [],
  settings = {},
  actionItems = []
) {
  const now = Date.now();
  const nowTs = Math.floor(now / 1000);
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const level = settings.notification_level || 'standard';
  const prefs = getEffectivePrefs(level, settings.notification_prefs || {});
  const currency = settings.default_currency || 'GBP';

  const clientMap = Object.fromEntries((clients || []).map(c => [c.id, c]));

  // Helper to only keep reminders whose fireAt is in the future
  const push = (p) => {
    const fireTs = Math.floor(new Date(p.fireAt).getTime() / 1000);
    if (fireTs <= nowTs) return null; // already past
    if (fireTs > nowTs + thirtyDaysMs / 1000) return null; // beyond 30-day window
    return p;
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

  // Imported (e.g. Google Calendar) events still missing a location and/or fee.
  // Computed once: the missing_venue layer defers to this one so a freshly
  // imported gig gets the "I added this from your calendar" copy, not a generic
  // venue warning — exactly one notification per blocked gig.
  const importedIncomplete = importedEventsIncomplete(gigEvents, documents, now);
  const importedIncompleteIds = new Set(importedIncomplete.map(x => x.event.id));

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
      const clientPhone = client?.phones?.[0];
      if (clientPhone) {
        actions.push({ action: 'contact', title: '📞 Call' });
        actionUrls.contact = `tel:${clientPhone}`;
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
  // The morning digest (L5a) already leads with the day's events, so this only
  // runs when the digest is off — one morning notification, not two.
  if (prefs.gig_day_of_summary?.enabled && !prefs.daily_briefing?.enabled) {
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
      // No fee and no draft invoice → the app can't build an invoice at all.
      // Hand off to the gig_needs_fee layer (it asks for the amount) instead of
      // nudging to "create" an invoice that can't be created.
      if (!hasFee(event) && !draftInvoiceByEvent[event.id]) continue;
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

  // ── L2a-bis: Gig needs a fee (blocks the invoice) ───────────────────────
  if (prefs.gig_needs_fee?.enabled) {
    // Past, billable gigs with no fee and no invoice — limited to the last 14
    // days so we don't nag about ancient gigs. The app literally can't make the
    // invoice until it knows the amount.
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const feeBlocked = gigsMissingFee(events, documents, now).filter(e => {
      const end = parseLocal(e.date, e.end_time || e.start_time)?.getTime();
      return end != null && end >= now - fourteenDaysMs;
    });
    for (const event of feeBlocked) {
      // The gig is already over (gigsMissingFee returns only past gigs), so
      // fireAt = gigEnd + 1day would be in the past and get dropped by push().
      // Fire on the next few 9am mornings from NOW instead; each open re-plans
      // and the per-day tag prevents duplicates.
      for (const fireAt of nextMornings(NAG_DAYS)) {
        tasks.push(push({
          fireAt: fireAt.toISOString(),
          tag: `needs-fee-${event.id}-${localDay(fireAt)}`,
          title: `I need the fee for ${event.title}`,
          body: `That gig's done but you never told me the fee, so I can't make the invoice. Tap to add the amount.`,
          url: `/WorkEventDetail?id=${event.id}`,
          actions: [{ action: 'open_gig', title: 'Add fee' }],
          actionUrls: { open_gig: `/WorkEventDetail?id=${event.id}` },
        }));
      }
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
      // 9am on the next few mornings (today's 9am if it's still ahead)
      for (const fireAt of nextMornings(NAG_DAYS)) {
        const fireDay = new Date(fireAt);
        fireDay.setHours(0, 0, 0, 0);
        const daysOver = Math.round((fireDay.getTime() - dueDt.getTime()) / (24 * 60 * 60 * 1000));
        tasks.push(push({
          fireAt: fireAt.toISOString(),
          tag: `inv-overdue-${inv.id}-${localDay(fireAt)}`,
          title: `Overdue invoice: ${inv.title || inv.document_number}`,
          body: `Overdue by ${daysOver} day${daysOver !== 1 ? 's' : ''} · ${fmt(inv.total, currency)}`,
          url: `/DocumentDetail?id=${inv.id}`,
          actions: [{ action: 'open_invoice', title: 'Open Invoice' }],
          actionUrls: { open_invoice: `/DocumentDetail?id=${inv.id}` },
        }));
      }
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
        tag: `weekly-unpaid-${localDay(nextMon)}`,
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
      // Defer to imported_event_incomplete for freshly imported gigs (it has
      // more useful "I added this from your calendar" copy) — no double-notify.
      if (prefs.imported_event_incomplete?.enabled && importedIncompleteIds.has(event.id)) continue;
      const startDt = parseLocal(event.date);
      if (!startDt) continue;
      const daysUntil = Math.floor((startDt.getTime() - now) / (24 * 60 * 60 * 1000));
      if (daysUntil > 7 || daysUntil < 0) continue;
      const fireAt = new Date(startDt.getTime() - 2 * 24 * 60 * 60 * 1000);
      fireAt.setHours(9, 0, 0, 0);
      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `missing-venue-${event.id}`,
        title: `I can't plan travel to ${event.title}`,
        body: `No location yet, so I can't work out your travel time. Tap to add it.`,
        url: `/WorkEventDetail?id=${event.id}`,
        actions: [{ action: 'open_gig', title: 'Add location' }],
        actionUrls: { open_gig: `/WorkEventDetail?id=${event.id}` },
      }));
    }
  }

  // ── L3a-bis: Imported event missing details ─────────────────────────────
  if (prefs.imported_event_incomplete?.enabled) {
    for (const { event, missingLocation, missingFee } of importedIncomplete) {
      // Imported just now — prompt soon (next few 9am mornings) rather than
      // waiting until 2 days before the gig. Per-day tags mean reopening won't
      // spam, and once the user fills the field the finder drops it next re-plan.
      const miss = missingLocation && missingFee
        ? 'a location or the fee'
        : missingLocation
          ? 'a location'
          : 'the fee';
      for (const fireAt of nextMornings(NAG_DAYS)) {
        tasks.push(push({
          fireAt: fireAt.toISOString(),
          tag: `imported-incomplete-${event.id}-${localDay(fireAt)}`,
          title: `I added "${event.title}" from your calendar`,
          body: `It's missing ${miss} — I can't plan around it yet. Tap to fill in the details.`,
          url: `/WorkEventDetail?id=${event.id}`,
          actions: [{ action: 'open_gig', title: 'Add details' }],
          actionUrls: { open_gig: `/WorkEventDetail?id=${event.id}` },
        }));
      }
    }
  }

  // ── L3b: Unconfirmed follow-up ──────────────────────────────────────────
  if (prefs.unconfirmed_followup?.enabled) {
    for (const event of nonPracticeGigs) {
      if (event.status !== 'lead') continue;
      const startDt = parseLocal(event.date);
      if (!startDt) continue;
      // Nudge on the next few 9am mornings while the gig is 3–14 days out
      for (const fireAt of nextMornings(NAG_DAYS)) {
        const daysUntil = Math.round((startDt.getTime() - new Date(fireAt).setHours(0, 0, 0, 0)) / (24 * 60 * 60 * 1000));
        if (daysUntil < 3 || daysUntil > 14) continue;
        tasks.push(push({
          fireAt: fireAt.toISOString(),
          tag: `unconfirmed-${event.id}-${localDay(fireAt)}`,
          title: `Still tentative: ${event.title}`,
          body: `${daysUntil} days away — is this confirmed yet?`,
          url: `/WorkEventDetail?id=${event.id}`,
          actions: [{ action: 'open_gig', title: 'Review' }],
          actionUrls: { open_gig: `/WorkEventDetail?id=${event.id}` },
        }));
      }
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

  // ── L5a: Morning digest (one notification a day) ────────────────────────
  // Leads with the day's events, then the top open suggestions from Missions.
  // Planned DIGEST_DAYS ahead so it keeps arriving if the app isn't opened;
  // the suggestions are as of the last open (each open re-plans).
  if (prefs.daily_briefing?.enabled) {
    const [hh, mm] = String(prefs.daily_briefing.time || '08:30').split(':').map(Number);
    const { phrases, more } = summarizeSuggestions(actionItems, 3);
    const suggestLine = phrases.length
      ? `To sort: ${phrases.join(' · ')}${more ? ` · +${more} more` : ''}`
      : '';

    for (const fireAt of nextMornings(DIGEST_DAYS, hh || 0, mm || 0)) {
      const dayStr = localDay(fireAt);
      const dayEvents = nonPracticeGigs
        .filter(e => e.date === dayStr)
        .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
      if (dayEvents.length === 0 && !suggestLine) continue;

      let title;
      let eventLine = '';
      if (dayEvents.length === 1) {
        const e = dayEvents[0];
        title = `Today: ${e.title}${e.start_time ? ` at ${fmtTime(e.start_time)}` : ''}`;
        eventLine = e.location_address || '';
      } else if (dayEvents.length > 1) {
        title = `Today: ${dayEvents.length} events${dayEvents[0].start_time ? `, first at ${fmtTime(dayEvents[0].start_time)}` : ''}`;
        eventLine = dayEvents
          .slice(0, 3)
          .map(e => `${e.start_time ? fmtTime(e.start_time) + ' ' : ''}${clip(e.title, 30)}`)
          .join(', ') + (dayEvents.length > 3 ? ` +${dayEvents.length - 3} more` : '');
      } else {
        title = 'Good morning — nothing booked today';
      }

      tasks.push(push({
        fireAt: fireAt.toISOString(),
        tag: `daily-brief-${dayStr}`,
        title,
        body: [eventLine, suggestLine].filter(Boolean).join('\n') || 'Tap to see your day',
        url: '/Missions',
        actions: [{ action: 'open_missions', title: 'Open Missions' }],
        actionUrls: { open_missions: '/Missions' },
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
        tag: `weekly-digest-${localDay(nextMon)}`,
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

  return tasks.filter(Boolean);
}
