// Works out, row by row, what the spreadsheet would change. Nothing is written
// here. A row matched to a gig gets a list of changes, each with a tick box:
// filling something blank is ticked, replacing something already there is
// not, and a guess (a fee or client read out of the gig's name) waits for the
// user. A row with no gig becomes a new gig (unticked when it is cancelled or
// repeats another row). Rows sharing one invoice number become one invoice.
import { addDays, format, parseISO } from "date-fns";
import { currencySymbol } from "@/utils";
import {
  parseDate, parseMoney, feeFromName, parseExtras, gigStatusFrom, paidCellState,
  invoiceStatusFrom, invoiceNumberFrom, isCash, similarity,
} from "./values";

const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const sum = (list) => list.reduce((s, a) => s + a.amount, 0);
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n, symbol) => `${symbol}${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
const niceDate = (d) => { try { return format(parseISO(d), "d MMM yyyy"); } catch { return d || ""; } };
const STATUS_RANK = { draft: 0, sent: 1, paid: 2 };
const DAY = 86400000;
const dayDiff = (a, b) => Math.round(Math.abs(Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / DAY);

function typeFrom(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(lesson|student|tuition|teaching|class)\b/.test(t)) return "Lesson";
  if (/\brehears/.test(t)) return "Rehearsal";
  if (/\b(studio|recording)\b/.test(t)) return "Session";
  return null;
}

/**
 * Raw mapped cells → clean values for one row. index = its place in the list,
 * line = its line number in the spreadsheet, order = "dmy" | "mdy" for the
 * file's numeric dates.
 */
export function readRow(raw, { feeInNameMapped, order = "dmy", index = 0, line } = {}) {
  const title = clean(raw.title);
  const invoiceAmount = parseMoney(raw.invoice_amount);
  let base = parseMoney(raw.fee);
  let feeSource = "fee column";
  if (base == null && invoiceAmount != null) { base = invoiceAmount; feeSource = "invoice amount"; }
  if (base == null && feeInNameMapped) { base = parseMoney(raw.fee_in_name); feeSource = "fee in name"; }
  if (base == null && !feeInNameMapped) { base = feeFromName(title); feeSource = "guess"; }
  const extras = parseExtras(raw.extras, base);
  let adjustments = extras.adjustments;
  // An invoice amount already includes the extras: split them back out, or
  // keep the amount whole when they do not fit inside it.
  if (feeSource === "invoice amount" && adjustments.length) {
    if (base - sum(adjustments) > 0) base = round2(base - sum(adjustments));
    else adjustments = [];
  }

  const paidCell = clean(raw.paid);
  const statusCell = clean(raw.status);
  const invoiceCell = clean(raw.invoice_status);
  const occasion = clean(raw.occasion);
  const paidState = paidCellState(raw.paid);
  // A payment date typed into the paid column is the date it was paid.
  const paidCellDate = paidState === "paid" && !/^(yes|y|paid|true|x|checked|1|received|done|settled|cleared)$/i.test(paidCell)
    ? parseDate(paidCell.replace(/^(paid|received|settled)\s*(on\s*)?[:,-]?\s*/i, ""), order) : null;
  const partPaid = paidState === "partial" || /\b(part|partly|partial|partially|deposit|half|instal?ments?)\b/i.test(invoiceCell);
  return {
    index,
    line: line ?? index + 2,
    date: parseDate(raw.date, order),
    title,
    client: clean(raw.client),
    location: clean(raw.location),
    occasion,
    eventType: typeFrom(occasion) || typeFrom(title),
    fee: base == null ? null : { base, adjustments, total: round2(base + sum(adjustments)), source: feeSource },
    extraNotes: extras.notes,
    paymentMethod: clean(raw.payment_method),
    cancelled: gigStatusFrom(statusCell) === "cancelled",
    provisional: /\boption\b|provisional|pencil|tentative|\bhold\b|enquiry/i.test([statusCell, title, clean(raw.notes)].join(" ")),
    invoiceNumberRaw: clean(raw.invoice_number),
    invoiceNumber: invoiceNumberFrom(raw.invoice_number),
    invoiceAmount,
    invoiceStatus: invoiceStatusFrom(raw.invoice_status, raw.paid),
    partPaid: partPaid ? (invoiceCell || paidCell) : "",
    paidCell,
    paidDate: parseDate(raw.paid_date, order) || paidCellDate,
    dueDate: parseDate(raw.due_date, order),
    notes: clean(raw.notes).split(/;\s*|\s*\|\s*/).map((s) => s.trim()).filter(Boolean),
  };
}

/**
 * When several rows show the same invoice number and the same amount, that
 * amount is the invoice's total, not each gig's fee: those rows lose a fee
 * that was only taken from it.
 */
export function dropSharedInvoiceFees(rows) {
  const groups = new Map();
  rows.forEach((r) => {
    const k = numberKey(r.invoiceNumber);
    if (k != null) groups.set(k, [...(groups.get(k) || []), r.invoiceAmount]);
  });
  return rows.map((r) => {
    const list = groups.get(numberKey(r.invoiceNumber)) || [];
    const shared = list.length > 1 && isShared(list);
    return shared && r.fee?.source === "invoice amount" ? { ...r, fee: null } : r;
  });
}

// Every row of the group shows an amount, and it is the same one.
const isShared = (amounts) => amounts.every((a) => a != null && Math.abs(a - amounts[0]) < 0.005);

/** "430" → "INV-0430" (the app's own format); "INV-430" stays as written. */
export function documentNumberFor(number, prefix = "INV-") {
  const m = String(number).match(/^([A-Z]*)[-_ ]?(\d+)$/i);
  const letters = prefix.replace(/[^A-Z]/gi, "").toUpperCase();
  // "430", "INV430" and "INV 430" are the app's own numbering: write them its way.
  if (m && (!m[1] || m[1].toUpperCase() === letters)) return `${prefix}${String(Number(m[2])).padStart(4, "0")}`;
  return number;
}

/** "INV-0430", "inv 430", "430" all name invoice 430. */
export function numberKey(n) {
  const m = String(n || "").toUpperCase().match(/^([A-Z]*)[-_ ]?0*(\d+)$/);
  return m ? Number(m[2]) : null;
}

/** Everything the planner needs to look things up, built once. */
export function makeContext({ events, clients, documents, settings, fileName, today, sheetClients = [] }) {
  const clientsById = Object.fromEntries(clients.map((c) => [c.id, c]));
  const invoices = documents.filter((d) => d.document_type === "invoice");
  const docsByNumber = new Map();
  for (const d of invoices) {
    for (const n of [d.document_number, d.invoice_number]) {
      const k = numberKey(n);
      if (k != null && !docsByNumber.has(k)) docsByNumber.set(k, d);
    }
  }
  const docsByEvent = new Map();
  for (const d of invoices) {
    if (d.status === "void" || d.status === "cancelled") continue;
    for (const id of new Set([d.work_event_id, ...(Array.isArray(d.work_event_ids) ? d.work_event_ids : [])].filter(Boolean))) {
      docsByEvent.set(id, [...(docsByEvent.get(id) || []), d]);
    }
  }
  return {
    eventsById: Object.fromEntries(events.map((e) => [e.id, e])),
    clientsById,
    clientNames: [...new Set([...clients.map((c) => c.name), ...sheetClients].map(clean).filter(Boolean))],
    docsByNumber,
    docsByEvent,
    prefix: settings?.invoice_number_prefix || "INV-",
    currency: settings?.default_currency || settings?.currency || "GBP",
    symbol: currencySymbol(settings?.default_currency || settings?.currency || "GBP"),
    fileName,
    today,
  };
}

/**
 * Rows whose invoice number is already on a gig's invoice in Flowtone belong
 * to that gig, whatever the calendar says, as long as the dates are within a
 * month (a number reused for something else should not drag a row across the
 * year). A number shared by several rows decides nothing.
 * → Map(row index → gig id)
 */
export function invoiceAnchors(rows, ctx) {
  const count = new Map();
  rows.forEach((r) => { const k = numberKey(r.invoiceNumber); if (k != null) count.set(k, (count.get(k) || 0) + 1); });
  const anchors = new Map();
  rows.forEach((r, i) => {
    const k = numberKey(r.invoiceNumber);
    if (k == null || count.get(k) !== 1 || !r.date) return;
    const gig = ctx.eventsById[ctx.docsByNumber.get(k)?.work_event_id];
    if (gig?.date && dayDiff(gig.date, r.date) <= 31) anchors.set(i, gig.id);
  });
  return anchors;
}

function noteLines(row, { paidHandled }) {
  const lines = [];
  if (row.occasion && !typeFrom(row.occasion)) lines.push(`Occasion: ${row.occasion}`);
  if (row.paymentMethod) {
    if (isCash(row.paymentMethod)) lines.push(row.invoiceStatus === "paid" ? "Paid in cash" : "Payment method: cash");
    else if (!/^invoice/i.test(row.paymentMethod)) lines.push(`Payment method: ${row.paymentMethod}`);
  }
  lines.push(...row.extraNotes.map((n) => `Extra: ${n}`));
  if (row.invoiceNumberRaw && !row.invoiceNumber) lines.push(`Invoice number in the spreadsheet: "${row.invoiceNumberRaw}"`);
  if (row.partPaid) lines.push(`Part paid: ${row.partPaid}`);
  if (!paidHandled && !row.invoiceNumber) {
    if (row.invoiceStatus === "paid") lines.push(row.paidDate ? `Paid on ${niceDate(row.paidDate)} (no invoice number)` : "Marked paid in the spreadsheet (no invoice number)");
    else if (/paid/i.test(row.paidCell) && !/^(un|not|no)\b/i.test(row.paidCell)) lines.push(`Paid: ${row.paidCell}`);
  }
  lines.push(...row.notes);
  return lines;
}

const notesFrom = (lines, fileName) => `From ${fileName}:\n${lines.map((l) => `- ${l}`).join("\n")}`;

const info = (to) => ({ key: "invoice_info", info: true, label: "Invoice", to });

// Moves an invoice already in Flowtone up to the sheet's status (draft → sent
// → paid). The amounts are worked out when it is written, from the invoice as
// it is then.
function statusChange(doc, status, row, gigDate, { label, link, checked = true } = {}) {
  return {
    key: "invoice_status",
    label: label || `Invoice ${doc.document_number}`,
    from: doc.status,
    to: status === "paid" && row.paidDate ? `paid ${niceDate(row.paidDate)}` : status,
    checked,
    docId: doc.id,
    docNumber: doc.document_number,
    status,
    paidDate: status === "paid" ? row.paidDate || null : null,
    sentDate: gigDate,
    // A standalone invoice gets linked to this row's gig.
    link: !!link,
  };
}

function invoiceChanges(row, event, ctx, clientName) {
  const gigDate = row.date || event?.date || ctx.today;
  const status = row.invoiceStatus;

  // No number: a paid/sent row can still move this gig's one invoice along.
  if (!row.invoiceNumber) {
    if (!event || !status) return [];
    const live = ctx.docsByEvent.get(event.id) || [];
    if (live.length > 1) return [info(`The spreadsheet says ${status}, but this gig has ${live.length} invoices, so none was changed.`)];
    if (live.length === 1 && (STATUS_RANK[status] ?? -1) > (STATUS_RANK[live[0].status] ?? 99)) {
      return [statusChange(live[0], status, row, gigDate, { label: `Invoice ${live[0].document_number} (this gig's)` })];
    }
    return [];
  }

  const docNumber = documentNumberFor(row.invoiceNumber, ctx.prefix);
  const target = status || "draft";
  const existing = ctx.docsByNumber.get(numberKey(row.invoiceNumber));
  if (existing) {
    const gigs = [existing.work_event_id, ...(existing.work_event_ids || [])].filter(Boolean);
    if (gigs.length && !(event && gigs.includes(event.id))) {
      const owner = ctx.eventsById[existing.work_event_id];
      return [info(`${existing.document_number} is already on ${owner ? `"${clean(owner.title)}" (${niceDate(owner.date)})` : "another gig"}. Left alone.`)];
    }
    if ((STATUS_RANK[target] ?? -1) > (STATUS_RANK[existing.status] ?? 99)) {
      return [statusChange(existing, target, row, gigDate, { link: !gigs.length })];
    }
    return [];
  }
  const already = event && ctx.docsByEvent.get(event.id);
  if (already?.length) {
    return [info(`Spreadsheet has invoice ${row.invoiceNumber}, but this gig already has ${already[0].document_number}. Left alone.`)];
  }
  const total = row.invoiceAmount ?? row.fee?.total ?? null;
  if (!total) return [info(`Invoice ${row.invoiceNumber} has no amount, so it is left out.`)];

  const lines = row.fee && Math.abs(row.fee.total - total) < 0.005
    ? [{ description: "Performance", quantity: 1, unit_price: row.fee.base, total: row.fee.base },
      ...row.fee.adjustments.map((a) => ({ description: a.label, quantity: 1, unit_price: a.amount, total: a.amount }))]
    : [{ description: "Performance", quantity: 1, unit_price: total, total }];
  const client = event?.client_id ? ctx.clientsById[event.client_id] : null;
  return [{
    key: "invoice",
    label: "Invoice",
    to: `${docNumber} · ${target} · ${money(total, ctx.symbol)}`,
    checked: true,
    rowIndexes: [row.index],
    invoice: invoiceRecord({
      docNumber, status: target, total, lines, gigDate, dueDate: row.dueDate, paidDate: row.paidDate,
      title: clean(event?.title || row.title), clientName, client, currency: event?.currency || ctx.currency,
      paymentMethod: row.paymentMethod, ctx,
    }),
    payment: target === "paid" ? { amount: total, payment_date: row.paidDate || null } : null,
  }];
}

