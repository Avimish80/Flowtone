// Notification preferences: schema, defaults, and helpers

// ─── Schema ──────────────────────────────────────────────────────────────────
// Defines every notification type, its label, description, and timing options.

export const NOTIF_SCHEMA = [
  {
    layer: 1,
    label: 'Gig Execution',
    emoji: '🎸',
    types: [
      {
        key: 'gig_day_before',
        label: 'Day before reminder',
        example: '"Gig tomorrow: Blue Moon Jazz at 18:30"',
        timingKey: 'timing',
        timingOptions: [
          { value: '2days_9am', label: '2 days before (9am)' },
          { value: 'day_9am',   label: 'Day before (9am)' },
          { value: 'day_6pm',   label: 'Day before (6pm)' },
        ],
      },
      {
        key: 'gig_day_of_summary',
        label: 'Day-of morning summary',
        example: '"Today: 2 gigs · next at 16:50"',
        timingKey: null,
      },
      {
        key: 'gig_load_in',
        label: 'Load-in / call time',
        example: '"Call time in 1 hour: Blue Moon Jazz Club"',
        timingKey: 'timing',
        timingOptions: [
          { value: '30min', label: '30 min before' },
          { value: '60min', label: '1 hour before' },
          { value: '90min', label: '90 min before' },
        ],
      },
      {
        key: 'gig_leave_now',
        label: 'Leave now alert',
        example: '"Leave in 20 min for Blue Moon Jazz Club"',
        timingKey: 'timing',
        timingOptions: [
          { value: '60min',  label: '1 hour before' },
          { value: '90min',  label: '90 min before' },
          { value: '120min', label: '2 hours before' },
        ],
      },
      {
        key: 'gig_starting_soon',
        label: 'Starting soon',
        example: '"Starting in 30 min: Jazz Night"',
        timingKey: 'timing',
        timingOptions: [
          { value: '15min', label: '15 min before' },
          { value: '30min', label: '30 min before' },
          { value: '45min', label: '45 min before' },
        ],
      },
    ],
  },
  {
    layer: 2,
    label: 'Finance',
    emoji: '💰',
    types: [
      {
        key: 'invoice_not_sent',
        label: 'Invoice not sent',
        example: '"You played Jazz Night yesterday. Send invoice?"',
        timingKey: null,
      },
      {
        key: 'invoice_due_soon',
        label: 'Invoice due soon',
        example: '"Invoice #INV-001 is due in 2 days"',
        timingKey: 'days_before',
        timingOptions: [
          { value: 1, label: '1 day before due' },
          { value: 2, label: '2 days before due' },
          { value: 3, label: '3 days before due' },
          { value: 7, label: '1 week before due' },
        ],
      },
      {
        key: 'gig_needs_fee',
        label: 'Missing fee (blocks invoice)',
        example: '"I need the fee for Jazz Night so I can make the invoice"',
        timingKey: null,
      },
      {
        key: 'invoice_overdue',
        label: 'Overdue invoice alert',
        example: '"Invoice #INV-001 is now overdue by 3 days"',
        timingKey: null,
      },
      {
        key: 'invoice_weekly_summary',
        label: 'Weekly unpaid summary',
        example: '"£1,250 unpaid across 3 invoices" · Monday 8am',
        timingKey: null,
      },
    ],
  },
  {
    layer: 3,
    label: 'Admin',
    emoji: '📋',
    types: [
      {
        key: 'missing_venue',
        label: 'Missing venue warning',
        example: '"I can\'t plan travel to Wedding Reception — no location yet"',
        timingKey: null,
      },
      {
        key: 'imported_event_incomplete',
        label: 'Imported event missing details',
        example: '"I added \'Wedding\' from your calendar but it has no location"',
        timingKey: null,
      },
      {
        key: 'unconfirmed_followup',
        label: 'Unconfirmed event follow-up',
        example: '"Studio Session is still tentative. Review?"',
        timingKey: null,
      },
      {
        key: 'risk_alert',
        label: 'Risk alert',
        example: '"Wedding: no venue, no invoice, no deposit"',
        timingKey: null,
      },
    ],
  },
  {
    layer: 4,
    label: 'Practice',
    emoji: '🎯',
    types: [
      {
        key: 'practice_reminder',
        label: 'Practice session reminder',
        example: '"Practice session in 30 min: sweeping technique"',
        timingKey: 'timing',
        timingOptions: [
          { value: '15min', label: '15 min before' },
          { value: '30min', label: '30 min before' },
        ],
      },
      {
        key: 'goal_deadline',
        label: 'Goal deadline reminder',
        example: '"Your technique goal is due in 3 days"',
        timingKey: null,
      },
    ],
  },
  {
    layer: 5,
    label: 'Smart Assistant',
    emoji: '🤖',
    types: [
      {
        key: 'daily_briefing',
        label: 'Daily briefing',
        example: '"Today: 1 gig at 18:30, leave at 17:10, 2 unpaid" · 7am',
        timingKey: null,
      },
      {
        key: 'weekly_digest',
        label: 'Weekly digest',
        example: '"This week: 4 gigs, £750 invoiced, £250 overdue" · Monday 8am',
        timingKey: null,
      },
    ],
  },
];

