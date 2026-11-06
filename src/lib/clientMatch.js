// Work out which known client an unlinked event is for, from the words in its
// title, notes and location — e.g. a calendar import titled "Muzika optional"
// when there is a client called Muzika. Deterministic, instant, no AI call.

const norm = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const wholeWord = (hay, needle) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(needle)}(?=$|[^\\p{L}\\p{N}])`, "u").test(hay);

// Words too generic to identify a client on their own ("The Jazz Club" vs "jazz").
const GENERIC = new Set([
  "the", "and", "of", "at", "in", "for", "with",
  "band", "music", "musical", "musicians", "event", "events", "studio", "studios",
  "school", "academy", "college", "university", "church", "hotel", "hall", "club",
  "centre", "center", "company", "group", "agency", "entertainment", "productions",
  "ltd", "limited", "inc", "llc", "plc", "wedding", "weddings", "party", "parties",
  "corporate", "jazz", "live", "quartet", "trio", "duo", "orchestra", "ensemble",
  "london", "lesson", "lessons", "gig", "rehearsal", "session", "family", "mr", "mrs", "ms", "dr",
]);

/**
 * Returns { client, confidence: "high" | "low" } or null.
 * "high" = the full client name (or one of their emails) appears as whole words
 * — safe to link without asking. "low" = only a distinctive part of the name
 * matched, or more than one client did — ask first.
 */
export function suggestClientForEvent(event, clients) {
  const hay = norm([event?.title, event?.notes, event?.location_address].filter(Boolean).join(" \n "));
  if (!hay.trim() || !Array.isArray(clients)) return null;

  const exact = [];
  const partial = [];
  for (const c of clients) {
    const name = norm(c.name).trim();
    if (name.length < 3) continue;

    const emails = (c.emails || []).map(norm).filter(Boolean);
    if (wholeWord(hay, name) || emails.some((e) => hay.includes(e))) {
      exact.push(c);
      continue;
    }
    const words = name.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !GENERIC.has(w));
    if (words.some((w) => wholeWord(hay, w))) partial.push(c);
  }

  if (exact.length === 1) return { client: exact[0], confidence: "high" };
  if (exact.length > 1) {
    // "Blue Note" and "Blue Note Jazz Club" both hit — the longer, more
    // specific name is the better guess, but it is a guess.
    exact.sort((a, b) => norm(b.name).length - norm(a.name).length);
    return { client: exact[0], confidence: "low" };
  }
  if (partial.length === 1) return { client: partial[0], confidence: "low" };
  return null;
}