function invoiceRecord({ docNumber, status, total, lines, gigDate, dueDate, paidDate, title, clientName, client, currency, paymentMethod, ctx, extraNotes = [] }) {
  const terms = client?.default_payment_terms_days || 30;
  const issued = status !== "draft";
  const notes = [`Imported from ${ctx.fileName}`, ...extraNotes];
  if (!dueDate) {
    dueDate = format(addDays(parseISO(issued ? gigDate : ctx.today), terms), "yyyy-MM-dd");
    if (issued) notes.push(`Due date estimated: gig date + ${terms} days`);
  }
  if (status === "paid" && !paidDate) notes.push("Paid, but the spreadsheet has no payment date");
  return {
    document_type: "invoice",
    document_number: docNumber,
    invoice_number: docNumber,
    title: title.replace(/[\s\-–—:]+$/, "") || "Performance",
    client_name: clientName || "",
    client_email: client?.emails?.[0] || "",
    status,
    currency,
    line_items: lines,
    subtotal: total, discount_type: null, discount_value: 0, discount_amount: 0, tax_rate: 0, tax_amount: 0, total,
    due_date: dueDate,
    paid_date: status === "paid" ? paidDate || null : null,
    paid_amount: status === "paid" ? total : 0,
    payment_method: paymentMethod || "",
    notes: notes.join("\n"),
    is_locked: issued,
    locked_at: issued ? new Date().toISOString() : null,
    is_standalone: false,
    sent_date: issued ? gigDate : null,
    payment_terms_days: terms,
    // The amounts came from the spreadsheet: the invoice screen must not
    // re-price them from the gig's fee.
    line_items_user_edited: true,
    // Dated to the gig, so it never shows as issued after it was paid.
    ...(issued ? { issue_date: gigDate, created_at: `${gigDate}T12:00:00.000Z` } : {}),
  };
}

