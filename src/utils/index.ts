export function createPageUrl(pageName: string) {
    return '/' + pageName.replace(/ /g, '-');
}

const CURRENCY_SYMBOLS: Record<string, string> = {
    GBP: "£",
    USD: "$",
    EUR: "€",
    AUD: "A$",
    CAD: "C$",
};

export function currencySymbol(code?: string | null): string {
    if (!code) return "£";
    return CURRENCY_SYMBOLS[code] || code;
}

export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
    const sym = currencySymbol(currency);
    return `${sym}${(amount || 0).toFixed(2)}`;
}

// Lowercase nouns for each WorkEvent.event_type, so invoicing language matches
// what the events actually are (gigs vs lessons vs sessions, etc.).
const EVENT_TYPE_NOUNS: Record<string, { one: string; many: string }> = {
    Gig: { one: "gig", many: "gigs" },
    Lesson: { one: "lesson", many: "lessons" },
    Rehearsal: { one: "rehearsal", many: "rehearsals" },
    Session: { one: "session", many: "sessions" },
    Practice: { one: "practice session", many: "practice sessions" },
};

// Noun for a single event_type, singular or plural based on count.
export function eventTypeNoun(eventType?: string | null, count: number = 2): string {
    const entry = eventType ? EVENT_TYPE_NOUNS[eventType] : undefined;
    if (!entry) return count === 1 ? "event" : "events";
    return count === 1 ? entry.one : entry.many;
}

// Best noun to describe a set of events: if they share one type, use that
// type's noun; otherwise fall back to the generic "event(s)".
export function eventsNoun(events?: Array<{ event_type?: string | null }> | null, count?: number): string {
    const list = events || [];
    const types = Array.from(new Set(list.map((e) => e?.event_type).filter(Boolean)));
    const n = count == null ? (list.length || 2) : count;
    if (types.length === 1) return eventTypeNoun(types[0], n);
    return n === 1 ? "event" : "events";
}