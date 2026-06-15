import { createLocalEntity } from "@/api/localStorageEngine";
import { ENTITY_DEFAULTS } from "@/api/entityMetadata";
import { PREVIEW_USER } from "@/lib/previewMode";
import { getSupabaseClient, isPreviewModeEnabled } from "@/lib/supabaseClient";
import { syncNow } from "@/lib/calendarClient";
import { format } from "date-fns";
import { expandRecurrence, normalizeRule, describeRule, isOpenEnded, HORIZON_MONTHS } from "@/lib/recurrence";

// ─── Entity Registry ───────────────────────────────────────────────
const entityNames = [
  "AppSettings",
  "BusinessProfile",
  "Chart",
  "Client",
  "Document",
  "DocumentActivityLog",
  "EmailMessage",
  "Equipment",
  "Payment",
  "Notification",
  "PracticeGoal",
  "PracticeSession",
  "Reminder",
  "Setlist",
  "WorkEvent",
];

const entities = Object.fromEntries(
  entityNames.map((name) => [name, createLocalEntity(name)])
);

// ─── Utility Helpers ───────────────────────────────────────────────
const parseCsvLine = (line) => {
  const vals = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      vals.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  vals.push(cur.trim());
  return vals.map((v) => v.replace(/^"|"$/g, ""));
};

const parseCsvText = (csvText) => {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? "";
    });
    return row;
  });
};

const toNumber = (value, fallback = 0) => {
  const cleaned = String(value ?? "")
    .replace(/[^0-9.\-]/g, "")
    .trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : fallback;
};

const pick = (obj, keys, fallback = "") => {
  for (const key of keys) {
    if (obj[key] != null && String(obj[key]).trim() !== "") {
      return String(obj[key]).trim();
    }
  }
  return fallback;
};

// ─── Client Helpers ────────────────────────────────────────────────
const ensureClient = async ({ name, email, address }) => {
  const trimmedName = (name || "").trim();
  if (!trimmedName) return null;
  const allClients = await entities.Client.list();
  let client = allClients.find(
    (c) => (c.name || "").toLowerCase() === trimmedName.toLowerCase()
  );
  if (!client) {
    client = await entities.Client.create({
      name: trimmedName,
      emails: email ? [email] : [],
      billing_address: address || "",
    });
  } else if (email && !(client.emails || []).includes(email)) {
    client = await entities.Client.update(client.id, {
      emails: [...(client.emails || []), email],
    });
  }
  return client;
};

// ─── Document Helpers ──────────────────────────────────────────────

const ensureSingletonEntity = async (entityName) => {
  const existing = await entities[entityName].list();
  if (existing[0]) return existing[0];

  const defaults = ENTITY_DEFAULTS[entityName] || {};
  return entities[entityName].create(defaults);
};

/**
 * Get the next auto-generated document number (INV-0001, EST-0003, etc.)
 * Reads the counter from AppSettings and increments it.
 */
const getNextDocumentNumber = async (documentType) => {
  const s = await ensureSingletonEntity("AppSettings");

  const isInvoice = documentType === "invoice";
  const prefix = isInvoice
    ? s.invoice_number_prefix || "INV-"
    : s.estimate_number_prefix || "EST-";
  const nextNum = isInvoice
    ? s.invoice_number_next || 1
    : s.estimate_number_next || 1;

  const docNumber = `${prefix}${String(nextNum).padStart(4, "0")}`;

  // Increment counter
  await entities.AppSettings.update(s.id, {
    [isInvoice ? "invoice_number_next" : "estimate_number_next"]: nextNum + 1,
  });

  return docNumber;
};

/**
 * Calculate document totals from line items + discount + tax.
 */
const calculateDocumentTotals = (doc) => {
  const lineItems = doc.line_items || [];
  const subtotal = lineItems.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price) || 0;
    return sum + qty * price;
  }, 0);

  let discountAmount = 0;
  if (doc.discount_type === "percentage" && doc.discount_value) {
    discountAmount = subtotal * (Number(doc.discount_value) / 100);
  } else if (doc.discount_type === "fixed" && doc.discount_value) {
    discountAmount = Number(doc.discount_value);
  }

  const afterDiscount = subtotal - discountAmount;
  const taxRate = Number(doc.tax_rate) || 0;
  const taxAmount = afterDiscount * (taxRate / 100);
  const total = afterDiscount + taxAmount;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discount_amount: Math.round(discountAmount * 100) / 100,
    tax_amount: Math.round(taxAmount * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
};

/**
 * Convert an estimate to an invoice.
 * Creates a new Document of type 'invoice' and marks the estimate as 'converted'.
 */
const convertEstimateToInvoice = async (estimateId) => {
  const estimates = await entities.Document.filter({ id: estimateId });
  const estimate = estimates[0];
  if (!estimate) throw new Error("Estimate not found");
  if (estimate.document_type !== "estimate") throw new Error("Document is not an estimate");

  // Get auto-number for the new invoice
  const invoiceNumber = await getNextDocumentNumber("invoice");

  // Create invoice from estimate data
  const invoice = await entities.Document.create({
    document_type: "invoice",
    document_number: invoiceNumber,
    title: estimate.title,
    client_id: estimate.client_id,
    client_email: estimate.client_email || "",
    status: "draft",
    currency: estimate.currency || "GBP",
    line_items: estimate.line_items || [],
    subtotal: estimate.subtotal || 0,
    discount_type: estimate.discount_type || null,
    discount_value: estimate.discount_value || 0,
    discount_amount: estimate.discount_amount || 0,
    tax_rate: estimate.tax_rate || 0,
    tax_amount: estimate.tax_amount || 0,
    total: estimate.total || estimate.subtotal || 0,
    payment_terms_days: estimate.payment_terms_days || 30,
    due_date: "",
    notes: estimate.notes || "",
    work_event_id: estimate.work_event_id || "",
    is_standalone: estimate.is_standalone || false,
    converted_from_id: estimate.id,
    is_locked: false,
    paid_amount: 0,
  });

  // Mark estimate as converted
  await entities.Document.update(estimate.id, {
    status: "converted",
  });

  // Log activity
  await logDocumentActivity(estimate.id, "converted", estimate.status, "converted", {
    converted_to_invoice_id: invoice.id,
    invoice_number: invoiceNumber,
  });
  await logDocumentActivity(invoice.id, "created", null, "draft", {
    converted_from_estimate_id: estimate.id,
  });

  return invoice;
};