/**
 * One row's plan. event = the gig it is paired with (or null for a new gig).
 * → { kind: "update"|"new"|"same"|"skip", changes: [...], reason }
 */
export function planRow(row, event, ctx) {
  if (!row.date) return { kind: "skip", reason: "No date", changes: [] };
  if (!event && !row.title && !row.fee && !row.invoiceNumber) return { kind: "skip", reason: "Empty row", changes: [] };

  // No client cell: a client named in the gig's name ("Flumi - Antwerp").
  const guessed = row.client ? null : clientFromTitle(`${row.title} ${event?.title || ""}`, ctx.clientNames);
  const rowClient = row.client || guessed?.name || "";
  const clientName = rowClient || (event?.client_id ? ctx.clientsById[event.client_id]?.name : "") || "";
  const invoices = invoiceChanges(row, event, ctx, clientName);
  const lines = noteLines(row, { paidHandled: invoices.some((c) => c.key === "invoice_status") });
  const sym = ctx.symbol;
  const feeLabel = { "fee column": "Fee", "invoice amount": "Fee (from the invoice amount)", "fee in name": "Fee (from the gig name)", guess: "Fee (guessed from the gig name)" }[row.fee?.source];

  if (!event) {
    const status = row.cancelled ? "cancelled" : row.provisional ? "lead" : row.date < ctx.today ? "completed" : "confirmed";
    const useFee = row.fee && row.fee.source !== "guess";
    const gig = {
      title: row.title || "(untitled)",
      date: row.date,
      status,
      event_type: row.eventType || "Gig",
      currency: ctx.currency,
      location_address: row.location,
      start_time: "",
      end_time: "",
      base_price: useFee ? row.fee.base : 0,
      adjustments: useFee ? row.fee.adjustments : [],
      total_price: useFee ? row.fee.total : 0,
      base_price_locked: !!useFee,
      equipment_checklist: [],
      notes: notesFrom(["Not in your calendar. Check it happened.", ...lines], ctx.fileName),
    };
    const summary = [
      rowClient && `client ${rowClient}`,
      useFee && `fee ${money(row.fee.total, sym)}`,
      row.location,
      status !== "completed" && status !== "confirmed" && status,
    ].filter(Boolean).join(" · ");
    const changes = [
      { key: "create", label: "New gig", to: summary || row.title, checked: !row.cancelled, gig, clientName: guessed && !guessed.sure ? "" : rowClient },
      ...invoices.map((c) => ({ ...c, checked: !!c.checked && !row.cancelled })),
    ];
    if (row.fee?.source === "guess") {
      changes.push({ key: "fee", label: feeLabel, to: money(row.fee.total, sym), checked: false, fields: feeFields(row.fee) });
    }
    if (guessed && !guessed.sure) {
      changes.push({ key: "client", label: "Client (guessed from the gig name)", to: guessed.name, checked: false, clientName: guessed.name });
    }
    return { kind: "new", changes };
  }

  const changes = [];
  if (row.fee && Math.abs((Number(event.total_price) || 0) - row.fee.total) >= 0.005) {
    const had = Number(event.total_price) > 0;
    changes.push({
      key: "fee",
      label: feeLabel,
      from: had ? money(event.total_price, sym) : null,
      to: money(row.fee.base, sym) + row.fee.adjustments.map((a) => ` + ${money(a.amount, sym)} ${a.label}`).join(""),
      checked: !had && row.fee.source !== "guess",
      fields: feeFields(row.fee),
    });
  }
  const currentClient = event.client_id ? ctx.clientsById[event.client_id] : null;
  if (rowClient && (!currentClient || similarity(currentClient.name, rowClient) < 0.9) && (row.client || !currentClient)) {
    const label = row.client ? "Client" : guessed.sure ? "Client (from the gig name)" : "Client (guessed from the gig name)";
    changes.push({ key: "client", label, from: currentClient?.name || null, to: rowClient, checked: !currentClient && (!guessed || guessed.sure), clientName: rowClient });
  }
  const loc = String(event.location_address || "").trim();
  if (row.location && !sameVenue(loc, row.location)) {
    changes.push({ key: "location", label: "Venue", from: loc ? loc.split("\n")[0] : null, to: row.location, checked: !loc, fields: { location_address: row.location } });
  }
  if (row.cancelled && event.status !== "cancelled") {
    changes.push({ key: "status", label: "Status", from: event.status, to: "cancelled", checked: true, fields: { status: "cancelled" } });
  }
  if (row.eventType && row.eventType !== event.event_type) {
    changes.push({ key: "type", label: "Type", from: event.event_type || null, to: row.eventType, checked: !event.event_type || event.event_type === "Gig", fields: { event_type: row.eventType } });
  }
  if (row.date !== event.date) {
    changes.push({ key: "date", label: "Date", from: event.date, to: row.date, checked: false, fields: { date: row.date } });
  }
  const existingNotes = String(event.notes || "").toLowerCase();
  const fresh = lines.filter((l) => !existingNotes.includes(l.toLowerCase()));
  if (fresh.length) {
    changes.push({ key: "notes", label: "Add to notes", to: fresh.join(" · "), checked: true, noteLines: fresh });
  }
  changes.push(...invoices);

  // Notes ride along with a real change; on their own (e.g. the same file
  // imported again) they wait for the user to tick them.
  const notes = changes.find((c) => c.key === "notes");
  if (notes && !changes.some((c) => c !== notes && c.checked && !c.info)) notes.checked = false;

  return { kind: changes.some((c) => !c.info) ? "update" : "same", changes };
}

