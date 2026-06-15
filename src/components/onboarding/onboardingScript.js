export const LANGUAGE_OPTIONS = ["English", "Hebrew", "Spanish", "French", "German"];
export const PROFESSION_OPTIONS = ["Guitarist", "Pianist", "Singer", "Drummer", "Teacher", "Producer"];
export const CURRENCY_OPTIONS = ["GBP", "USD", "EUR", "AUD", "CAD"];

// Step types:
//   say  — assistant bubble, auto-advances
//   ask  — assistant bubble + enables input; answer stored under `field`
// `prompt`/`text` are functions of the answers collected so far.
// The last step may carry `actions` rendered as tappable buttons.
export const STEPS = [
  {
    id: "intro",
    type: "say",
    text: () => "Hey, you made it! Welcome to Flowtone 🎉 I'm the AI living inside this app — think of me as your roadie, manager, and accountant rolled into one. Minus the attitude.",
  },
  {
    id: "user_name",
    type: "ask",
    field: "user_name",
    prompt: () => "First things first — what should I call you?",
    input: { kind: "text", placeholder: "Your name" },
  },
  {
    id: "assistant_name",
    type: "ask",
    field: "assistant_name",
    prompt: (a) => `Nice to meet you, ${a.user_name}! Now the fun part — you get to name me. Go on, anything beats "Assistant".`,
    input: { kind: "text", placeholder: "Flow", defaultValue: "Flow" },
  },
  {
    id: "language",
    type: "ask",
    field: "language",
    prompt: (a) => `${a.assistant_name}... I love it. Already feels like me. Which language should I speak?`,
    input: { kind: "chips", options: LANGUAGE_OPTIONS, allowFreeText: true, placeholder: "Or type another language" },
  },
  {
    id: "profession",
    type: "ask",
    field: "profession",
    prompt: () => "And what's your thing? Pick one or tell me in your own words.",
    input: { kind: "chips", options: PROFESSION_OPTIONS, allowFreeText: true, placeholder: "Or describe what you do" },
  },
  {
    id: "business_name",
    type: "ask",
    field: "business_name",
    prompt: (a) => `Now the business side. What name goes on your invoices — a business name, or just "${a.user_name}"? Send empty to use your own name.`,
    input: { kind: "text", placeholder: "Business or stage name", defaultValue: (a) => a.user_name },
  },
  {
    id: "currency",
    type: "ask",
    field: "currency",
    prompt: () => "And which currency do we get paid in? Arguably the most important question so far.",
    input: { kind: "chips", options: CURRENCY_OPTIONS },
  },
  {
    id: "tour_events",
    type: "say",
    text: (a) => `Alright ${a.user_name}, quick backstage tour. Events is where your gigs, lessons and rehearsals live — dates, venues, fees. No more notes scribbled on napkins.`,
  },
  {
    id: "tour_invoices",
    type: "say",
    text: () => "Invoices? Built right in. Create one from any gig, fire it off, and I'll flag the late payers in your daily briefing. I never get tired of chasing money for you.",
  },
  {
    id: "tour_ai",
    type: "say",
    text: (a) => `And me — ${a.assistant_name}? Tap the sparkle button anytime and just talk. "Book a wedding gig next Friday for £400" — done before the drummer counts in.`,
  },
  {
    id: "tour_settings",
    type: "say",
    text: (a) => `I've already set up "${a.business_name || a.user_name}" and ${a.currency || "GBP"} for your invoices. One thing only you can do: drop your logo into Settings → Business Profile, and your invoices go from plain to pro.`,
  },
  {
    id: "connect",
    type: "say",
    text: (a) => `That's the tour, ${a.user_name}! One last step — switch on what you want. You can change any of these later in Settings.`,
    connect: true,
  },
];