/**
 * Record a payment against a document (invoice).
 */
const recordPayment = async ({ document_id, amount, payment_date, payment_method, reference, notes }) => {
  const docs = await entities.Document.filter({ id: document_id });
  const doc = docs[0];
  if (!doc) throw new Error("Document not found");

  const payment = await entities.Payment.create({
    document_id,
    amount: Number(amount) || 0,
    payment_date: payment_date || format(new Date(), "yyyy-MM-dd"),
    payment_method: payment_method || "",
    reference: reference || "",
    notes: notes || "",
  });

  // Update paid_amount on the document
  const allPayments = await entities.Payment.filter({ document_id });
  const totalPaid = allPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const docTotal = Number(doc.total) || Number(doc.subtotal) || 0;

  const updateData = {
    paid_amount: Math.round(totalPaid * 100) / 100,
  };

  // Auto-mark as paid if fully paid
  if (totalPaid >= docTotal && doc.status !== "paid") {
    updateData.status = "paid";
    updateData.paid_date = payment_date || format(new Date(), "yyyy-MM-dd");

    await logDocumentActivity(document_id, "paid", doc.status, "paid", {
      payment_id: payment.id,
      total_paid: totalPaid,
    });
  }

  await entities.Document.update(document_id, updateData);

  return payment;
};

/**
 * Log an activity entry for a document (audit trail).
 */
const logDocumentActivity = async (documentId, action, oldStatus, newStatus, details = {}) => {
  return entities.DocumentActivityLog.create({
    document_id: documentId,
    action,
    old_status: oldStatus || "",
    new_status: newStatus || "",
    details,
  });
};

/**
 * Lock a document (typically when sent).
 */
const lockDocument = async (documentId) => {
  const docs = await entities.Document.filter({ id: documentId });
  const doc = docs[0];
  if (!doc) throw new Error("Document not found");

  await entities.Document.update(documentId, {
    is_locked: true,
    locked_at: new Date().toISOString(),
  });

  await logDocumentActivity(documentId, "locked", doc.status, doc.status);
};

/**
 * Unlock a document for editing.
 */
const unlockDocument = async (documentId, reason = "") => {
  const docs = await entities.Document.filter({ id: documentId });
  const doc = docs[0];
  if (!doc) throw new Error("Document not found");

  await entities.Document.update(documentId, {
    is_locked: false,
    unlocked_reason: reason,
  });

  await logDocumentActivity(documentId, "unlocked", doc.status, doc.status, { reason });
};

/**
 * Build a client lookup map: { client_id: client_record }
 */
const buildClientMap = async () => {
  const clients = await entities.Client.list();
  return Object.fromEntries(clients.map((c) => [c.id, c]));
};

// ─── Recurring series (shared engine) ──────────────────────────────
//
// createRecurringSeries materialises a series from a normalized recurrence
// rule using the shared engine in src/lib/recurrence.js. It is resilient to
// partial failure: each event is created independently and a single failed
// insert no longer aborts the whole series or leaves the caller with a bare
// error. The full rule + anchor date are stamped on every event so the
// rolling top-up (topUpRecurringSeries) can later extend an open-ended series.
// anchorEventId — when the series grows out of an event that already exists
// (the RecurrenceSection on an event detail screen), pass its id: that event
// is adopted as occurrence #0 instead of being duplicated, and only the
// remaining dates are created.
const createRecurringSeries = async ({ template = {}, rule: ruleInput = {}, startDate, anchorEventId, today } = {}) => {
  const rule = normalizeRule(ruleInput);
  const anchor = startDate || template.date;
  if (!anchor) return { success: false, error: "A start date is required.", created: 0, failed: 0 };

  const dates = expandRecurrence(anchor, rule, { today });
  if (dates.length === 0) return { success: false, error: "That schedule produced no dates.", created: 0, failed: 0 };

  const recurrenceId = template.recurrence_id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

  // Strip fields that must be per-occurrence or are server-managed.
  const {
    id: _id, date: _date, created_at: _c, updated_at: _u,
    recurrence_index: _ri, google_calendar_event_id: _g,
    ...base
  } = template;

  let created = 0;
  let failed = 0;
  let firstId = anchorEventId || null;
  const createdEvents = [];

  // If an anchor event already exists, adopt it as occurrence #0 and create
  // only the dates after it (skip the first generated date, which is itself).
  let startIndex = 0;
  if (anchorEventId) {
    try {
      await entities.WorkEvent.update(anchorEventId, {
        is_recurring: true,
        recurrence_id: recurrenceId,
        recurrence_index: 0,
        recurrence_rule: rule,
        recurrence_anchor: anchor,
      });
    } catch (err) {
      console.warn("createRecurringSeries: failed to update anchor event", err);
    }
    startIndex = 1; // dates[0] is the anchor itself
  }

  for (let index = startIndex; index < dates.length; index += 1) {
    try {
      const evt = await entities.WorkEvent.create({
        ...base,
        event_type: base.event_type || "Lesson",
        status: base.status || "confirmed",
        date: dates[index],
        is_recurring: true,
        recurrence_id: recurrenceId,
        recurrence_index: index,
        recurrence_rule: rule,
        recurrence_anchor: anchor,
        google_calendar_event_id: "",
      });
      if (!firstId) firstId = evt?.id;
      createdEvents.push(evt);
      created += 1;
    } catch (err) {
      console.warn("createRecurringSeries: insert failed for", dates[index], err);
      failed += 1;
    }
  }

  return {
    success: created > 0 || !!anchorEventId,
    created,
    failed,
    recurrence_id: recurrenceId,
    first_event_id: firstId,
    events: createdEvents,
    dates,
    open_ended: isOpenEnded(rule),
    summary: describeRule(rule),
  };
};

