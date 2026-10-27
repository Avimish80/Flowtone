// Which spreadsheet column holds what. Every header is scored against every
// field (an exact name like "Fee" beats a loose one like "Fee notes", and
// words like "booked" or "deposit" rule a header out), then the best pairs are
// taken first. The date and gig-name columns fall back to looking at the
// values. The user can change every pick.
import { parseDate } from "./values";

export const FIELDS = [
  { key: "date", label: "Date", required: true },
  { key: "title", label: "Gig name" },
  { key: "client", label: "Client" },
  { key: "location", label: "Venue / location" },
  { key: "occasion", label: "Type / occasion" },
  { key: "fee", label: "Fee" },
  { key: "fee_in_name", label: "Fee written in the name" },
  { key: "extras", label: "Extras (travel, food...)" },
  { key: "payment_method", label: "Payment method" },
  { key: "status", label: "Gig status" },
  { key: "invoice_number", label: "Invoice number" },
  { key: "invoice_amount", label: "Invoice amount" },
  { key: "invoice_status", label: "Invoice status" },
  { key: "paid", label: "Paid?" },
  { key: "paid_date", label: "Date paid" },
  { key: "due_date", label: "Due date" },
  { key: "notes", label: "Notes" },
];

// field → { exact: header names (score 10), loose: [pattern, score], not: rules out }
const RULES = {
  date: {
    exact: /^((gig|event|show|performance|booking) )?date$|^(when|day)$|^date of (the )?(gig|event|show)$/,
    loose: [[/\b(gig|event|show|performance) date\b/, 9], [/date/, 4]],
    not: /book|creat|enquir|added|modif|updat|paid|payment|due|invoice|sent|deposit|receiv|birth/,
  },
  title: {
    exact: /^(gig|show|booking|job|title|name|gig name|event name|description|what)$/,
    loose: [[/gig|title|name|event|description|booking|job/, 5], [/^event$/, 4]],
    not: /date|fee|status|client|venue|location|type|invoice|paid|note|email|phone/,
  },
  client: {
    exact: /^(client|customer|agent|agency|booker|booked by|promoter|client name)$/,
    loose: [[/client|customer|agent|agency|booker|booked by|promoter/, 6]],
    not: /email|phone|tel|address|contact|number|#/,
  },
  location: {
    exact: /^(venue|location|address|place|where|city|town|venue address)$/,
    loose: [[/venue|location|address|place|where|city|town/, 6]],
    not: /email|client|billing|invoice/,
  },
  occasion: {
    exact: /^(occasion|event type|type|kind|category|gig type)$/,
    loose: [[/occasion|event type|kind|category/, 8], [/^event$/, 6], [/type/, 3]],
    not: /payment|invoice|client/,
  },
  fee: {
    exact: /^(fee|price|rate|amount|pay|total|gig fee|base fee|my fee|fee gbp|agreed fee)$/,
    loose: [[/fee|price|rate|amount|\bpay\b|total|£|\$|€/, 5]],
    not: /invoice|paid|deposit|balance|in (the )?(gig )?name|extra|travel|expense|tip|method|status|date|currency/,
  },
  fee_in_name: { loose: [[/fee.*\bname|\bname.*fee/, 11]] },
  extras: {
    exact: /^(extras?|add ons?|expenses?|travel|allowances?|mileage)$/,
    loose: [[/extra|add.?on|expense|travel|allowance|mileage|per diem/, 7]],
    not: /date|time/,
  },
  payment_method: { loose: [[/method|paid (by|via)|payment type|how paid/, 9]] },
  status: {
    exact: /^(status|gig status|event status|booking status|state|confirmed\??)$/,
    loose: [[/status|state|confirmed/, 4]],
    not: /invoice|payment|paid/,
  },
  invoice_number: { loose: [[/invoice\s*(#|no\b|num|number|ref|id\b)|^inv\.?\s*(#|no\b|number)|^#$/, 11]] },
  invoice_amount: { loose: [[/invoice.*(amount|total|value|sum|£)|(amount|total)\s*invoiced|invoiced\s*(amount|total)/, 11]] },
  invoice_status: {
    exact: /^(invoice\??|invoiced\??|invoice status|invoice state)$/,
    loose: [[/invoice status|^invoiced/, 9], [/invoice/, 3]],
    not: /date|sent on|number|#|\bno\b|amount|total|value|due|ref|\bid\b|£/,
  },
  paid: {
    exact: /^(paid\??|payment|payment status|paid status|settled\??|received\??)$/,
    loose: [[/\bpaid\b|payment status|settled/, 5]],
    not: /deposit|balance|date|\bon$|method|\bby\b|via|amount|£/,
  },
  paid_date: { loose: [[/(date|day)\s*(of\s*)?paid|paid\s*(on|date)|payment\s*(date|received)|date\s*of\s*payment|received\s*on/, 11]] },
  due_date: { loose: [[/\bdue\b/, 8]], not: /amount|balance|£/ },
  notes: {
    exact: /^(notes?|comments?|remarks?|memo|info|details?)$/,
    loose: [[/note|comment|check|remark|memo|info|detail/, 4]],
  },
};

const norm = (h) => String(h || "").toLowerCase().replace(/_+/g, " ").replace(/\s+/g, " ").trim();
// "Base Fee (£)" → "base fee": the bare name, for exact matches.
const plain = (h) => norm(h).replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9#?\s]/g, " ").replace(/\s+/g, " ").trim();

function score(header, rule) {
  const n = norm(header), p = plain(header);
  if (rule.not && rule.not.test(n)) return 0;
  if (rule.exact && rule.exact.test(p)) return 10;
  return Math.max(0, ...(rule.loose || []).filter(([re]) => re.test(n)).map(([, s]) => s));
}

/** → { [fieldKey]: headerName } */
export function guessMapping(headers, rows) {
  const pairs = [];
  for (const h of headers) {
    for (const [field, rule] of Object.entries(RULES)) {
      const s = score(h, rule);
      if (s > 0) pairs.push({ h, field, s });
    }
  }
  // Best pairs first; on a tie the column further left wins.
  pairs.sort((a, b) => b.s - a.s || headers.indexOf(a.h) - headers.indexOf(b.h));
  const mapping = {};
  const used = new Set();
  for (const { h, field } of pairs) {
    if (mapping[field] || used.has(h)) continue;
    mapping[field] = h;
    used.add(h);
  }
  // A lone "Event" column is the gig's name, not its occasion.
  if (!mapping.title && mapping.occasion && /^event$/.test(plain(mapping.occasion))) {
    mapping.title = mapping.occasion;
    delete mapping.occasion;
  }

  const sample = rows.slice(0, 200);
  const filled = (h) => sample.map((r) => r[h]).filter((v) => v != null && String(v).trim() !== "");
  if (!mapping.date) {
    const best = headers.filter((h) => !used.has(h))
      .map((h) => {
        const vals = filled(h);
        return { h, share: vals.length ? vals.filter((v) => parseDate(v)).length / vals.length : 0 };
      })
      .sort((a, b) => b.share - a.share)[0];
    if (best && best.share >= 0.6) { mapping.date = best.h; used.add(best.h); }
  }
  if (!mapping.title) {
    // The column with the longest text is usually the gig's name.
    const best = headers.filter((h) => !used.has(h))
      .map((h) => {
        const vals = filled(h).filter((v) => typeof v === "string" && !parseDate(v));
        return { h, len: vals.length ? vals.reduce((s, v) => s + v.length, 0) / sample.length : 0 };
      })
      .sort((a, b) => b.len - a.len)[0];
    if (best && best.len > 3) mapping.title = best.h;
  }
  return mapping;
}

/** One sheet row → raw values keyed by Flowtone field. */
export function toRecord(row, mapping) {
  return Object.fromEntries(FIELDS.map((f) => [f.key, mapping[f.key] ? row[mapping[f.key]] ?? null : null]));
}
