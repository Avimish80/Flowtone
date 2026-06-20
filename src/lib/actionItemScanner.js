import {
  isBillableGig, hasLocation, hasFee, hasInvoice,
  isUpcoming, isPastGig, eventStartMs,
} from "@/lib/missingInfo";

// ─── Client-level predicates ──────────────────────────────────────────────────

function hasEmail(client) {
  return Array.isArray(client.emails) && client.emails.some((e) => e && e.trim());
}

// ─── Invoice-level predicates ─────────────────────────────────────────────────

function isOverdue(inv) {
  if (inv.status !== "sent" || !inv.due_date) return false;
  const due = new Date(inv.due_date + "T23:59:59");
  return due < new Date();
}

function isCompleteDraft(inv) {
  if (inv.status !== "draft") return false;
  if (!inv.total || Number(inv.total) <= 0) return false;
  if (!inv.line_items || !inv.line_items.length) return false;
  return true;
}

function isDraftIncompleteAndStale(inv, now) {
  if (inv.status !== "draft" || !inv.created_at) return false;
  if (isCompleteDraft(inv)) return false;
  const created = new Date(inv.created_at).getTime();
  return now - created > 7 * 24 * 60 * 60 * 1000;
}

function draftHasEmail(inv, clientMap) {
  if (inv.client_email) return true;
  if (inv.client_id && clientMap[inv.client_id] && hasEmail(clientMap[inv.client_id])) return true;
  return false;
}

// ─── Payload signature ────────────────────────────────────────────────────────

function payloadSignature(payload) {
  const parts = [
    payload.client_name || "",
    payload.event_title || "",
    payload.invoice_title || "",
    String(payload.fee || payload.total || ""),
    payload.event_date || "",
    payload.due_date || "",
  ];
  return parts.join("|");
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

export function scanForActionItems(events, documents, clients, now) {
  const items = [];
  const invoices = documents.filter((d) => d.document_type === "invoice");
  const invoicedEventIds = new Set(invoices.map((i) => i.work_event_id).filter(Boolean));
  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));

  // ── Event problems + opportunities ──
  for (const e of events) {
    if (!isBillableGig(e)) continue;

    if (isUpcoming(e, now) && !hasLocation(e)) {
      const start = eventStartMs(e);
      const daysAway = start ? (start - now) / (24 * 60 * 60 * 1000) : 999;
      const payload = { event_title: e.title, event_date: e.date };
      payload.payload_sig = payloadSignature(payload);
      items.push({
        item_type: "gig_missing_location",
        entity_type: "event",
        entity_id: e.id,
        priority: daysAway < 7 ? 2 : 1,
        action_type: "navigate",
        action_target: `WorkEventDetail?id=${e.id}`,
        payload,
      });
    }

    if (isPastGig(e, now) && !hasFee(e) && !hasInvoice(e, invoices)) {
      const payload = { event_title: e.title, event_date: e.date };
      payload.payload_sig = payloadSignature(payload);
      items.push({
        item_type: "gig_missing_fee",
        entity_type: "event",
        entity_id: e.id,
        priority: 1,
        action_type: "navigate",
        action_target: `WorkEventDetail?id=${e.id}`,
        payload,
      });
    }

    // Opportunity: past gig with fee but no invoice at all (email-agnostic)
    if (
      isPastGig(e, now) &&
      hasFee(e) &&
      !invoicedEventIds.has(e.id) &&
      e.client_id &&
      clientMap[e.client_id]
    ) {
      const client = clientMap[e.client_id];
      const clientHasEmail = hasEmail(client);
      const payload = {
        event_title: e.title,
        event_date: e.date,
        client_name: client.name,
        fee: e.total_price || e.base_price,
        currency: e.currency,
        has_email: clientHasEmail,
      };
      payload.payload_sig = payloadSignature(payload);
      items.push({
        item_type: "gig_ready_to_invoice",
        entity_type: "event",
        entity_id: e.id,
        priority: 1,
        action_type: "create_invoice",
        action_target: `DocumentDetail?event_id=${e.id}&type=invoice`,
        payload,
      });
    }
  }

  // ── Invoice problems + opportunities ──
  for (const inv of invoices) {
    if (isOverdue(inv)) {
      const payload = {
        invoice_title: inv.title,
        client_name: inv.client_name,
        due_date: inv.due_date,
        total: inv.total,
        currency: inv.currency,
      };
      payload.payload_sig = payloadSignature(payload);
      items.push({
        item_type: "invoice_overdue",
        entity_type: "invoice",
        entity_id: inv.id,
        priority: 2,
        action_type: "navigate",
        action_target: `DocumentDetail?id=${inv.id}`,
        payload,
      });
    }

    if (isCompleteDraft(inv)) {
      const emailAvailable = draftHasEmail(inv, clientMap);
      if (emailAvailable) {
        const payload = {
          invoice_title: inv.title,
          client_name: inv.client_name,
          total: inv.total,
          currency: inv.currency,
        };
        payload.payload_sig = payloadSignature(payload);
        items.push({
          item_type: "invoice_ready_to_send",
          entity_type: "invoice",
          entity_id: inv.id,
          priority: 1,
          action_type: "send_invoice",
          action_target: `DocumentDetail?id=${inv.id}`,
          payload,
        });
      } else {
        const payload = {
          invoice_title: inv.title,
          client_name: inv.client_name,
          total: inv.total,
          currency: inv.currency,
        };
        payload.payload_sig = payloadSignature(payload);
        items.push({
          item_type: "invoice_ready_no_email",
          entity_type: "invoice",
          entity_id: inv.id,
          priority: 1,
          action_type: "navigate",
          action_target: `DocumentDetail?id=${inv.id}`,
          payload,
        });
      }
    } else if (isDraftIncompleteAndStale(inv, now)) {
      const payload = { invoice_title: inv.title, client_name: inv.client_name };
      payload.payload_sig = payloadSignature(payload);
      items.push({
        item_type: "invoice_draft_stale",
        entity_type: "invoice",
        entity_id: inv.id,
        priority: 0,
        action_type: "navigate",
        action_target: `DocumentDetail?id=${inv.id}`,
        payload,
      });
    }
  }

  return items;
}

// ─── Reconciler ───────────────────────────────────────────────────────────────

export function reconcileActionItems(existingOpen, desired) {
  const desiredByKey = new Map(
    desired.map((d) => [`${d.item_type}::${d.entity_id}`, d])
  );
  const existingByKey = new Map(
    existingOpen.map((e) => [`${e.item_type}::${e.entity_id}`, e])
  );

  const toCreate = [];
  const toRefresh = [];
  const toResolve = [];

  for (const [key, d] of desiredByKey) {
    const existing = existingByKey.get(key);
    if (!existing) {
      toCreate.push(d);
    } else {
      const oldSig = existing.payload?.payload_sig || "";
      const newSig = d.payload?.payload_sig || "";
      if (oldSig !== newSig) {
        toRefresh.push({ existing, desired: d });
      }
    }
  }

  for (const [key, e] of existingByKey) {
    if (!desiredByKey.has(key)) {
      toResolve.push(e);
    }
  }

  return { toCreate, toResolve, toRefresh };
}