// Top up open-ended series so roughly HORIZON_MONTHS of future occurrences
// always exist. Idempotent: only creates dates that aren't already present in
// the series, so it is safe to run on every app open. Returns the number of
// events added across all series.
const topUpRecurringSeries = async ({ today } = {}) => {
  let allEvents;
  try {
    allEvents = await entities.WorkEvent.list();
  } catch {
    return { added: 0, series: 0 };
  }

  // Group recurring events by their series id.
  const groups = new Map();
  for (const e of allEvents) {
    if (!e.is_recurring || !e.recurrence_id) continue;
    if (!groups.has(e.recurrence_id)) groups.set(e.recurrence_id, []);
    groups.get(e.recurrence_id).push(e);
  }

  let added = 0;
  let seriesTouched = 0;
  for (const [recurrenceId, members] of groups) {
    // Only extend open-ended series; fixed count/until series are complete.
    const ruleSource = members.find((m) => m.recurrence_rule && Object.keys(m.recurrence_rule).length) || members[0];
    const rule = ruleSource?.recurrence_rule;
    if (!rule || !isOpenEnded(rule)) continue;

    const anchor = ruleSource.recurrence_anchor
      || members.map((m) => m.date).filter(Boolean).sort()[0];
    if (!anchor) continue;

    const existing = new Set(members.map((m) => m.date));
    const latest = members.map((m) => m.date).filter(Boolean).sort().pop();

    // Desired dates across the full horizon from anchor; keep only ones we
    // don't already have and that fall after the current latest occurrence.
    const desired = expandRecurrence(anchor, rule, { today });
    const missing = desired.filter((d) => !existing.has(d) && (!latest || d > latest));
    if (missing.length === 0) continue;

    // Use the latest member as the template for new occurrences.
    const tmpl = members.reduce((a, b) => (a.recurrence_index > b.recurrence_index ? a : b), members[0]);
    let nextIndex = Math.max(...members.map((m) => Number(m.recurrence_index) || 0)) + 1;
    const {
      id: _i, date: _d, created_at: _c, updated_at: _u,
      recurrence_index: _ri, google_calendar_event_id: _g, ...base
    } = tmpl;

    for (const date of missing) {
      try {
        await entities.WorkEvent.create({
          ...base,
          date,
          is_recurring: true,
          recurrence_id: recurrenceId,
          recurrence_index: nextIndex,
          recurrence_rule: rule,
          recurrence_anchor: anchor,
          google_calendar_event_id: "",
        });
        nextIndex += 1;
        added += 1;
      } catch (err) {
        console.warn("topUpRecurringSeries: insert failed for", date, err);
      }
    }
    seriesTouched += 1;
  }

  return { added, series: seriesTouched };
};

// Apply selected fields from one event to every UPCOMING event in the same
// series (date >= today, not this event itself, not already completed/cancelled
// unless includeAll is true). Returns { updated, skipped }.
//
// Which fields to carry: caller passes `fields` — an array of field names
// picked from the edited event. Default set covers time + price.
const DEFAULT_SERIES_FIELDS = [
  "start_time", "end_time",
  "base_price", "total_price", "currency",
  "location_address",
];

const applyToUpcomingInSeries = async ({ event, fields = DEFAULT_SERIES_FIELDS, today } = {}) => {
  if (!event?.recurrence_id) return { updated: 0, skipped: 0 };

  const todayStr = today || format(new Date(), "yyyy-MM-dd");

  let allEvents;
  try {
    allEvents = await entities.WorkEvent.list();
  } catch {
    return { updated: 0, skipped: 0 };
  }

  const siblings = allEvents.filter(
    (e) =>
      e.recurrence_id === event.recurrence_id &&
      e.id !== event.id &&
      e.date &&
      e.date >= todayStr &&
      e.status !== "cancelled" &&
      e.status !== "completed",
  );

  const patch = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(event, f)) {
      patch[f] = event[f];
    }
  }
  if (Object.keys(patch).length === 0) return { updated: 0, skipped: 0 };

  let updated = 0;
  let skipped = 0;
  for (const sibling of siblings) {
    try {
      await entities.WorkEvent.update(sibling.id, patch);
      updated += 1;
    } catch (err) {
      console.warn("applyToUpcomingInSeries: update failed for", sibling.id, err);
      skipped += 1;
    }
  }

  return { updated, skipped };
};

