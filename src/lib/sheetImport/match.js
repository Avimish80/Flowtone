// Pairs spreadsheet rows with gigs already in Flowtone. A row can only pair
// with a gig on the same day or one day either side, and each gig takes at most
// one row: the strongest pairs are settled first. Weak pairs are flagged for
// the user to check rather than dropped or trusted.
import { similarity } from "./values";

const DAY = 86400000;
const dayDiff = (a, b) => Math.round(Math.abs(Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / DAY);

const MIN_SCORE = 0.35;
const SURE_SCORE = 0.6;

function words(s) {
  return String(s || "").toLowerCase().split(/[^a-z0-9א-ת]+/).filter((w) => w.length > 2);
}

/**
 * How alike a row and a gig are. Title similarity, plus the client's name
 * showing in the gig (as its client or in its title), the venue, the fee
 * written in the title, and a pair being the only row and only gig of the day.
 */
function score(row, event, { clientName, aloneOnDay }) {
  let s = similarity(row.title, event.title);
  const client = String(row.client || "").toLowerCase().trim();
  if (client) {
    const cw = words(client);
    if (clientName && similarity(client, clientName) > 0.7) s += 0.2;
    else if (cw.length && cw.every((w) => words(event.title).includes(w))) s += 0.15;
  }
  if (row.location && event.location_address) s += 0.15 * similarity(row.location, event.location_address.split("\n")[0]);
  if (aloneOnDay) s += 0.25;
  if (row.date !== event.date) s -= 0.15;
  return s;
}

/**
 * rows: [{ date: "yyyy-MM-dd"|null, title, client, location }] (already parsed)
 * anchors: row index → gig id known for certain (the row's invoice number is
 * already on that gig's invoice in Flowtone); these pair first, whatever the date.
 * → per row { eventId|null, score, sure, nearby: eventIds within a week, nearest first }
 */
export function matchRows(rows, events, clientMap = {}, anchors = new Map()) {
  const byDate = new Map();
  for (const e of events) {
    if (!e.date) continue;
    byDate.set(e.date, [...(byDate.get(e.date) || []), e]);
  }
  const rowsOnDay = new Map();
  rows.forEach((r) => r.date && rowsOnDay.set(r.date, (rowsOnDay.get(r.date) || 0) + 1));

  const pairs = [];
  rows.forEach((row, i) => {
    if (!row.date) return;
    for (const offset of [0, -1, 1]) {
      const d = new Date(Date.parse(row.date + "T12:00:00Z") + offset * DAY).toISOString().slice(0, 10);
      for (const e of byDate.get(d) || []) {
        const aloneOnDay = offset === 0 && rowsOnDay.get(row.date) === 1 && (byDate.get(row.date) || []).length === 1;
        const s = score(row, e, { clientName: clientMap[e.client_id]?.name?.toLowerCase(), aloneOnDay });
        if (s >= MIN_SCORE) pairs.push({ i, e, s });
      }
    }
  });
  pairs.sort((a, b) => b.s - a.s);

  const taken = new Set();
  const result = rows.map(() => ({ eventId: null, score: 0, sure: false, nearby: [] }));
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const [i, eventId] of anchors) {
    const e = byId.get(eventId);
    if (!e || taken.has(eventId) || !result[i]) continue;
    taken.add(eventId);
    // Paired by invoice number: sure when the dates agree, else for the user to check.
    result[i] = { eventId, score: 1, sure: !!rows[i].date && dayDiff(rows[i].date, e.date) <= 1, byInvoice: true, nearby: [] };
  }
  for (const { i, e, s } of pairs) {
    if (result[i].eventId || taken.has(e.id)) continue;
    taken.add(e.id);
    result[i] = { eventId: e.id, score: s, sure: s >= SURE_SCORE, nearby: [] };
  }

  const dated = events.filter((e) => e.date);
  rows.forEach((row, i) => {
    if (!row.date) return;
    result[i].nearby = dated
      .map((e) => ({ id: e.id, d: dayDiff(row.date, e.date) }))
      .filter((x) => x.d <= 7)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.id);
    // The paired gig is always offered, even when an invoice put it further away.
    if (result[i].eventId && !result[i].nearby.includes(result[i].eventId)) result[i].nearby.unshift(result[i].eventId);
  });
  return result;
}