// ─── Default prefs by level ───────────────────────────────────────────────────

export const DEFAULT_PREFS = {
  minimal: {
    gig_day_before:          { enabled: false, timing: 'day_9am' },
    gig_day_of_summary:      { enabled: false },
    gig_load_in:             { enabled: false, timing: '60min' },
    gig_leave_now:           { enabled: true,  timing: '90min' },
    gig_starting_soon:       { enabled: true,  timing: '30min' },
    invoice_not_sent:        { enabled: true },
    gig_needs_fee:           { enabled: true },
    invoice_due_soon:        { enabled: false, days_before: 2 },
    invoice_overdue:         { enabled: true },
    invoice_weekly_summary:  { enabled: false },
    missing_venue:           { enabled: false },
    imported_event_incomplete: { enabled: false },
    unconfirmed_followup:    { enabled: false },
    risk_alert:              { enabled: false },
    practice_reminder:       { enabled: false, timing: '30min' },
    goal_deadline:           { enabled: false },
    daily_briefing:          { enabled: false },
    weekly_digest:           { enabled: false },
  },
  standard: {
    gig_day_before:          { enabled: true,  timing: 'day_9am' },
    gig_day_of_summary:      { enabled: false },
    gig_load_in:             { enabled: true,  timing: '60min' },
    gig_leave_now:           { enabled: true,  timing: '90min' },
    gig_starting_soon:       { enabled: true,  timing: '30min' },
    invoice_not_sent:        { enabled: true },
    gig_needs_fee:           { enabled: true },
    invoice_due_soon:        { enabled: true,  days_before: 2 },
    invoice_overdue:         { enabled: true },
    invoice_weekly_summary:  { enabled: true },
    missing_venue:           { enabled: true },
    imported_event_incomplete: { enabled: true },
    unconfirmed_followup:    { enabled: false },
    risk_alert:              { enabled: false },
    practice_reminder:       { enabled: false, timing: '30min' },
    goal_deadline:           { enabled: false },
    daily_briefing:          { enabled: true },
    weekly_digest:           { enabled: false },
  },
  full: {
    gig_day_before:          { enabled: true,  timing: 'day_9am' },
    gig_day_of_summary:      { enabled: true },
    gig_load_in:             { enabled: true,  timing: '60min' },
    gig_leave_now:           { enabled: true,  timing: '90min' },
    gig_starting_soon:       { enabled: true,  timing: '30min' },
    invoice_not_sent:        { enabled: true },
    gig_needs_fee:           { enabled: true },
    invoice_due_soon:        { enabled: true,  days_before: 2 },
    invoice_overdue:         { enabled: true },
    invoice_weekly_summary:  { enabled: true },
    missing_venue:           { enabled: true },
    imported_event_incomplete: { enabled: true },
    unconfirmed_followup:    { enabled: true },
    risk_alert:              { enabled: true },
    practice_reminder:       { enabled: false, timing: '30min' },
    goal_deadline:           { enabled: false },
    daily_briefing:          { enabled: true },
    weekly_digest:           { enabled: true },
  },
};

/**
 * Returns effective prefs for a given level.
 * For "full" level, merges user-saved customisations on top of the full defaults.
 */
export function getEffectivePrefs(level = 'standard', userPrefs = {}) {
  const base = DEFAULT_PREFS[level] ?? DEFAULT_PREFS.standard;
  if (level !== 'full') return base;
  // Deep-merge user overrides into full defaults
  const merged = {};
  for (const key of Object.keys(base)) {
    merged[key] = { ...base[key], ...(userPrefs[key] ?? {}) };
  }
  return merged;
}

/** Parse timing strings like '90min' → minutes as number */
export function timingToMinutes(str) {
  if (!str) return 0;
  const n = parseInt(str, 10);
  return isNaN(n) ? 0 : n;
}