// ─── Multi-event invoices ──────────────────────────────────────────
//
// buildInvoiceFromEvents creates ONE invoice covering several events (e.g.
// "invoice the last 4 lessons"). All events must belong to the same client.
// layout:
//   "per_event" (default) — one line item per event, dated
//   "bundled"             — a single summary line ("N lessons @ £X")
// Each invoiced event is stamped with the invoice id so it shows as invoiced
// and won't be double-billed.
const buildInvoiceFromEvents = async ({ event_ids = [], layout = "per_event", title, due_date, notes, status = "draft", currency } = {}) => {
  if (!Array.isArray(event_ids) || event_ids.length === 0) {
    throw new Error("No events selected for the invoice.");
  }

  // Load the events (filter is single-key, so fetch all once and pick).
  const all = await entities.WorkEvent.list();
  const byId = new Map(all.map((e) => [e.id, e]));
  const events = event_ids.map((id) => byId.get(id)).filter(Boolean)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (events.length === 0) throw new Error("Couldn't find those events.");

  // Determine the client — must be shared.
  const clientIds = [...new Set(events.map((e) => e.client_id).filter(Boolean))];
  if (clientIds.length > 1) {
    throw new Error("Those events belong to different clients — invoice them separately.");
  }
  const clientId = clientIds[0] || "";

  const cur = currency || events[0].currency || "GBP";
  const priceOf = (e) => Number(e.total_price ?? e.base_price) || 0;
  const niceDate = (d) => {
    try { return format(new Date(d + "T12:00:00"), "EEE d MMM"); } catch { return d; }
  };

  let lineItems;
  if (layout === "bundled") {
    const total = events.reduce((s, e) => s + priceOf(e), 0);
    const prices = [...new Set(events.map(priceOf))];
    const unit = prices.length === 1 ? prices[0] : Math.round((total / events.length) * 100) / 100;
    const label = events[0].event_type === "Lesson" ? "lessons" : "events";
    const span = events.length > 1 ? ` (${niceDate(events[0].date)} – ${niceDate(events[events.length - 1].date)})` : "";
    lineItems = [{
      description: `${events.length} ${label}${span}`,
      quantity: events.length,
      unit_price: unit,
      total: Math.round(unit * events.length * 100) / 100,
    }];
  } else {
    lineItems = events.map((e) => {
      const price = priceOf(e);
      return {
        description: `${e.title || e.event_type || "Session"} — ${niceDate(e.date)}`,
        quantity: 1,
        unit_price: price,
        total: price,
      };
    });
  }

  const subtotal = Math.round(lineItems.reduce((s, i) => s + (Number(i.total) || 0), 0) * 100) / 100;
  const docNumber = await getNextDocumentNumber("invoice");
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const safeStatus = ["draft", "sent", "paid"].includes(status) ? status : "draft";

  const defaultTitle = events[0].event_type === "Lesson"
    ? `Lessons — ${events.length}× ${niceDate(events[0].date)}–${niceDate(events[events.length - 1].date)}`
    : (events[0].title || "Invoice");

  const doc = await entities.Document.create({
    document_type: "invoice",
    document_number: docNumber,
    title: title || defaultTitle,
    client_id: clientId,
    status: safeStatus,
    currency: cur,
    line_items: lineItems,
    subtotal,
    total: subtotal,
    tax_rate: 0,
    tax_amount: 0,
    discount_value: 0,
    discount_amount: 0,
    due_date: due_date || "",
    notes: notes || "",
    work_event_id: events[0].id,          // primary, for back-compat with single-event UI
    work_event_ids: events.map((e) => e.id), // full set (lands in payload jsonb)
    is_standalone: false,
    is_locked: false,
    paid_amount: safeStatus === "paid" ? subtotal : 0,
    ...(safeStatus === "paid" ? { paid_date: todayStr } : {}),
    ...(safeStatus === "sent" || safeStatus === "paid" ? { sent_date: todayStr } : {}),
  });

  // Stamp each event so it reads as invoiced and won't be re-billed.
  for (const e of events) {
    try {
      await entities.WorkEvent.update(e.id, { invoice_id: doc.id, invoice_status: safeStatus });
    } catch (err) {
      console.warn("buildInvoiceFromEvents: failed to stamp event", e.id, err);
    }
  }

  return { document: doc, event_count: events.length, total: subtotal };
};

// ─── Recurring Events ──────────────────────────────────────────────
const addInterval = (dateObj, frequency, interval) => {
  const out = new Date(dateObj.getTime());
  const safeInterval = Math.max(1, Number(interval) || 1);
  if (frequency === "daily") out.setDate(out.getDate() + safeInterval);
  else if (frequency === "weekly") out.setDate(out.getDate() + safeInterval * 7);
  else if (frequency === "monthly") out.setMonth(out.getMonth() + safeInterval);
  else out.setFullYear(out.getFullYear() + safeInterval);
  return out;
};

const fnCreateRecurringEvents = async ({ event_id }) => {
  const found = await entities.WorkEvent.filter({ id: event_id });
  const event = found?.[0];
  if (!event) return { data: { success: false, error: "Event not found" } };

  const rule = event.recurrence_rule || {};
  const frequency = rule.frequency || "weekly";
  const interval = rule.interval || 1;
  const recurrenceId = event.recurrence_id || crypto.randomUUID();
  const maxCount =
    rule.end_type === "count" ? Math.max(2, Number(rule.count) || 2) : 20;
  const untilDate =
    rule.end_type === "until" && rule.until ? new Date(rule.until) : null;

  const startDate = event.date ? new Date(event.date) : new Date();
  await entities.WorkEvent.update(event.id, {
    is_recurring: true,
    recurrence_id: recurrenceId,
    recurrence_index: 0,
  });

  let cursor = startDate;
  let created = 0;
  for (let idx = 1; idx < maxCount; idx += 1) {
    cursor = addInterval(cursor, frequency, interval);
    if (untilDate && cursor > untilDate) break;
    await entities.WorkEvent.create({
      ...event,
      id: undefined,
      date: format(cursor, "yyyy-MM-dd"),
      is_recurring: true,
      recurrence_id: recurrenceId,
      recurrence_index: idx,
      google_calendar_event_id: "",
    });
    created += 1;
  }

  return {
    data: {
      success: true,
      recurrence_id: recurrenceId,
      created_count: created,
    },
  };
};

