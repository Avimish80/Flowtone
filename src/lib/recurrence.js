// ─── Shared recurrence engine ───────────────────────────────────────────────
//
// One canonical recurrence rule + expansion, used by BOTH the AI assistant and
// the event-detail RecurrenceSection so the two paths can never drift apart.
//
// A rule looks like:
//   {
//     frequency: "daily" | "weekly" | "biweekly" | "monthly" | "yearly",
//     interval: number (>=1, default 1),         // every N units
//     days_of_week: number[] (0=Sun..6=Sat),     // weekly only, optional
//     end_type: "count" | "until" | "never",
//     count: number,                             // end_type "count"
//     until: "YYYY-MM-DD",                       // end_type "until"
//   }
//
// For end_type "never" (ongoing lessons with no end) we don't materialise
// forever — we generate up to a rolling horizon (HORIZON_MONTHS ahead) and a
// top-up pass extends the series over time so it always feels endless.

import { format } from "date-fns";

// How far ahead open-ended ("never") series are materialised, and the trigger
// point for topping them up. Kept modest so we never create thousands of rows.
export const HORIZON_MONTHS = 6;
// Hard ceiling on how many occurrences a single expansion can ever produce —
// a safety net against a runaway rule (e.g. daily-forever).
const MAX_OCCURRENCES = 400;

const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Parse a "YYYY-MM-DD" (or Date) into a local-noon Date, avoiding TZ rollover.
function parseDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  if (typeof value === "string" && value) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    if (y && m && d) return new Date(y, m - 1, d, 12);
  }
  return null;
}

function addStep(date, frequency, interval) {
  const out = new Date(date.getTime());
  const n = Math.max(1, Number(interval) || 1);
  switch (frequency) {
    case "daily": out.setDate(out.getDate() + n); break;
    case "weekly": out.setDate(out.getDate() + n * 7); break;
    case "biweekly": out.setDate(out.getDate() + n * 14); break;
    case "monthly": out.setMonth(out.getMonth() + n); break;
    case "yearly": out.setFullYear(out.getFullYear() + n); break;
    default: out.setDate(out.getDate() + n * 7); break; // default weekly
  }
  return out;
}

// Normalise the many shapes callers use (AI's {frequency,start_date,end_date},
// RecurrenceSection's {frequency,interval,end_type,count,until}) into one rule.
export function normalizeRule(input = {}) {
  const rule = { ...input };
  let frequency = rule.frequency || "weekly";
  let interval = Math.max(1, Number(rule.interval) || 1);

  // "biweekly" is sugar for weekly/interval 2 internally, but we keep it as a
  // distinct frequency so labels read naturally. Both work in addStep.
  if (frequency === "fortnightly") frequency = "biweekly";

  const days_of_week = Array.isArray(rule.days_of_week)
    ? rule.days_of_week.map(Number).filter((d) => d >= 0 && d <= 6)
    : [];

  // Resolve the end condition. Accept legacy {end_date}/{until} and {count}.
  let end_type = rule.end_type;
  const until = rule.until || rule.end_date || "";
  if (!end_type) {
    if (rule.count) end_type = "count";
    else if (until) end_type = "until";
    else end_type = "never";
  }

  return {
    frequency,
    interval,
    days_of_week,
    end_type,
    count: rule.count ? Math.max(2, Number(rule.count)) : undefined,
    until: until || undefined,
  };
}

// Expand a rule into an ordered list of "YYYY-MM-DD" strings.
//
// opts:
//   from        — only emit dates on/after this (Date|string); defaults to startDate
//   horizonEnd  — never emit past this date (Date|string); for "never" rules
//                 this defaults to today + HORIZON_MONTHS
//   today       — reference "now" (Date|string), for horizon math in tests
export function expandRecurrence(startDate, ruleInput = {}, opts = {}) {
  const start = parseDate(startDate);
  if (!start) return [];
  const rule = normalizeRule(ruleInput);

  const today = parseDate(opts.today) || (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12); })();
  const from = parseDate(opts.from);

  // Compute the latest date we'll consider.
  let hardEnd;
  if (rule.end_type === "until" && rule.until) {
    hardEnd = parseDate(rule.until);
  } else if (rule.end_type === "never") {
    hardEnd = parseDate(opts.horizonEnd) || addStep(today, "monthly", HORIZON_MONTHS);
  } else {
    // "count" — bounded by count below; use a generous date ceiling.
    hardEnd = parseDate(opts.horizonEnd) || addStep(start, "yearly", 5);
  }

  const maxCount = rule.end_type === "count" && rule.count ? rule.count : MAX_OCCURRENCES;
  const dates = [];

  // Weekly with explicit days-of-week: step week-by-week (respecting interval),
  // emitting each selected weekday within the week of the cursor.
  if (rule.frequency === "weekly" && rule.days_of_week.length > 0) {
    // Anchor to the Sunday of the start week so interval counts weeks cleanly.
    let weekStart = new Date(start.getTime());
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    let produced = 0;
    while (produced < maxCount) {
      for (const dow of [...rule.days_of_week].sort((a, b) => a - b)) {
        const d = new Date(weekStart.getTime());
        d.setDate(d.getDate() + dow);
        if (d < start) continue;
        if (hardEnd && d > hardEnd) { produced = maxCount; break; }
        dates.push(d);
        produced += 1;
        if (produced >= maxCount) break;
      }
      weekStart = addStep(weekStart, "weekly", rule.interval);
      if (hardEnd && weekStart > hardEnd) break;
    }
  } else {
    let cursor = new Date(start.getTime());
    let produced = 0;
    while (produced < maxCount) {
      if (hardEnd && cursor > hardEnd) break;
      dates.push(new Date(cursor.getTime()));
      produced += 1;
      cursor = addStep(cursor, rule.frequency, rule.interval);
    }
  }

  let out = dates.map(toISO);
  if (from) {
    const fromISO = toISO(from);
    out = out.filter((d) => d >= fromISO);
  }
  // Dedup + sort defensively.
  return [...new Set(out)].sort();
}

// True when a rule has no fixed end (so its series should be topped up over time).
export function isOpenEnded(ruleInput = {}) {
  return normalizeRule(ruleInput).end_type === "never";
}

// A short human label for a rule, e.g. "Weekly on Thu" / "Every 2 weeks".
export function describeRule(ruleInput = {}) {
  const rule = normalizeRule(ruleInput);
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const unit = { daily: "day", weekly: "week", biweekly: "2 weeks", monthly: "month", yearly: "year" }[rule.frequency] || "week";
  let base;
  if (rule.interval > 1 && rule.frequency !== "biweekly") base = `Every ${rule.interval} ${unit}s`;
  else base = { daily: "Daily", weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", yearly: "Yearly" }[rule.frequency] || "Weekly";
  if (rule.frequency === "weekly" && rule.days_of_week.length) {
    base += ` on ${rule.days_of_week.map((d) => DOW[d]).join(", ")}`;
  }
  if (rule.end_type === "until" && rule.until) base += ` until ${rule.until}`;
  else if (rule.end_type === "count" && rule.count) base += ` (${rule.count}×)`;
  else base += " (ongoing)";
  return base;
}

export { format };
