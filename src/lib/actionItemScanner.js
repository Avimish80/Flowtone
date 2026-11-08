import {
  isBillableGig, hasLocation, hasFee,
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

// ─── Lead-level predicates ────────────────────────────────────────────────────

function isLeadUnanswered(lead, now) {
  if (lead.status !== "new" || !lead.created_at) return false;
  return now - new Date(lead.created_at).getTime() > 24 * 60 * 60 * 1000;
}

function isQuoteUnreplied(lead, now) {
  if (lead.status !== "quoted" || !lead.quote_sent_at) return false;
  return now - new Date(lead.quote_sent_at).getTime() > 3 * 24 * 60 * 60 * 1000;
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

export function scanForActionItems(events, documents, clients, now, leads = []) {
  const items = [];
  const invoices = documents.filter((d) => d.document_type === "invoice");
  const invoicedEventIds = new Set(invoices.map((i) => i.work_event_id).filter(Boolean));
  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));

  // ── Event problems + opportunities ──
  for (const e of events) {
    if (!isBillableGig(e)) continue;

    const start = eventStartMs(e);
    const daysAway = start ? (start - now) / (24 * 60 * 60 * 1000) : 999;

    // ── BEFORE the gig: chase the location only ──
    // Everything financial (fee, client, contact, invoice) is chased AFTER the
    // gig — you can create an invoice early, but we never nag you to before it
    // has happened.
    if (isUpcoming(e, now)) {
      if (daysAway > 7) continue; // Skip events more than 7 days out to avoid clutter

      if (!hasLocation(e)) {
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
    }

    // ── AFTER the gig: walk it to a paid invoice, one blocker at a time ──
    // A single gig only ever raises ONE of these tickets — the next one in the
    // chain appears on the following scan once the current blocker is cleared:
    //   no fee → no client → no email → ready to invoice.
    if (isPastGig(e, now) && !invoicedEventIds.has(e.id)) {
      const client = e.client_id ? clientMap[e.client_id] : null;

      if (!hasFee(e)) {
        // Can't invoice without knowing the amount.
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
      } else if (!client) {
        // Fee is known but there's no client on the gig — can't invoice a no-one.
        const payload = {
          event_title: e.title,
          event_date: e.date,
          fee: e.total_price || e.base_price,
          currency: e.currency,
        };
        payload.payload_sig = payloadSignature(payload);
        items.push({
          item_type: "gig_missing_client",
          entity_type: "event",
          entity_id: e.id,
          priority: 1,
          action_type: "navigate",
          action_target: `WorkEventDetail?id=${e.id}`,
          payload,
        });
      } else if (!hasEmail(client)) {
        // Fee + client are set, but there's no email to send the invoice to.
        const payload = {
          event_title: e.title,
          event_date: e.date,
          client_id: client.id,
          client_name: client.name,
          fee: e.total_price || e.base_price,
          currency: e.currency,
          has_email: false,
        };
        payload.payload_sig = payloadSignature(payload);
        items.push({
          item_type: "gig_missing_contact",
          entity_type: "event",
          entity_id: e.id,
          priority: 1,
          action_type: "navigate",
          action_target: `ClientDetail?id=${client.id}`,
          payload,
        });
      } else {
        // Everything's in place — make the invoice.
        const payload = {
          event_title: e.title,
          event_date: e.date,
          client_name: client.name,
          fee: e.total_price || e.base_price,
          currency: e.currency,
          has_email: true,
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

  // ── Lead chasing ──
  for (const lead of leads) {
    if (isLeadUnanswered(lead, now)) {
      const payload = { client_name: lead.contact_name, event_date: lead.event_date || "" };
      payload.payload_sig = payloadSignature(payload);
      items.push({
        item_type: "lead_new_unanswered",
        entity_type: "lead",
        entity_id: lead.id,
        priority: 2,
        action_type: "navigate",
        action_target: `LeadDetail?id=${lead.id}`,
        payload,
      });
    } else if (isQuoteUnreplied(lead, now)) {
      const daysSinceQuote = (now - new Date(lead.quote_sent_at).getTime()) / (24 * 60 * 60 * 1000);
      const payload = {
        client_name: lead.contact_name,
        event_date: lead.event_date || "",
        contact_email: lead.contact_email || "",
        public_token: lead.public_token || "",
      };
      payload.payload_sig = payloadSignature(payload);
      items.push({
        item_type: "lead_quote_no_reply",
        entity_type: "lead",
        entity_id: lead.id,
        priority: daysSinceQuote > 7 ? 2 : 1,
        action_type: "navigate",
        action_target: `LeadDetail?id=${lead.id}`,
        payload,
      });
    }
  }

  for (const item of items) {
    item.candidate_key = `${item.item_type}::${item.entity_id}`;
  }

  return items;
}

export function extractCandidateFindings(events, documents, clients, now, leads = []) {
  const items = scanForActionItems(events, documents, clients, now, leads);
  return items.map((item) => {
    const candidate_key = item.candidate_key || `${item.item_type}::${item.entity_id}`;
    
    // Set allowed alternates
    const allowed_item_types = [item.item_type];
    const action_targets = {
      [item.item_type]: item.action_target,
    };
    
    if (item.item_type === "gig_ready_to_invoice") {
      allowed_item_types.push("invoice_ready_to_send");
      action_targets["invoice_ready_to_send"] = `DocumentDetail?event_id=${item.entity_id}&type=invoice`;
    }
    
    return {
      candidate_key,
      default_item_type: item.item_type,
      allowed_item_types,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      priority: item.priority,
      payload: item.payload || {},
      action_targets,
    };
  });
}

// ─── Grouping ─────────────────────────────────────────────────────────────────
// A pile of same-kind tasks reads as noise ("Set the fee for…" x64), so they
// collapse into one task that opens the page fixing them in bulk. Members stay
// in the database with status "grouped" (out of every open list) and come back
// one by one once the pile is down to GROUP_MIN - 1 or fewer.

export const GROUP_MIN = 4; // "more than three"

const GROUP_RULES = {
  gig_missing_fee: { target: () => "FeeCatchUp" },
  gig_missing_client: {},
  gig_missing_location: {},
  invoice_draft_stale: {},
  // One email fixes every gig for that client, so group per client from two.
  gig_missing_contact: {
    by: (d) => d.payload?.client_id || "",
    min: 2,
    target: (clientId) => (clientId ? `ClientDetail?id=${clientId}` : ""),
  },
};

function hashKeys(keys) {
  let h = 5381;
  for (const ch of [...keys].sort().join(",")) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

export function itemKey(item) {
  return item.candidate_key || item.payload?.candidate_key || `${item.item_type}::${item.entity_id}`;
}

export function isGroupItem(item) {
  return item?.item_type === "group";
}

// Returns { groups: [desired group items], groupedKeys: Set of member keys }.
export function groupActionItems(desired) {
  const buckets = new Map();
  for (const d of desired) {
    const rule = GROUP_RULES[d.item_type];
    if (!rule) continue;
    const sub = rule.by ? rule.by(d) : "";
    if (rule.by && !sub) continue;
    const bucketKey = `group::${d.item_type}${sub ? `::${sub}` : ""}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, { type: d.item_type, sub, rule, members: [] });
    buckets.get(bucketKey).members.push(d);
  }

  const groups = [];
  const groupedKeys = new Set();
  for (const [bucketKey, { type, sub, rule, members }] of buckets) {
    if (members.length < (rule.min || GROUP_MIN)) continue;
    members.forEach((m) => groupedKeys.add(itemKey(m)));
    const first = members[0].payload || {};
    const payload = {
      member_type: type,
      count: members.length,
      member_keys: members.map(itemKey),
      client_name: sub ? first.client_name || "" : "",
    };
    // Membership, not just size: one fixed and one new keeps the count but
    // must still refresh member_keys.
    payload.payload_sig = [type, sub, members.length, hashKeys(payload.member_keys)].join("|");
    groups.push({
      item_type: "group",
      entity_type: "group",
      entity_id: sub || null,
      priority: Math.max(...members.map((m) => m.priority || 0)),
      action_type: "navigate",
      action_target: rule.target ? rule.target(sub) : "",
      payload,
      candidate_key: bucketKey,
    });
  }
  return { groups, groupedKeys };
}

export function groupTitle(item) {
  const p = item.payload || {};
  const n = p.count || 0;
  switch (p.member_type) {
    case "gig_missing_fee":
      return `${n} past gigs still have no fee — want to fill them from your rates?`;
    case "gig_missing_client":
      return `${n} gigs have no client yet — add them so I can invoice`;
    case "gig_missing_location":
      return `${n} upcoming gigs have no address yet`;
    case "invoice_draft_stale":
      return `${n} draft invoices have been waiting over a week`;
    case "gig_missing_contact":
      return `${p.client_name || "A client"}: add an email — ${n} gigs waiting to be invoiced`;
    default:
      return `${n} tasks need a look`;
  }
}

// ─── Shared by the lists, the ticket and the assistant brief ──────────────────

const ACTION_LABELS = {
  gig_missing_location: "Add location",
  gig_missing_fee: "Add fee",
  gig_missing_client: "Add client",
  gig_missing_contact: "Add email",
  gig_ready_to_invoice: "Review invoice",
  invoice_overdue: "Open invoice",
  invoice_draft_stale: "Review draft",
  invoice_ready_to_send: "Open to send",
  invoice_ready_no_email: "Get PDF",
  lead_new_unanswered: "Open lead",
  lead_quote_no_reply: "Open lead",
};

const GROUP_ACTION_LABELS = {
  gig_missing_fee: "Set fees",
  gig_missing_contact: "Add email",
};

export function missionActionLabel(item) {
  if (isGroupItem(item)) return GROUP_ACTION_LABELS[item.payload?.member_type] || "See them";
  return ACTION_LABELS[item.item_type] || "Open";
}

// Where "do it" goes. A group with no bulk page opens its own ticket, which
// lists the members.
export function missionTarget(item) {
  if (item.action_target) return item.action_target;
  if (isGroupItem(item) && item.id) return `MissionDetail?id=${item.id}`;
  return "";
}

// Highest priority first, then the longest-waiting.
export function rankMissions(items) {
  return [...items].sort((a, b) => {
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  });
}

// ─── Reconciler ───────────────────────────────────────────────────────────────

export function reconcileActionItems(existingOpen, desired) {
  const desiredByKey = new Map(
    desired.map((d) => [d.candidate_key || `${d.item_type}::${d.entity_id}`, d])
  );
  // One live row per key; any extra copy (e.g. a re-opened snooze racing a
  // re-create) is resolved instead of lingering unreachable.
  const existingByKey = new Map();
  const duplicates = [];
  for (const e of existingOpen) {
    const key = e.candidate_key || e.payload?.candidate_key || `${e.item_type}::${e.entity_id}`;
    if (existingByKey.has(key)) duplicates.push(e);
    else existingByKey.set(key, e);
  }

  const toCreate = [];
  const toRefresh = [];
  const toResolve = [];
  // Items that stay but move between "open" and "grouped" (desired.desired_status).
  const toRestatus = [];

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
      if (d.desired_status && existing.status !== d.desired_status) {
        toRestatus.push({ existing, desired: d });
      }
    }
  }

  for (const [key, e] of existingByKey) {
    if (!desiredByKey.has(key)) {
      toResolve.push(e);
    }
  }
  toResolve.push(...duplicates);

  return { toCreate, toResolve, toRefresh, toRestatus };
}