const feeFields = (fee) => ({ base_price: fee.base, adjustments: fee.adjustments, total_price: fee.total, base_price_locked: true });

/**
 * Rows that carry the same invoice number are one invoice, not one each: the
 * first row's invoice covers every gig in the group and the others point at
 * it. When every row shows the same amount (how Airtable repeats an invoice's
 * total on each linked gig) that amount is the total; otherwise the rows'
 * amounts add up. Moving an existing invoice along likewise happens once.
 * Returns new plans; the ones passed in are left as they are.
 */
export function groupInvoices(rows, plans, ctx) {
  const groups = new Map();
  plans.forEach((p, i) => p.changes.forEach((c) => {
    const k = c.key === "invoice" ? `n:${numberKey(c.invoice.document_number)}` : c.key === "invoice_status" ? `d:${c.docId}` : null;
    if (k) groups.set(k, [...(groups.get(k) || []), { i, c }]);
  }));
  const out = plans.map((p) => ({ ...p, changes: [...p.changes] }));
  const swap = (i, from, to) => { out[i].changes = out[i].changes.map((c) => (c === from ? to : c)); };

  for (const [k, members] of groups) {
    if (members.length < 2) continue;
    const [first, ...rest] = members;
    const lineOf = (i) => rows[i].line;
    if (k.startsWith("d:")) {
      rest.forEach(({ i, c }) => swap(i, c, info(`${c.docNumber}: moved along on line ${lineOf(first.i)}.`)));
      continue;
    }
    const groupRows = members.map(({ i }) => rows[i]);
    const amounts = groupRows.map((r) => r.invoiceAmount ?? r.fee?.total ?? 0);
    const shared = isShared(groupRows.map((r) => r.invoiceAmount));
    const total = round2(shared ? amounts[0] : amounts.reduce((s, a) => s + a, 0));
    const fees = groupRows.map((r) => r.fee?.total);
    const perGig = shared ? (fees.every((f) => f > 0) && Math.abs(fees.reduce((s, f) => s + f, 0) - total) < 0.005 ? fees : null) : amounts;
    const lines = perGig
      ? groupRows.map((r, n) => ({ description: `${r.title || "Performance"} — ${niceDate(r.date)}`, quantity: 1, unit_price: perGig[n], total: perGig[n] }))
      : [{ description: `${groupRows.length} performances (${groupRows.map((r) => niceDate(r.date)).join(", ")})`, quantity: 1, unit_price: total, total }];
    const status = groupRows.some((r) => r.invoiceStatus === "paid") ? "paid" : first.c.invoice.status;
    const paidDate = groupRows.map((r) => r.paidDate).find(Boolean) || null;
    const dates = groupRows.map((r) => r.date).filter(Boolean).sort();
    const docNumber = first.c.invoice.document_number;
    const merged = {
      ...first.c,
      checked: members.some(({ c }) => c.checked),
      to: `${docNumber} · ${status} · ${money(total, ctx.symbol)} · covers lines ${members.map(({ i }) => lineOf(i)).join(", ")}`,
      rowIndexes: members.map(({ i }) => i),
      invoice: {
        ...invoiceRecord({
          docNumber, status, total, lines, gigDate: dates[0] || ctx.today, dueDate: groupRows.map((r) => r.dueDate).find(Boolean),
          paidDate, title: `${groupRows.length} gigs, ${niceDate(dates[0])} – ${niceDate(dates[dates.length - 1])}`,
          clientName: first.c.invoice.client_name, client: null, currency: first.c.invoice.currency, paymentMethod: first.c.invoice.payment_method, ctx,
          extraNotes: shared && !perGig ? [`Each line of the spreadsheet showed ${money(total, ctx.symbol)}; taken as the invoice's total`] : [],
        }),
        client_email: first.c.invoice.client_email,
      },
      payment: status === "paid" ? { amount: total, payment_date: paidDate } : null,
    };
    swap(first.i, first.c, merged);
    rest.forEach(({ i, c }) => swap(i, c, info(`On invoice ${docNumber} with line ${lineOf(first.i)}.`)));
  }
  out.forEach((p) => {
    if (p.kind === "update" || p.kind === "same") p.kind = p.changes.some((c) => !c.info) ? "update" : "same";
  });
  return out;
}