const fnSyncToGoogleCalendar = async () => {
  // Real two-way sync now runs server-side over the whole calendar; a single
  // event is pushed as part of that. Returns success only when actually synced
  // (not skipped because the calendar is disconnected).
  try {
    const result = await syncNow();
    return { data: { success: !result.skipped, ...result } };
  } catch (err) {
    return { data: { success: false, error: err.message } };
  }
};

// ─── PDF Generation & Sending ──────────────────────────────────────

/** Draw a simple music note icon at (cx, cy) with given scale */
const drawMusicNote = (pdf, cx, cy, scale = 1) => {
  const s = scale;
  pdf.setFillColor(40, 40, 40);
  // Note head (filled ellipse)
  pdf.ellipse(cx - 2 * s, cy + 8 * s, 3.5 * s, 2.5 * s, "F");
  // Stem
  pdf.setLineWidth(0.8 * s);
  pdf.setDrawColor(40, 40, 40);
  pdf.line(cx + 1.2 * s, cy + 8 * s, cx + 1.2 * s, cy - 6 * s);
  // Flag
  pdf.setLineWidth(0.6 * s);
  pdf.line(cx + 1.2 * s, cy - 6 * s, cx + 5 * s, cy - 2 * s);
  pdf.line(cx + 1.2 * s, cy - 4 * s, cx + 5 * s, cy);
};

/** Format amount with currency symbol */
const fmtAmount = (amount, currency = "GBP") => {
  const num = Number(amount) || 0;
  const sym = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency + " ";
  return sym + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

/** Format date as DD/MM/YYYY */
const fmtDate = (dateStr) => {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return dateStr;
  }
};

