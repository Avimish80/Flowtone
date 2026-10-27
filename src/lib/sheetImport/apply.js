// Writes the ticked changes and remembers how to take them back. Every record
// created and every field overwritten goes into an undo batch, saved after
// each write, so even an import that stops halfway can be undone. Undo puts
// back only what the import itself left: anything changed since stays.
import { appClient } from "@/api/appClient";
import { authStorageKey, isPreviewModeEnabled } from "@/lib/supabaseClient";
import { deleteCalendarEvent } from "@/lib/calendarClient";
import { appendNotes, numberKey } from "./plan";

const STACK_KEY = "flowtone_sheet_imports";
const KEEP = 5;
const RANK = { draft: 0, sent: 1, paid: 2 };
const round2 = (n) => Math.round(n * 100) / 100;

const ENTITY = {
  WorkEvent: () => appClient.entities.WorkEvent,
  Client: () => appClient.entities.Client,
  Document: () => appClient.entities.Document,
  Payment: () => appClient.entities.Payment,
};

// ── The undo stack (newest last), one per account ─────────────────
function stackKey() {
  if (isPreviewModeEnabled()) return `${STACK_KEY}:preview`;
  let userId = "anon";
  try { userId = JSON.parse(localStorage.getItem(authStorageKey()))?.user?.id || "anon"; } catch { /* ignore */ }
  return `${STACK_KEY}:${userId}`;
}

