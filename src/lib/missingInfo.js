// Missing-information detection — shared by the push scheduler and the dashboard
// briefing so on-device notifications and in-app cards never disagree.
//
// The assistant flags when a field is missing in a way that BLOCKS the app from
// helping: no location (can't plan travel), no fee (can't make the invoice).
// All finders are pure: (events, documents, now) where `now` is ms.

/** Parse "YYYY-MM-DD" + optional "HH:MM" into a local Date (matches pushManager). */
function parseLocal(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (timeStr) {
    const [h, min] = timeStr.split(':').map(Number);
    return new Date(y, m - 1, d, h, min, 0, 0);
  }
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

// ─── Predicates ───────────────────────────────────────────────────────────────

/** Billable = anything we'd invoice. Only Practice and cancelled events are out. */
export function isBillableGig(e) {
  return e.status !== 'cancelled' && e.event_type !== 'Practice';
}

export function hasLocation(e) {
  return typeof e.location_address === 'string' && e.location_address.trim() !== '';
}

/** Fee may arrive as string/null/''/0 — all of those mean "no fee". */
export function hasFee(e) {
  return Number(e.base_price) > 0 || Number(e.total_price) > 0;
}

/** End datetime in ms (end_time, falling back to start_time, then date-midnight). */
export function eventEndMs(e) {
  return parseLocal(e.date, e.end_time || e.start_time)?.getTime() ?? null;
}

/** Start datetime in ms (start_time, falling back to date-midnight). */
export function eventStartMs(e) {
  return parseLocal(e.date, e.start_time)?.getTime() ?? null;
}

export function isUpcoming(e, now) {
  const start = eventStartMs(e);
  return start != null && start >= now;
}

/** Past = the gig is over (uses END datetime), matching isEventDone in Dashboard. */
export function isPastGig(e, now) {
  const end = eventEndMs(e);
  return end != null && end < now;
}

/** Any invoice (draft OR sent) linked to the event — a draft means fee is known. */
export function hasInvoice(e, documents) {
  return documents.some(
    (d) => d.document_type === 'invoice' && d.work_event_id === e.id
  );
}

/**
 * Source-agnostic "came from outside" check. Today the only external source is
 * Google Calendar (created_from_gcal). A future email→event flow sets the same
 * kind of flag and slots in here only — nothing downstream needs to change.
 * The flag is sticky (never cleared once set), so callers must ALWAYS pair it
 * with a live empty-field check, never notify on the flag alone.
 */
export function isExternalEvent(e) {
  return e.created_from_gcal === true;
}

// ─── Finders ──────────────────────────────────────────────────────────────────

/** Scenario 1: upcoming billable gigs with no location → can't plan travel. */
export function gigsMissingLocation(events, documents, now) {
  return events.filter(
    (e) => isBillableGig(e) && isUpcoming(e, now) && !hasLocation(e)
  );
}

/**
 * Scenario 2: past billable gigs with no fee and no invoice yet → the app can't
 * even create the invoice because the amount is unknown. This is the case both
 * the post-gig nudge and the briefing currently hide (they require fee > 0).
 */
export function gigsMissingFee(events, documents, now) {
  return events.filter(
    (e) =>
      isBillableGig(e) &&
      isPastGig(e, now) &&
      !hasFee(e) &&
      !hasInvoice(e, documents)
  );
}

/**
 * Scenario 3: events imported from outside that are upcoming and still missing a
 * location and/or fee. Returns a wrapper so copy can name what's missing.
 */
export function importedEventsIncomplete(events, documents, now) {
  return events
    .filter(
      (e) =>
        isExternalEvent(e) &&
        isBillableGig(e) &&
        isUpcoming(e, now) &&
        (!hasLocation(e) || !hasFee(e))
    )
    .map((e) => ({
      event: e,
      missingLocation: !hasLocation(e),
      missingFee: !hasFee(e),
    }));
}