const fnGenerateAndSendInvoice = async ({
  document_id,
  invoice_id, // backward compat alias
  send_email = false,
  recipient_email = "",
}) => {
  const docId = document_id || invoice_id;
  const found = await entities.Document.filter({ id: docId });
  const doc = found?.[0];
  if (!doc) return { data: { success: false, error: "Document not found" } };

  if (send_email) {
    const updates = {
      sent_date: new Date().toISOString(),
      client_email: recipient_email || doc.client_email || "",
    };
    if (doc.status === "draft") {
      updates.status = "sent";
      updates.is_locked = true;
      updates.locked_at = new Date().toISOString();
    }
    await entities.Document.update(doc.id, updates);
    await logDocumentActivity(doc.id, "sent", doc.status, updates.status || doc.status, {
      recipient: recipient_email || doc.client_email,
    });
    return { data: { success: true } };
  }

  // ─── Load related data ────────────────────────────────────────
  const profiles = await entities.BusinessProfile.list();
  const biz = profiles[0] || {};
  const settingsArr = await entities.AppSettings.list();
  const settings = settingsArr[0] || {};

  let client = null;
  if (doc.client_id) {
    const clients = await entities.Client.list();
    client = clients.find((c) => c.id === doc.client_id) || null;
  }

  let event = null;
  if (doc.work_event_id) {
    const events = await entities.WorkEvent.list();
    event = events.find((e) => e.id === doc.work_event_id) || null;
  }

  const typeLabel = doc.document_type === "estimate" ? "Estimate" : "Invoice";
  const currency = doc.currency || "GBP";

  // Calculate payment terms from gig date → due date (if both exist)
  let paymentTermsDays = doc.payment_terms_days || settings.default_payment_terms_days || 30;
  const gigDateStr = event?.date || "";
  const dueDateStr = doc.due_date || "";
  if (gigDateStr && dueDateStr) {
    const gig = new Date(gigDateStr);
    const due = new Date(dueDateStr);
    if (!isNaN(gig.getTime()) && !isNaN(due.getTime())) {
      const diffDays = Math.round((due - gig) / (1000 * 60 * 60 * 24));
      if (diffDays > 0) paymentTermsDays = diffDays;
    }
  }

  // ─── Generate PDF ─────────────────────────────────────────────
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pw = 210; // A4 width in mm
  const ml = 20;  // margin left
  const mr = 20;  // margin right
  const rCol = pw - mr; // right edge

  // Colors
  const black = [40, 40, 40];
  const gray = [120, 120, 120];
  const lineGray = [200, 200, 200];
  const payBg = [255, 249, 230]; // cream/yellow for payment box

  let y = 18;

  // ─── Music Note Logo (centered) ───────────────────────────────
  drawMusicNote(pdf, pw / 2, y, 1.2);
  y += 22;

  // ─── Business Info (left) + Invoice Details (right) ───────────
  const headerStartY = y;

  // Left: Business name (large)
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(...black);
  pdf.text(biz.business_name || "Business Name", ml, y);
  y += 6;

  // Left: Address lines
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...gray);
  if (biz.address_line_1) { pdf.text(biz.address_line_1, ml, y); y += 4; }
  if (biz.postcode) { pdf.text(biz.postcode, ml, y); y += 4; }
  if (biz.city) { pdf.text(biz.city, ml, y); y += 4; }
  if (biz.phone) { pdf.text(biz.phone, ml, y); y += 4; }
  if (biz.email) { pdf.text(biz.email, ml, y); y += 4; }

  // Right: "Invoice" title
  let ry = headerStartY;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.setTextColor(...black);
  pdf.text(typeLabel, rCol, ry, { align: "right" });
  ry += 8;

  // Right: Invoice details table
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...gray);
  const labelX = rCol - 40;
  const valX = rCol;

  const rightRows = [
    ["Invoice No:", doc.document_number || "—"],
    ["Date of the Gig:", fmtDate(event?.date || doc.due_date)],
    ["Terms:", `NET ${paymentTermsDays}`],
    ["Due Date:", fmtDate(doc.due_date)],
  ];

  for (const [label, value] of rightRows) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    pdf.text(label, labelX, ry, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...black);
    pdf.text(value, valX, ry, { align: "right" });
    ry += 5;
  }

  y = Math.max(y, ry) + 4;

  // ─── Horizontal separator ─────────────────────────────────────
  pdf.setDrawColor(...lineGray);
  pdf.setLineWidth(0.4);
  pdf.line(ml, y, rCol, y);
  y += 8;

  // ─── Bill To ──────────────────────────────────────────────────
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(...black);
  pdf.text("Bill To:", ml, y);

  const billX = ml + 18;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...black);

  if (client) {
    pdf.setFont("helvetica", "bold");
    pdf.text(client.name || "", billX, y);
    pdf.setFont("helvetica", "normal");
    y += 5;
    // Emails
    const emails = client.emails || [];
    if (emails.length) {
      pdf.setTextColor(...gray);
      pdf.text(emails.join(", "), billX, y);
      y += 4;
    }
    // Billing address
    if (client.billing_address) {
      const addrLines = client.billing_address.split(/[,\n]/).map((l) => l.trim()).filter(Boolean);
      for (const line of addrLines) {
        pdf.text(line, billX, y);
        y += 4;
      }
    } else if (event?.location_address) {
      // Fall back to event location
      const addrLines = event.location_address.split(/[,\n]/).map((l) => l.trim()).filter(Boolean);
      for (const line of addrLines) {
        pdf.text(line, billX, y);
        y += 4;
      }
    }
    // Phones
    const phones = client.phones || [];
    if (phones.length) {
      pdf.text(phones.join(", "), billX, y);
      y += 4;
    }
  } else {
    pdf.text("—", billX, y);
    y += 5;
  }

  y += 6;

  // ─── Line Items Header ────────────────────────────────────────
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...black);
  pdf.text("Description", ml, y);
  pdf.text("Amount", rCol, y, { align: "right" });
  y += 2;

  // Header underline
  pdf.setDrawColor(...lineGray);
  pdf.setLineWidth(0.4);
  pdf.line(ml, y, rCol, y);
  y += 6;

  // ─── Line Items ───────────────────────────────────────────────
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...black);

  const lineItems = doc.line_items || [];
  if (lineItems.length) {
    for (const item of lineItems) {
      const desc = item.description || "—";
      const amt = fmtAmount(item.total || item.unit_price || 0, currency);
      pdf.text(desc, ml, y);
      pdf.text(amt, rCol, y, { align: "right" });
      y += 6;
    }
  } else {
    pdf.text(doc.title || "Service", ml, y);
    pdf.text(fmtAmount(doc.subtotal || 0, currency), rCol, y, { align: "right" });
    y += 6;
  }

  y += 8;

  // ─── Payment Details Box (left) + Totals (right) ──────────────
  const boxX = ml;
  const boxW = 65;
  const boxH = 28;
  const boxY = y;

  // Payment details cream box
  pdf.setFillColor(...payBg);
  pdf.setDrawColor(220, 210, 180);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(boxX, boxY, boxW, boxH, 1, 1, "FD");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...black);
  pdf.text("Payment Details", boxX + 4, boxY + 6);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(80, 80, 80);
  const payTo = biz.bank_account_name || biz.contact_name || "";
  const account = biz.bank_account_number || "";
  const sortCode = biz.bank_sort_code || "";
  if (payTo) pdf.text(`Pay to : ${payTo}`, boxX + 4, boxY + 12);
  if (account) pdf.text(`Account : ${account}`, boxX + 4, boxY + 17);
  if (sortCode) pdf.text(`Sort Code : ${sortCode}`, boxX + 4, boxY + 22);

  // Totals (right side)
  const totalsLabelX = rCol - 45;
  const totalsValX = rCol;
  let ty = boxY + 2;

  const subtotal = Number(doc.subtotal) || 0;
  const discountAmt = Number(doc.discount_amount) || 0;
  const taxAmt = Number(doc.tax_amount) || 0;
  const total = Number(doc.total) || subtotal;
  const paidAmt = Number(doc.paid_amount) || 0;
  const balanceDue = total - paidAmt;

  const drawTotalRow = (label, value, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(bold ? 11 : 9);
    pdf.setTextColor(...black);
    pdf.text(label, totalsLabelX, ty, { align: "right" });
    pdf.text(value, totalsValX, ty, { align: "right" });
    ty += bold ? 7 : 5;
  };

  drawTotalRow("Subtotal", fmtAmount(subtotal, currency));
  if (discountAmt > 0) drawTotalRow("Discount", "-" + fmtAmount(discountAmt, currency));
  if (taxAmt > 0) drawTotalRow("Tax", fmtAmount(taxAmt, currency));
  drawTotalRow("Total", fmtAmount(total, currency));

  // Separator line
  pdf.setDrawColor(...lineGray);
  pdf.setLineWidth(0.3);
  pdf.line(totalsLabelX - 15, ty - 2, totalsValX, ty - 2);
  ty += 2;

  drawTotalRow("PAID", fmtAmount(paidAmt, currency));

  // Double line before balance due
  pdf.setDrawColor(...black);
  pdf.setLineWidth(0.5);
  pdf.line(totalsLabelX - 15, ty - 2, totalsValX, ty - 2);
  pdf.setLineWidth(0.3);
  pdf.line(totalsLabelX - 15, ty - 0.5, totalsValX, ty - 0.5);
  ty += 3;

  drawTotalRow("Balance Due", fmtAmount(balanceDue, currency), true);

  y = Math.max(boxY + boxH, ty) + 12;

  // ─── Notes ────────────────────────────────────────────────────
  if (doc.notes) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(...black);
    pdf.text("Notes", ml, y);
    y += 5;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    const noteLines = pdf.splitTextToSize(doc.notes, rCol - ml);
    pdf.text(noteLines, ml, y);
    y += noteLines.length * 4 + 4;
  }

  // ─── Page number ──────────────────────────────────────────────
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(...gray);
  pdf.text("1 / 1", pw / 2, 287, { align: "center" });

  const bytes = pdf.output("arraybuffer");
  return { data: bytes };
};

