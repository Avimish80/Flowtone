export const LANGUAGE_OPTIONS = ["English", "Hebrew", "Spanish", "French", "German"];
export const PROFESSION_OPTIONS = ["Guitarist", "Pianist", "Singer", "Drummer", "Teacher", "Producer"];

// Step types:
//   say  — assistant bubble, auto-advances
//   ask  — assistant bubble + enables input; answer stored under `field`
// `prompt`/`text` are functions of the answers collected so far.
// The last step may carry `actions` rendered as tappable buttons.
export const STEPS = [
  {
    id: "intro",
    type: "say",
    text: () => "Hey! Welcome to Flowtone. I'm the AI assistant that lives inside this app — I can book your gigs, build your invoices, and keep your music business on track.",
  },
  {
    id: "user_name",
    type: "ask",
    field: "user_name",
    prompt: () => "First things first — what's your name? What should I call you?",
    input: { kind: "text", placeholder: "Your name" },
  },
  {
    id: "assistant_name",
    type: "ask",
    field: "assistant_name",
    prompt: (a) => `Nice to meet you, ${a.user_name}! Now it's your turn to name me. What would you like to call your assistant?`,
    input: { kind: "text", placeholder: "Flow", defaultValue: "Flow" },
  },
  {
    id: "language",
    type: "ask",
    field: "language",
    prompt: (a) => `${a.assistant_name} — I like it. Which language would you like me to speak?`,
    input: { kind: "chips", options: LANGUAGE_OPTIONS, allowFreeText: true, placeholder: "Or type another language" },
  },
  {
    id: "profession",
    type: "ask",
    field: "profession",
    prompt: () => "And what do you do? Pick one or tell me in your own words.",
    input: { kind: "chips", options: PROFESSION_OPTIONS, allowFreeText: true, placeholder: "Or describe what you do" },
  },
  {
    id: "tour_events",
    type: "say",
    text: (a) => `Perfect, ${a.user_name}. Quick tour: in Events you track every gig, lesson and rehearsal — dates, venues, fees, all in one place.`,
  },
  {
    id: "tour_invoices",
    type: "say",
    text: () => "Invoices are built right in. Create one from any event, send it, and I'll flag the late payers in your daily briefing.",
  },
  {
    id: "tour_ai",
    type: "say",
    text: (a) => `And me — ${a.assistant_name}? Tap the sparkle button anytime. Say "book a wedding gig next Friday for £400" and I'll set it all up for you.`,
  },
  {
    id: "tour_done",
    type: "say",
    text: () => "That's it — you're ready. Where would you like to start?",
    actions: [
      { label: "Create my first gig", kind: "navigate", page: "WorkEventDetail" },
      { label: "Ask the assistant", kind: "ai_prefill", message: "What can you help me with?" },
      { label: "Take me to my dashboard", kind: "finish" },
    ],
  },
];