// "Manchester" and "Manchester, England" are one venue; so are two spellings
// of the same hotel. Only a real difference is offered as a change.
function sameVenue(a, b) {
  const x = String(a || "").toLowerCase().trim(), y = String(b || "").toLowerCase().trim();
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const head = (s) => s.split(/\s*[,\n]\s*|\s+-\s+/)[0].trim();
  return head(x) === head(y) || similarity(x, y) >= 0.6;
}

const words = (s) => String(s || "").toLowerCase().split(/[^a-z0-9א-ת]+/).filter((w) => w.length > 2);

// Words too common in gig and company names to tell a client by.
const GENERIC = new Set([
  "the", "and", "band", "bands", "showband", "showbands", "music", "musical", "events", "event", "entertainment", "ltd", "limited", "london", "agency",
  "productions", "group", "studio", "studios", "wedding", "weddings", "jazz", "party", "parties", "club", "hotel", "festival",
  "corporate", "live", "bar", "trio", "quartet", "duo", "orchestra", "choir", "ensemble", "collective", "records", "management",
  "mgmt", "company", "services", "booking", "bookings", "show", "shows", "night", "private", "dinner", "gala", "venue",
]);

/**
 * The one known client whose name shows in a gig's name: "Flumi - Antwerp"
 * → Flumi Band. Each client is known by its first distinctive word. Every
 * distinctive word present is a sure match; part of the name, or one letter
 * more ("Flumie 600"), is only a guess.
 * Two clients in one name, or none, gives nothing.
 * → { name, sure } | null
 */