// ─── CSV Import (creates Documents instead of old Invoice) ─────────
const fnImportFromCSV = async ({ csv_text }) => {
  const rows = parseCsvText(csv_text || "");
  const createdDocuments = [];

  for (const row of rows) {
    const clientName = pick(row, ["client", "client_name", "venue", "name"]);
    const clientEmail = pick(row, ["client_email", "email"]);
    const address = pick(row, ["location", "address"]);
    const client = await ensureClient({
      name: clientName,
      email: clientEmail,
      address,
    });

    const title = pick(row, ["title", "event", "event_title"], "Imported Event");
    const date = pick(row, ["date"]);
    const amount = toNumber(pick(row, ["fee", "price", "amount", "subtotal"], "0"));
    const currency = pick(row, ["currency"], "GBP");

    let event = null;
    if (date) {
      event = await entities.WorkEvent.create({
        title,
        date,
        time: pick(row, ["time"]),
        client_id: client?.id || "",
        location_address: address,
        location_name: "",
        status: pick(row, ["status"], "confirmed"),
        event_type: pick(row, ["type", "event_type"], "Gig"),
        currency,
        total_price: amount,
        base_price: amount,
        notes: pick(row, ["notes"]),
      });
    }

    const docNumber = await getNextDocumentNumber("invoice");
    const document = await entities.Document.create({
      document_type: "invoice",
      document_number: docNumber,
      title: `Invoice - ${title}`,
      client_id: client?.id || "",
      client_email: clientEmail || "",
      status: "draft",
      currency,
      line_items: [
        {
          description: title,
          quantity: 1,
          unit_price: amount,
          total: amount,
        },
      ],
      subtotal: amount,
      total: amount,
      discount_type: null,
      discount_value: 0,
      discount_amount: 0,
      tax_rate: 0,
      tax_amount: 0,
      due_date: pick(row, ["due_date"], ""),
      work_event_id: event?.id || "",
      is_standalone: !event,
      is_locked: false,
      paid_amount: 0,
      notes: pick(row, ["notes"]),
    });

    createdDocuments.push(document);
  }

  return {
    data: {
      success: true,
      imported: createdDocuments.length,
      documents: createdDocuments,
    },
  };
};

