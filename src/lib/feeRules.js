// Fee rules ("my rates"): turns a gig into a suggested fee with a breakdown.
//
// Rules live on AppSettings.fee_rules (payload JSON, no migration) as an
// ordered list. Two kinds:
//   - "set":     the fee itself. Top to bottom, the first matching one wins.
//   - "add" / "percent": extras on top (travel, weekend, ...). All that match apply.
// If no "set" rule matches, the linked client's default_fee is used.
//
// Conditions read the title AND the location, because calendar-imported gigs
// usually carry the client and the place in the title ("Muzika - Manchester").
import { parseISO, isWeekend } from "date-fns";

export const CONDITION_TYPES = [
  { key: "any", label: "Any gig" },
  { key: "keyword", label: "Title or place mentions" },
  { key: "event_type", label: "Type of work is" },
  { key: "client", label: "Client is" },
  { key: "outside_home", label: "Location is outside my area" },
  { key: "weekend", label: "Falls on a weekend" },
  { key: "longer_than", label: "Longer than (hours)" },
];

export const EVENT_TYPES = ["Gig", "Lesson", "Rehearsal", "Session"];

export const KIND_LABELS = { set: "Fee", add: "Add", percent: "Add %" };

export function newRule(kind = "set") {
  return {
    id: Math.random().toString(36).slice(2, 10),
    label: "",
    when: { type: kind === "set" ? "keyword" : "outside_home", value: "" },
    kind,
    amount: "",
  };
}

function words(value) {
  return String(value || "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

function hoursLong(e) {
  if (!e.start_time || !e.end_time) return null;
  const [sh, sm] = e.start_time.split(":").map(Number);
  const [eh, em] = e.end_time.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60; // finishes after midnight
  return mins / 60;
}

export function ruleMatches(rule, event, { homeArea = "" } = {}) {
  const { type, value } = rule.when || {};
  const text = `${event.title || ""} ${event.location_address || ""}`.toLowerCase();
  switch (type) {
    case "any":
      return true;
    case "keyword":
      return words(value).some((w) => text.includes(w));
    case "event_type":
      return (event.event_type || "Gig") === value;
    case "client":
      return !!value && event.client_id === value;
    case "outside_home": {
      // Only decidable when there is an address; a bare title says nothing.
      const loc = String(event.location_address || "").toLowerCase().trim();
      const home = words(homeArea);
      return !!loc && home.length > 0 && !home.some((w) => loc.includes(w));
    }
    case "weekend":
      return !!event.date && isWeekend(parseISO(event.date));
    case "longer_than": {
      const h = hoursLong(event);
      return h != null && h > Number(value || 0);
    }
    default:
      return false;
  }
}

/** Short human description of a rule's condition, for lists and breakdowns. */
export function describeCondition(rule, clientMap = {}) {
  const { type, value } = rule.when || {};
  switch (type) {
    case "any": return "any gig";
    case "keyword": return `mentions ${words(value).join(" / ") || "…"}`;
    case "event_type": return `${value || "…"}`;
    case "client": return clientMap[value]?.name || "a client";
    case "outside_home": return "outside my area";
    case "weekend": return "weekend";
    case "longer_than": return `over ${value || "…"}h`;
    default: return "";
  }
}

/**
 * → { base, baseLabel, extras: [{label, amount}], total } or null when no
 * rule (and no client default) gives a fee.
 */
export function suggestFee(event, { rules = [], homeArea = "", clientMap = {} } = {}) {
  let base = null;
  let baseLabel = "";
  for (const r of rules) {
    if (r.kind !== "set" || !(Number(r.amount) > 0)) continue;
    if (ruleMatches(r, event, { homeArea })) {
      base = Number(r.amount);
      baseLabel = r.label || describeCondition(r, clientMap);
      break;
    }
  }
  if (base == null) {
    const client = event.client_id ? clientMap[event.client_id] : null;
    if (Number(client?.default_fee) > 0) {
      base = Number(client.default_fee);
      baseLabel = `${client.name} usual fee`;
    }
  }
  if (base == null) return null;

  const extras = [];
  for (const r of rules) {
    if ((r.kind !== "add" && r.kind !== "percent") || !(Number(r.amount) > 0)) continue;
    if (!ruleMatches(r, event, { homeArea })) continue;
    const amount = r.kind === "percent" ? Math.round(base * Number(r.amount)) / 100 : Number(r.amount);
    extras.push({ label: r.label || describeCondition(r, clientMap), amount });
  }
  const total = base + extras.reduce((s, x) => s + x.amount, 0);
  return { base, baseLabel, extras, total };
}

/** WorkEvent fields for a suggestion (same shape the event Financials editor writes). */
export function feeFields(suggestion) {
  return {
    base_price: suggestion.base,
    adjustments: suggestion.extras.map((x) => ({ label: x.label, amount: x.amount })),
    total_price: suggestion.total,
  };
}