export function clientFromTitle(title, names) {
  const ws = words(title);
  const hits = [];
  for (const n of names) {
    const key = words(n).find((w) => w.length >= 4 && !GENERIC.has(w));
    if (!key) continue;
    // Sure only when the whole name is there ("Flumi" for Flumi Band, not
    // "Victoria" for Victoria Jones); one word of a longer name is a guess.
    const distinct = words(n).filter((w) => !GENERIC.has(w));
    if (ws.includes(key)) hits.push({ name: n, sure: distinct.every((w) => ws.includes(w)) });
    else if (ws.some((w) => w.startsWith(key) && w.length - key.length === 1)) hits.push({ name: n, sure: false });
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * New-gig rows that repeat another row of the same day (near-identical name,
 * or every word of one inside the other), or that the sheet itself calls a
 * duplicate, start unticked.
 */
export function flagRepeat(rows, i, plan) {
  if (plan.kind !== "new") return plan;
  const mine = words(rows[i].title);
  const twin = rows.findIndex((r, j) => {
    if (j === i || r.date !== rows[i].date) return false;
    const theirs = words(r.title);
    return similarity(r.title, rows[i].title) >= 0.8 || (mine.length && mine.every((w) => theirs.includes(w)));
  });
  if (twin >= 0) plan.reason = `Looks like a repeat of line ${rows[twin].line}`;
  else if (rows[i].notes.some((n) => /duplicate/i.test(n))) plan.reason = "The spreadsheet calls it a possible duplicate";
  else if (rows[i].cancelled) plan.reason = "Cancelled, and not in Flowtone";
  if (plan.reason) plan.changes.forEach((c) => { c.checked = false; });
  return plan;
}

/** Changes for the notes field: appended, never replacing what is there. */
export function appendNotes(current, lines, fileName) {
  return [String(current || "").trim(), notesFrom(lines, fileName)].filter(Boolean).join("\n\n");
}