const fnImportInvoicesCSV = async ({ rows = [] }) => {
  const result = {
    documents_created: 0,
    events_created: 0,
    clients_created: 0,
    skipped: 0,
    errors: [],
  };

  // Strip "Not in source" placeholder values
  const clean = (val) => {
    const s = (val || "").trim();
    return s.toLowerCase() === "not in source" ? "" : s;
  };

  // Clean all row values before processing
  const cleanRow = (row) => {
    const r = {};
    for (const [k, v] of Object.entries(row)) {
      r[k] = clean(v);
    }
    return r;
  };

  // Map CSV status values to our internal statuses
  const mapStatus = (raw) => {
    const s = (raw || "").toLowerCase().trim();
    if (s === "paid" || s === "fully_paid") return "paid";
    if (s === "sent" || s === "opened") return "sent";
    return "draft"; // unsent, draft, empty, or unknown
  };

  // Pre-load existing clients and events for deduplication
  const allClients = await entities.Client.list();
  const allEvents = await entities.WorkEvent.list();
  const allDocuments = await entities.Document.list();

  // Build lookup caches
  const clientCache = {};
  allClients.forEach((c) => {
    clientCache[(c.name || "").toLowerCase()] = c;
  });
  const eventCache = {};
  allEvents.forEach((e) => {
    const key = `${(e.title || "").toLowerCase()}|${e.date || ""}`;
    eventCache[key] = e;
  });
  // Track existing invoice numbers to avoid duplicates
  const existingInvNumbers = new Set(
    allDocuments.map((d) => d.invoice_number).filter(Boolean)
  );

  for (let i = 0; i < rows.length; i += 1) {
    const r = cleanRow(rows[i]);
    try {
      const invoiceNumber = pick(r, ["invoice_number"]);

      // Skip if this invoice number was already imported
      if (invoiceNumber && existingInvNumbers.has(invoiceNumber)) {
        result.skipped += 1;
        continue;
      }

      // ── Client ──────────────────────────────────────────────
      const clientName = pick(r, ["client_name", "client", "venue"]);
      const clientEmailRaw = pick(r, ["client_email", "email"]);
      const clientPhone = pick(r, ["client_phone", "phone"]);
      const clientType = pick(r, ["client_type"]);

      // Handle multiple comma-separated emails
      const clientEmails = clientEmailRaw
        ? clientEmailRaw.split(",").map((e) => e.trim()).filter(Boolean)
        : [];

      let client = null;
      if (clientName) {
        const cacheKey = clientName.toLowerCase();
        if (clientCache[cacheKey]) {
          client = clientCache[cacheKey];
          // Enrich existing client with any new data
          const updates = {};
          const existingEmails = client.emails || [];
          const newEmails = clientEmails.filter((e) => !existingEmails.includes(e));
          if (newEmails.length) {
            updates.emails = [...existingEmails, ...newEmails];
          }
          if (clientPhone && !(client.phones || []).includes(clientPhone)) {
            updates.phones = [...(client.phones || []), clientPhone];
          }
          if (clientType && !client.client_type) {
            updates.client_type = clientType;
          }
          if (Object.keys(updates).length) {
            client = await entities.Client.update(client.id, updates);
            clientCache[cacheKey] = client;
          }
        } else {
          client = await entities.Client.create({
            name: clientName,
            emails: clientEmails,
            phones: clientPhone ? [clientPhone] : [],
            client_type: clientType || "other",
            default_currency: "GBP",
            default_payment_terms_days: 30,
          });
          clientCache[cacheKey] = client;
          result.clients_created += 1;
        }
      }

      // ── Event ───────────────────────────────────────────────
      const eventTitle = pick(r, ["event_title"]) || pick(r, ["invoice_title", "title"]);
      const eventDate = pick(r, ["event_date", "date"]);
      const eventType = pick(r, ["event_type", "type"], "Gig");
      const eventLocation = pick(r, ["event_location_address", "location_address", "location"]);
      const eventStatus = pick(r, ["event_status"], "confirmed");
      const eventTime = pick(r, ["event_time", "time"]);
      const basePrice = toNumber(pick(r, ["base_price"], "0"));
      const currency = pick(r, ["currency"], "GBP");

      let event = null;
      if (eventDate && eventTitle) {
        const eventCacheKey = `${eventTitle.toLowerCase()}|${eventDate}`;
        if (eventCache[eventCacheKey]) {
          event = eventCache[eventCacheKey];
        } else {
          event = await entities.WorkEvent.create({
            title: eventTitle,
            date: eventDate,
            time: eventTime,
            client_id: client?.id || "",
            location_address: eventLocation,
            location_name: "",
            status: eventStatus,
            event_type: eventType,
            currency,
            total_price: basePrice,
            base_price: basePrice,
          });
          eventCache[eventCacheKey] = event;
          result.events_created += 1;
        }
      }

      // ── Invoice ─────────────────────────────────────────────
      const invoiceTitle = pick(r, ["invoice_title", "title"], `Imported #${i + 1}`);
      const subtotal = toNumber(pick(r, ["subtotal", "amount"], "0"));
      const status = mapStatus(pick(r, ["invoice_status", "status"]));
      const notes = pick(r, ["notes"]);
      const sentDate = pick(r, ["sent_date"]);
      const paidDate = pick(r, ["paid_date"]);
      const paidAmount = toNumber(pick(r, ["paid_amount"], "0"));
      const paymentMethod = pick(r, ["payment_method"]);
      const dueDate = pick(r, ["due_date"]);

      // Skip truly empty rows (no title, no amount, no client)
      if (!invoiceTitle && subtotal === 0 && !clientName) {
        result.skipped += 1;
        continue;
      }

      const isLocked = status === "paid" || status === "sent";
      // Use original invoice number as document_number when available
      const docNumber = invoiceNumber || await getNextDocumentNumber("invoice");

      await entities.Document.create({
        document_type: "invoice",
        document_number: docNumber,
        invoice_number: invoiceNumber || docNumber,
        title: invoiceTitle,
        client_id: client?.id || "",
        client_email: clientEmails[0] || "",
        status,
        currency,
        subtotal,
        total: subtotal,
        discount_type: null,
        discount_value: 0,
        discount_amount: 0,
        tax_rate: 0,
        tax_amount: 0,
        due_date: dueDate,
        line_items: subtotal > 0
          ? [{ description: invoiceTitle, quantity: 1, unit_price: subtotal, total: subtotal }]
          : [],
        work_event_id: event?.id || "",
        is_standalone: !event,
        is_locked: isLocked,
        locked_at: isLocked ? new Date().toISOString() : "",
        paid_amount: paidAmount,
        paid_date: paidDate,
        payment_method: paymentMethod,
        notes,
        sent_date: sentDate,
      });

      if (invoiceNumber) existingInvNumbers.add(invoiceNumber);
      result.documents_created += 1;
    } catch (error) {
      result.errors.push({ row: i + 1, error: error.message || "Import failed" });
    }
  }

  return { data: { success: true, results: result } };
};

// ─── Function Dispatch ─────────────────────────────────────────────
const functionHandlers = {
  createRecurringEvents: fnCreateRecurringEvents,
  generateAndSendInvoice: fnGenerateAndSendInvoice,
  importFromCSV: fnImportFromCSV,
  importInvoicesCSV: fnImportInvoicesCSV,
  syncToGoogleCalendar: fnSyncToGoogleCalendar,
};

// ─── Exported App Client ───────────────────────────────────────────
export const appClient = {
  entities,
  functions: {
    async invoke(name, payload = {}) {
      const fn = functionHandlers[name];
      if (!fn) {
        return { data: { success: false, error: `Function ${name} is not available locally` } };
      }
      return fn(payload);
    },
  },
  auth: {
    async me() {
      if (isPreviewModeEnabled()) return PREVIEW_USER;
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user;
    },
    async logout(redirectTo) {
      if (isPreviewModeEnabled()) {
        if (redirectTo) window.location.href = redirectTo;
        return;
      }
      const supabase = getSupabaseClient();
      await supabase.auth.signOut();
      if (redirectTo) window.location.href = redirectTo;
    },
    redirectToLogin(redirectTo) {
      if (redirectTo) window.location.href = redirectTo;
    },
  },
  // Exported helpers for direct use by pages
  helpers: {
    getNextDocumentNumber,
    calculateDocumentTotals,
    convertEstimateToInvoice,
    recordPayment,
    logDocumentActivity,
    lockDocument,
    unlockDocument,
    buildClientMap,
    ensureSingletonEntity,
    createRecurringSeries,
    topUpRecurringSeries,
    buildInvoiceFromEvents,
    applyToUpcomingInSeries,
  },
};
