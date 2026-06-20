import {
  isBillableGig, hasLocation, hasFee, hasInvoice,
  isUpcoming, isPastGig, eventStartMs,
} from "@/lib/missingInfo";

// ─── Client-level predicates ──────────────────────────────────────────────────

function hasEmail(client) {
  return Array.isArray(client.emails) && client.emails.some((e) => e && e.trim());
}

function hasPhone(client) {
  return Array.isArray(client.phones) && client.phones.some((p) => p && p.trim());
}

// ─── Invoice-level predicates ─────────────────────────────────────────────────

function isOverdue(inv) {
  if (inv.status !== "sent" || !inv.due_date) return false;
  const due = new Date(inv.due_date + "T23:59:59");
  return due < new Date();
}

function isDraftStale(inv, now) {
  if (inv.status !== "draft" || !inv.created_at) return false;
  const created = new Date(inv.created_at).getTime();
  return now - created > 7 * 24 * 60 * 60 * 1000;
}

function isDraftReadyToSend(inv, clientMap) {
  if (inv.status !== "draft") return false;
  if (!inv.total || Number(inv.total) <= 0) return false;
  if (!inv.line_items || !inv.line_items.length) return false;
  const email = inv.client_email ||
    (inv.client_id && clientMap[inv.client_id] && hasEmail(clientMap[inv.client_id]));
  return !!email;
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

export function scanForActionItems(events, documents, clients, now) {
  const items = [];
  const invoices = documents.filter((d) => d.document_type === "invoice");
  const invoicedEventIds = new Set(invoices.map((i) => i.work_event_id).filter(Boolean));
  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));

  // ── Client problems ──
  for (const c of clients) {
    if (!hasEmail(c)) {
      items.push({
        item_type: "client_missing_email",
        entity_type: "client",
        entity_id: c.id,
        priority: 0,
        action_type: "navigate",
        action_target: `ClientDetail?id=${c.id}`,
        payload: { client_name: c.name },
      });
    }
    if (!hasPhone(c)) {
      items.push({
        item_type: "client_missing_phone",
        entity_type: "client",
        entity_id: c.id,
        priority: 0,
        action_type: "navigate",
        action_target: `ClientDetail?id=${c.id}`,
        payload: { client_name: c.name },
      });
    }
  }

  // ── Event problems ──
  for (const e of events) {
    if (!isBillableGig(e)) continue;

    if (isUpcoming(e, now) && !hasLocation(e)) {
      const start = eventStartMs(e);
      const daysAway = start ? (start - now) / (24 * 60 * 60 * 1000) : 999;
      items.push({
        item_type: "gig_missing_location",
        entity_type: "event",
        entity_id: e.id,
        priority: daysAway < 7 ? 2 : 1,
        action_type: "navigate",
        action_target: `WorkEventDetail?id=${e.id}`,
        payload: { event_title: e.title, event_date: e.date },
      });
    }

    if (isPastGig(e, now) && !hasFee(e) && !hasInvoice(e, invoices)) {
      items.push({
        item_type: "gig_missing_fee",
        entity_type: "event",
        entity_id: e.id,
        priority: 1,
        action_type: "navigate",
        action_target: `WorkEventDetail?id=${e.id}`,
        payload: { event_title: e.title, event_date: e.date },
      });
    }

    // Opportunity: past gig with fee + client + client email, but no invoice
    if (
      isPastGig(e, now) &&
      hasFee(e) &&
      !invoicedEventIds.has(e.id) &&
      e.client_id &&
      clientMap[e.client_id] &&
      hasEmail(clientMap[e.client_id])
    ) {
      const client = clientMap[e.client_id];
      items.push({
        item_type: "gig_ready_to_invoice",
        entity_type: "event",
        entity_id: e.id,
        priority: 1,
        action_type: "create_invoice",
        action_target: `DocumentDetail?event_id=${e.id}&type=invoice`,
        payload: {
          event_title: e.title,
          event_date: e.date,
          client_name: client.name,
          fee: e.total_price || e.base_price,
          currency: e.currency,
        },
      });
    }
  }

  // ── Invoice problems + opportunities ──
  for (const inv of invoices) {
    if (isOverdue(inv)) {
      items.push({
        item_type: "invoice_overdue",
        entity_type: "invoice",
        entity_id: inv.id,
        priority: 2,
        action_type: "navigate",
        action_target: `DocumentDetail?id=${inv.id}`,
        payload: {
          invoice_title: inv.title,
          client_name: inv.client_name,
          due_date: inv.due_date,
          total: inv.total,
          currency: inv.currency,
        },
      });
    }

    if (isDraftStale(inv, now)) {
      items.push({
        item_type: "invoice_draft_stale",
        entity_type: "invoice",
        entity_id: inv.id,
        priority: 0,
        action_type: "navigate",
        action_target: `DocumentDetail?id=${inv.id}`,
        payload: { invoice_title: inv.title, client_name: inv.client_name },
      });
    }

    if (isDraftReadyToSend(inv, clientMap)) {
      items.push({
        item_type: "invoice_ready_to_send",
        entity_type: "invoice",
        entity_id: inv.id,
        priority: 1,
        action_type: "send_invoice",
        action_target: `DocumentDetail?id=${inv.id}`,
        payload: {
          invoice_title: inv.title,
          client_name: inv.client_name,
          total: inv.total,
          currency: inv.currency,
        },
      });
    }
  }

  return items;
}

// ─── Reconciler ───────────────────────────────────────────────────────────────

export function reconcileActionItems(existingOpen, desired) {
  const desiredKeys = new Set(
    desired.map((d) => `${d.item_type}::${d.entity_id}`)
  );
  const existingKeys = new Set(
    existingOpen.map((e) => `${e.item_type}::${e.entity_id}`)
  );

  const toCreate = desired.filter(
    (d) => !existingKeys.has(`${d.item_type}::${d.entity_id}`)
  );
  const toResolve = existingOpen.filter(
    (e) => !desiredKeys.has(`${e.item_type}::${e.entity_id}`)
  );

  return { toCreate, toResolve };
}
