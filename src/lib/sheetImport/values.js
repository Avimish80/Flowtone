// Turning loose spreadsheet cells into Flowtone values. Spreadsheets kept by
// hand are messy: "£1,050", "TBC", "26/10/2025", "Invoiced (sent)", "Paid".
// Every parser returns null when it can't be sure, never a guess.

const pad = (n) => String(n).padStart(2, "0");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const month = (word) => MONTHS.indexOf(String(word).slice(0, 3).toLowerCase()) + 1;
const year = (y) => (String(y).length === 2 ? 2000 + Number(y) : Number(y));
const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;

// Leading weekday ("Sat 26/10/2025") and trailing time ("26/10/2025 19:30",
// "26 Oct 2025 7.30pm") are dropped before the date itself is read.
function bare(s) {
  return s
    .replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, "")
    .replace(/[\sT,]+(at\s+)?\d{1,2}([:.]\d{2}){1,2}\s*(am|pm)?$/i, "")
    .replace(/\s+(at\s+)?\d{1,2}\s*(am|pm)$/i, "")
    .trim();
}

/**
 * → "yyyy-MM-dd" or null. order = "dmy" (UK, the default) or "mdy" (US) for
 * d/m/y numbers that could be either; a part over 12 settles it regardless.
 * Month names are read here, not by Date.parse, which differs between Safari
 * and Chrome. A month without a day ("October 2025") is not a date.
 */
export function parseDate(v, order = "dmy") {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  // A bare Excel day count (a date cell that lost its date format).
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = bare(String(v).trim());
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(NUMERIC_DATE);
  if (m) {
    const [a, b, y] = [+m[1], +m[2], year(m[3])];
    if (a > 12) return valid(y, b, a);
    if (b > 12) return valid(y, a, b);
    return order === "mdy" ? valid(y, a, b) : valid(y, b, a);
  }
  // "26 Oct 2025", "26th October, 2025", "26-Oct-25"
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s/-]+([a-z]{3,9})\.?,?[\s/-]+(\d{2}|\d{4})$/i);
  if (m && month(m[2])) return valid(year(m[3]), month(m[2]), +m[1]);
  // "October 26, 2025", "Oct 26 2025"
  m = s.match(/^([a-z]{3,9})\.?[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (m && month(m[1])) return valid(+m[3], month(m[1]), +m[2]);
  return null;
}

/**
 * Day-first or month-first for a whole column: any value whose first part is
 * over 12 makes it UK, any whose second part is, US. Undecided stays UK.
 */
export function dateOrder(values) {
  let uk = 0, us = 0;
  for (const v of values) {
    const m = typeof v === "string" && bare(v.trim()).match(NUMERIC_DATE);
    if (!m) continue;
    if (+m[1] > 12) uk++;
    else if (+m[2] > 12) us++;
  }
  return us > 0 && uk === 0 ? "mdy" : "dmy";
}

function valid(y, mo, d) {
  if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/**
 * "£1,050.00" / "1050" / 850 / "850,00" / "1.050,00" → number;
 * "TBC", "", "cash" → null.
 */
export function parseMoney(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) && v > 0 ? v : null;
  let s = String(v).replace(/[£$€\s\u00a0\u202f]/g, "").replace(/^(gbp|eur|usd)|(gbp|eur|usd)$/i, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.050,00
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", "."); // 850,00
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ""); // 1,050.00
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/**
 * A fee written into a gig's name: "Dosim 600", "Serge pro 750". Skips years,
 * phone numbers, ordinals ("50th"), head counts ("150 guests") and venues named
 * by a number ("The 100 Club", "606 Club").
 */
export function feeFromName(title) {
  const t = String(title || "")
    .replace(/\+?\d[\d\s]{8,}\d/g, " ")
    .replace(/\b(19|20)\d\d\b/g, " ")
    .replace(/\b\d+\s*(st|nd|rd|th)\b/gi, " ")
    .replace(/\b\d+\s*(guests?|people|pax|ppl|persons?|covers|mins|minutes|hours?|hrs|miles|km|years?|yrs)\b/gi, " ")
    .replace(/\b\d+\s+club\b/gi, " ");
  const nums = [...t.matchAll(/(?<![\d.:/])(\d{2,5})(?![\d:/])/g)].map((m) => Number(m[1])).filter((n) => n >= 50 && n <= 20000);
  return nums.length === 1 ? nums[0] : null;
}

/**
 * Extras cell → { adjustments: [{label, amount}], notes: [] }.
 * "Travel day 11 Aug: 300; Food allowance: £35" → two add-ons.
 * Items without an amount ("Reception guitar — amount TBC") become notes.
 * An item equal to the base fee and called a "day"/"fee" is the base itself.
 */
export function parseExtras(v, base) {
  const out = { adjustments: [], notes: [] };
  for (const part of String(v || "").split(/;|\n/).map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)[:=–—-]\s*£?\s*(\d+(?:\.\d+)?)\s*$/);
    if (m && base != null && Number(m[2]) === base && /\b(day|fee|base)\b/i.test(m[1])) {
      out.notes.push(`${m[1].trim()}: ${m[2]} (the base fee)`);
    } else if (m) {
      out.adjustments.push({ label: m[1].trim(), amount: Number(m[2]) });
    } else {
      out.notes.push(part);
    }
  }
  return out;
}