function readStack() {
  try {
    const list = JSON.parse(localStorage.getItem(stackKey()));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writeStack(list) {
  try { localStorage.setItem(stackKey(), JSON.stringify(list.slice(-KEEP))); } catch { /* storage full/blocked */ }
}

function saveBatch(batch) {
  writeStack([...readStack().filter((b) => b.id !== batch.id), batch]);
}

/** The most recent import that can still be undone, or null. */
export function getLastImport() {
  const list = readStack();
  return list[list.length - 1] || null;
}

// The batch being written right now. It keeps going if the user leaves the
// screen, so the screen checks this before offering another import or an undo.
let running = null;
export function importInProgress() {
  return running;
}

const fetchOne = async (entity, id) => (await ENTITY[entity]().filter({ id }))[0] || null;

// Values as compared for undo: "" and missing are the same, "850" and 850 too.
function same(a, b) {
  const norm = (v) => (v === undefined || v === "" ? null : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * rows: [{ index, plan, event }] where plan.changes carry `checked` and event
 * is the gig the row was matched to (null for a new gig).
 * → { batch, counts, errors: [{ index, message }] }
 */
export async function applyImport(rows, { fileName, onProgress } = {}) {
  if (running) throw new Error("An import is still being saved. Wait for it to finish.");
  const batch = { id: crypto.randomUUID(), fileName, at: new Date().toISOString(), created: [], updated: [], settings: null, done: false };
  running = batch;
  try {
    return await write(rows, batch, { fileName, onProgress });
  } finally {
    running = null;
  }
}

async function write(rows, batch, { fileName, onProgress }) {
  const counts = { updated: 0, created: 0, invoices: 0, paid: 0, clients: 0 };
  const errors = [];
  const tag = { import_batch: batch.id };
  const ticked = (plan) => plan.changes.filter((c) => c.checked && !c.info);
  const invoiceSteps = rows.reduce((n, r) => n + ticked(r.plan).filter((c) => c.key === "invoice" || c.key === "invoice_status").length, 0);
  const steps = rows.length + invoiceSteps;
  let done = 0;
  const step = () => onProgress?.(++done, steps);

  const created = (entity, record, snapshot = {}) => {
    batch.created.push({ entity, id: record.id, snapshot });
    saveBatch(batch);
    return record;
  };
  // Saved before the write (so a crash mid-write is still covered), then
  // again with the values as stored, which undo compares against.
  const update = async (entity, current, fields) => {
    const entry = {
      entity,
      id: current.id,
      before: Object.fromEntries(Object.keys(fields).map((k) => [k, current[k] ?? null])),
      after: fields,
    };
    batch.updated.push(entry);
    saveBatch(batch);
    const saved = await ENTITY[entity]().update(current.id, fields);
    entry.after = Object.fromEntries(Object.keys(fields).map((k) => [k, saved?.[k] ?? null]));
    saveBatch(batch);
    return saved;
  };

  const [clients, settings, documents] = await Promise.all([
    appClient.entities.Client.list(),
    appClient.helpers.ensureSingletonEntity("AppSettings"),
    appClient.entities.Document.list(),
  ]);
  const clientByName = new Map(clients.map((c) => [String(c.name || "").trim().toLowerCase(), c]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  async function clientFor(name) {
    const key = String(name || "").trim().toLowerCase();
    if (!key) return null;
    if (clientByName.has(key)) return clientByName.get(key);
    const client = created("Client", await appClient.entities.Client.create({
      name: String(name).trim(), client_type: "other", emails: [], phones: [],
      default_currency: settings.default_currency || settings.currency || "GBP", default_payment_terms_days: 30, ...tag,
    }));
    clientByName.set(key, client);
    clientById.set(client.id, client);
    counts.clients++;
    return client;
  }

  // The invoice counter moves past the imported numbers before any invoice is
  // written, so even an import cut short never leaves the app about to hand
  // out a number that is already taken.
  const prefix = settings.invoice_number_prefix || "INV-";
  const letters = prefix.replace(/[^A-Z]/gi, "").toUpperCase();
  const planned = rows.flatMap((r) => ticked(r.plan))
    .filter((c) => c.key === "invoice" && c.invoice.document_number.replace(/[^A-Z]/gi, "").toUpperCase() === letters)
    .map((c) => numberKey(c.invoice.document_number))
    .filter((n) => n != null);
  if (planned.length) {
    const next = Math.max(...planned) + 1;
    if (next > (settings.invoice_number_next || 1)) {
      batch.settings = { id: settings.id, before: settings.invoice_number_next || 1, after: next };
      saveBatch(batch);
      await appClient.entities.AppSettings.update(settings.id, { invoice_number_next: next });
    }
  }

  // ── Gigs first, so every invoice can point at its gigs ──
  const gigOf = new Map();
  for (const { index, plan, event } of rows) {
    const on = ticked(plan);
    try {
      if (plan.kind === "new") {
        const create = on.find((c) => c.key === "create");
        if (create) {
          const fee = on.find((c) => c.key === "fee");
          const client = await clientFor(on.find((c) => c.key === "client")?.clientName || create.clientName);
          const gig = await appClient.entities.WorkEvent.create({ ...create.gig, ...(fee?.fields || {}), client_id: client?.id || null, ...tag });
          created("WorkEvent", gig, { title: gig.title, date: gig.date, status: gig.status, total_price: gig.total_price, notes: gig.notes, client_id: gig.client_id });
          gigOf.set(index, gig);
          counts.created++;
        }
      } else if (event) {
        gigOf.set(index, event);
        const gigChanges = on.filter((c) => c.fields || c.key === "client" || c.key === "notes");
        if (gigChanges.length) {
          const current = await fetchOne("WorkEvent", event.id);
          if (!current) throw new Error("This gig is no longer in Flowtone.");
          const fields = {};
          for (const c of gigChanges) {
            if (c.fields) Object.assign(fields, c.fields);
            if (c.key === "client") fields.client_id = (await clientFor(c.clientName))?.id || null;
            if (c.key === "notes") fields.notes = appendNotes(current.notes, c.noteLines, fileName);
          }
          gigOf.set(index, await update("WorkEvent", current, fields));
          counts.updated++;
        }
      }
    } catch (err) {
      errors.push({ index, message: err?.message || String(err) });
    }
    step();
  }

  // ── Then invoices and payments ──
  const takenNumbers = new Set(documents
    .filter((d) => d.document_type === "invoice")
    .flatMap((d) => [numberKey(d.document_number), numberKey(d.invoice_number)])
    .filter((k) => k != null));
  const movedDocs = new Set();

  async function writeInvoice(change, gigs) {
    const primary = gigs[0] || null;
    const client = (primary?.client_id && clientById.get(primary.client_id)) || await clientFor(change.invoice.client_name);
    const doc = await appClient.entities.Document.create({
      ...change.invoice,
      client_id: client?.id || "",
      client_name: client?.name || change.invoice.client_name,
      client_email: change.invoice.client_email || client?.emails?.[0] || "",
      work_event_id: primary?.id || "",
      ...(gigs.length > 1 ? { work_event_ids: gigs.map((g) => g.id) } : {}),
      is_standalone: !primary,
      ...tag,
    });
    created("Document", doc, { status: doc.status, total: doc.total, gigs: gigs.map((g) => g.id) });
    counts.invoices++;
    if (change.payment?.amount > 0) {
      const payment = await appClient.entities.Payment.create({
        document_id: doc.id, amount: change.payment.amount, payment_date: change.payment.payment_date || null,
        payment_method: change.invoice.payment_method || "", reference: doc.document_number,
        notes: `Imported from ${fileName}`, ...tag,
      });
      created("Payment", payment, { document_id: doc.id });
    }
    // A multi-gig invoice is stamped on each of its gigs, as the app does
    // for its own, so none of them is offered for billing again.
    if (gigs.length > 1) {
      for (const g of gigs) {
        const current = await fetchOne("WorkEvent", g.id);
        if (current) await update("WorkEvent", current, { invoice_id: doc.id, invoice_status: doc.status });
      }
    }
  }

  async function moveInvoice(change, gig) {
    const doc = await fetchOne("Document", change.docId);
    if (!doc) throw new Error(`${change.docNumber} is no longer in Flowtone.`);
    if ((RANK[change.status] ?? -1) <= (RANK[doc.status] ?? 99)) return;
    const total = Number(doc.total) || 0;
    const paidSoFar = Number(doc.paid_amount) || 0;
    const fields = { status: change.status, sent_date: doc.sent_date || change.sentDate, is_locked: true, locked_at: doc.locked_at || new Date().toISOString() };
    if (change.status === "paid") Object.assign(fields, { paid_date: change.paidDate || doc.paid_date || null, paid_amount: total });
    if (change.link && gig && !doc.work_event_id) Object.assign(fields, { work_event_id: gig.id, is_standalone: false });
    await update("Document", doc, fields);
    if (change.status === "paid" && total - paidSoFar > 0.005) {
      const payment = await appClient.entities.Payment.create({
        document_id: doc.id, amount: round2(total - paidSoFar), payment_date: change.paidDate || null,
        payment_method: doc.payment_method || "", reference: doc.document_number, notes: `Imported from ${fileName}`, ...tag,
      });
      created("Payment", payment, { document_id: doc.id });
    }
    counts.paid++;
  }

  for (const { index, plan } of rows) {
    for (const c of ticked(plan)) {
      if (c.key !== "invoice" && c.key !== "invoice_status") continue;
      try {
        if (c.key === "invoice") {
          const k = numberKey(c.invoice.document_number);
          if (takenNumbers.has(k)) {
            errors.push({ index, message: `${c.invoice.document_number} is already in Flowtone, so it was not created again.` });
          } else {
            takenNumbers.add(k);
            await writeInvoice(c, (c.rowIndexes || [index]).map((i) => gigOf.get(i)).filter(Boolean));
          }
        } else if (!movedDocs.has(c.docId)) {
          movedDocs.add(c.docId);
          await moveInvoice(c, gigOf.get(index));
        }
      } catch (err) {
        errors.push({ index, message: err?.message || String(err) });
      }
      step();
    }
  }

  batch.done = true;
  batch.counts = counts;
  batch.errors = errors.length;
  if (batch.created.length || batch.updated.length || batch.settings) saveBatch(batch);
  return { batch, counts, errors };
}

/**
 * Takes an import back: removes what it created and restores what it
 * changed, except where something has changed since (a fee edited by hand,
 * an invoice sent or paid, a gig with an invoice of its own): those stay.
 * A write that fails is kept in the batch so Undo can be tried again.
 * → { failed, kept }
 */
export async function undoImport(batch, { onProgress } = {}) {
  if (running) throw new Error("An import is still being saved. Wait for it to finish.");
  if (!batch) return { failed: 0, kept: 0 };
  const steps = batch.updated.length + batch.created.length + (batch.settings ? 1 : 0);
  let done = 0;
  const step = () => onProgress?.(++done, steps);
  const failed = { created: [], updated: [] };
  let settingsFailed = false;
  let kept = 0;
  // Records left as they are because they changed since; what hangs off them
  // (an invoice's payment, a gig's invoice) stays with them.
  const keptIds = new Set();

  for (const u of [...batch.updated].reverse()) {
    try {
      const current = await fetchOne(u.entity, u.id);
      if (current) {
        // All or nothing: half a fee or half a payment put back is worse than none.
        if (Object.keys(u.before).every((k) => same(current[k], u.after[k]))) await ENTITY[u.entity]().update(u.id, u.before);
        else { kept++; keptIds.add(u.id); }
      }
    } catch {
      failed.updated.push(u);
      keptIds.add(u.id);
    }
    step();
  }

  const createdIds = new Set(batch.created.map((c) => c.id));
  // Invoices are decided before their payments, gigs after their invoices.
  const order = ["Document", "Payment", "WorkEvent", "Client"];
  const createdInOrder = [...batch.created].sort((a, b) => order.indexOf(a.entity) - order.indexOf(b.entity));
  for (const c of createdInOrder) {
    try {
      if (c.entity === "Document") {
        const doc = await fetchOne("Document", c.id);
        if (doc) {
          const payments = await appClient.entities.Payment.filter({ document_id: c.id });
          const changed = doc.status !== c.snapshot?.status || !same(doc.total, c.snapshot?.total);
          if (changed || payments.some((p) => !createdIds.has(p.id))) { kept++; keptIds.add(c.id); }
          else await appClient.entities.Document.delete(c.id);
        }
      } else if (c.entity === "Payment") {
        if (!keptIds.has(c.snapshot?.document_id)) await appClient.entities.Payment.delete(c.id);
      } else if (c.entity === "WorkEvent") {
        const gig = await fetchOne("WorkEvent", c.id);
        if (gig) {
          const docs = await appClient.entities.Document.filter({ work_event_id: c.id });
          const changed = Object.entries(c.snapshot || {}).some(([k, v]) => !same(gig[k], v));
          const onKeptInvoice = batch.created.some((d) => d.entity === "Document" && keptIds.has(d.id) && d.snapshot?.gigs?.includes(c.id));
          if (changed || onKeptInvoice || docs.some((d) => !createdIds.has(d.id) || keptIds.has(d.id))) {
            kept++;
          } else {
            // The calendar sync may already have copied it to Google.
            await deleteCalendarEvent(gig.google_calendar_event_id);
            await appClient.entities.WorkEvent.delete(c.id);
          }
        }
      } else if (c.entity === "Client") {
        // A client the user has since used elsewhere stays.
        const [events, docs] = await Promise.all([
          appClient.entities.WorkEvent.filter({ client_id: c.id }),
          appClient.entities.Document.filter({ client_id: c.id }),
        ]);
        if (!events.length && !docs.length) await appClient.entities.Client.delete(c.id);
      }
    } catch {
      failed.created.push(c);
    }
    step();
  }

  if (batch.settings) {
    try {
      const s = await appClient.helpers.ensureSingletonEntity("AppSettings");
      // Only if no invoice has been numbered since.
      if ((s.invoice_number_next || 1) === batch.settings.after) {
        await appClient.entities.AppSettings.update(s.id, { invoice_number_next: batch.settings.before });
      }
    } catch {
      settingsFailed = true;
    }
    step();
  }

  const failedCount = failed.created.length + failed.updated.length + (settingsFailed ? 1 : 0);
  if (failedCount) {
    saveBatch({ ...batch, created: failed.created, updated: failed.updated, settings: settingsFailed ? batch.settings : null, retry: true });
  } else {
    writeStack(readStack().filter((b) => b.id !== batch.id));
  }
  return { failed: failedCount, kept };
}