const has = (v, re) => re.test(String(v || "").toLowerCase());

/** Gig status cell → "cancelled" | null (other statuses are left to the app). */
export function gigStatusFrom(v) {
  return has(v, /cancel|postpon|called off/) ? "cancelled" : null;
}

// "not paid", "Not invoiced yet", "unpaid", "un-sent": the word is negated.
const NEGATED = /\b(?:not|no|un)[\s-]*(?:yet\s+)?(paid|invoiced|sent|issued)\b/g;
const PARTIAL = /\b(part|partly|partial|partially|deposit|half|instal?ments?)\b/;

/**
 * The paid cell on its own → "paid" | "unpaid" | "partial" | null.
 * Airtable exports a ticked checkbox as "checked"; a payment date means paid.
 */
export function paidCellState(v) {
  if (v === true) return "paid";
  if (v === false) return "unpaid";
  if (typeof v === "number") return v === 1 || parseDate(v) ? "paid" : v === 0 ? "unpaid" : null;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (PARTIAL.test(s)) return "partial";
  if (/^(no|n|false|0|unpaid|not|pending|outstanding|owed|overdue|due)\b/.test(s)) return "unpaid";
  if (/^(yes|y|paid|true|✓|✔|✅|☑|x|checked|1|received|done|settled|cleared)(?![a-z0-9])/.test(s)) return "paid";
  if (parseDate(s)) return "paid";
  return null;
}

/**
 * Invoice state from the invoice-status and/or paid cells →
 * "paid" | "sent" | "draft" | null. "Drafted, NOT sent" is a draft;
 * "Invoiced, not paid" and "Part paid" are sent; "Not invoiced" is nothing.
 */
export function invoiceStatusFrom(statusCell, paidCell) {
  const paid = paidCellState(paidCell);
  if (paid === "paid") return "paid";
  const raw = String(statusCell ?? "").toLowerCase();
  const negated = new Set([...raw.matchAll(NEGATED)].map((m) => m[1]));
  const s = raw.replace(NEGATED, " ");
  const partial = paid === "partial" || PARTIAL.test(s);
  if (/\bpaid\b/.test(s) && !partial) return "paid";
  if (/draft|to send/.test(s) || negated.has("sent") || negated.has("issued")) return "draft";
  if (/\b(sent|invoiced|issued|overdue|outstanding|awaiting|chased)\b/.test(s)) return "sent";
  // Paid in part, or not paid yet: issued and still owed.
  // A bare "No" in a paid column says nothing about whether it was invoiced.
  const owed = /\bpaid\b/.test(s) || negated.has("paid") || paid === "partial";
  if (owed) return negated.has("invoiced") ? null : "sent";
  return null;
}

/** "430", 430, "INV-0430", "cash (placeholder)" → the usable invoice number or null. */
export function invoiceNumberFrom(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return s;
  if (/^[A-Z]{2,5}[-_ ]?\d+$/i.test(s)) return s.toUpperCase();
  return null;
}

export function isCash(v) {
  return has(v, /\bcash\b/);
}

/** Bigram (Dice) similarity of two titles, 0..1, ignoring punctuation and case. */
export function similarity(a, b) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9א-ת]+/g, " ").trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const wa = new Set(A.split(" ")), wb = new Set(B.split(" "));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const jaccard = shared / new Set([...wa, ...wb]).size;
  const grams = (s) => {
    const g = new Map();
    for (let i = 0; i < s.length - 1; i++) g.set(s.slice(i, i + 2), (g.get(s.slice(i, i + 2)) || 0) + 1);
    return g;
  };
  const ga = grams(A), gb = grams(B);
  let inter = 0;
  for (const [k, n] of ga) inter += Math.min(n, gb.get(k) || 0);
  const dice = (2 * inter) / (A.length - 1 + B.length - 1 || 1);
  return Math.max(jaccard, dice);
}
