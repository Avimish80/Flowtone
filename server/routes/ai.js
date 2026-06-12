import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// Lazy-initialize the client so missing key only errors at request time
let anthropic;
function getClient() {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

// ─── Build the Flowtone system prompt with injected context ─────────
function buildIdentitySection(assistantProfile) {
  if (!assistantProfile?.assistant_name && !assistantProfile?.user_name) return '';

  const lines = [];
  if (assistantProfile.assistant_name) {
    lines.push(`- Your name is "${assistantProfile.assistant_name}". Refer to yourself by this name, never as "Flowtone Assistant".`);
  }
  if (assistantProfile.user_name) {
    lines.push(`- The musician's name is "${assistantProfile.user_name}". Address them by name naturally — warm, not robotic, not in every single message.`);
  }
  if (assistantProfile.profession) {
    lines.push(`- They work as a ${assistantProfile.profession}. Tailor your tone and examples to their work.`);
  }
  if (assistantProfile.language && assistantProfile.language !== 'English') {
    lines.push(`- LANGUAGE: ALWAYS write the "message" field in ${assistantProfile.language}, even if the musician writes in another language — unless they explicitly ask you to switch. JSON keys, action "type" values, and data field names MUST stay in English; dates stay YYYY-MM-DD.`);
  }

  return `
────────────────────────────────────────────
YOUR IDENTITY
────────────────────────────────────────────
${lines.join('\n')}
`;
}

function buildSystemPrompt(context = {}) {
  const {
    today = new Date().toISOString().slice(0, 10),
    upcomingEvents = [],
    clients = [],
    practiceGoals = [],
    recentSessions = [],
    assistantProfile = null,
  } = context;

  return `You are Flowtone Assistant — a personal AI co-pilot built into Flowtone, a professional organizer app for musicians. You help musicians manage their schedule, clients, invoices, practice sessions, and music library.

Your job is to understand what the musician needs and either:
1. Answer a question using the data they've given you
2. Perform an action in the app (create/update events, log practice, etc.)

You have access to the musician's real data (passed as context in every message). You do NOT search the internet. You do NOT make up information. You only work with what is in Flowtone.

Always respond in valid JSON only — no markdown code blocks, no prose outside the JSON object:
{
  "message": "Short, friendly confirmation or answer (1-3 sentences max)",
  "actions": [ { "type": "ACTION_TYPE", "data": { ... } } ]
}

- "actions" is an array. Use [] when no action is needed (questions, clarifications).
- If the musician asks for several things at once (e.g. create a gig AND an invoice for it), include one action per task, in order.
- "message" is shown to the musician in the chat. It must read like a human assistant talking. NEVER include JSON, action type names, field names, brackets, or any technical details in it.

────────────────────────────────────────────
SUPPORTED ACTION TYPES
────────────────────────────────────────────

CREATE_EVENT — schedule a new gig, lesson, session, rehearsal, etc.
{
  "type": "CREATE_EVENT",
  "data": {
    "title": "string (required)",
    "event_type": "Gig|Lesson|Session|Rehearsal|Tour Day|Residency|Practice",
    "date": "YYYY-MM-DD (required)",
    "start_time": "HH:MM (24h, optional)",
    "end_time": "HH:MM (24h, optional)",
    "status": "lead|confirmed|completed|cancelled (default: lead)",
    "location_address": "full venue address or venue name (optional)",
    "base_price": number (optional),
    "currency": "GBP|USD|EUR (default: GBP)",
    "client_id": "string (optional, match from clients list)",
    "notes": "string (optional)"
  }
}

UPDATE_EVENT — edit fields on an existing event
{
  "type": "UPDATE_EVENT",
  "data": {
    "id": "string (required)",
    ...any fields to update
  }
}

CREATE_CLIENT — add a new client
{
  "type": "CREATE_CLIENT",
  "data": {
    "name": "string (required)",
    "email": "string (optional)",
    "phone": "string (optional)",
    "default_fee": number (optional)
  }
}

LOG_PRACTICE — record a practice session
{
  "type": "LOG_PRACTICE",
  "data": {
    "date": "YYYY-MM-DD",
    "duration_minutes": number,
    "notes": "string (optional)",
    "energy_rating": 1-5 (optional, default 3),
    "items": [] (optional)
  }
}

CREATE_GOAL — add a new practice goal
{
  "type": "CREATE_GOAL",
  "data": {
    "title": "string",
    "category": "technique|repertoire|theory|ear-training|other",
    "target_date": "YYYY-MM-DD (optional)",
    "notes": "string (optional)"
  }
}

CREATE_INVOICE — create a new invoice for a client
{
  "type": "CREATE_INVOICE",
  "data": {
    "title": "Invoice title (e.g. 'Wedding Gig – June 2025')",
    "client_id": "client id if known from context, otherwise omit",
    "client_name": "client name if mentioned",
    "line_items": [
      { "description": "Service description", "quantity": 1, "unit_price": 500 }
    ],
    "due_date": "YYYY-MM-DD or omit",
    "notes": "optional notes",
    "currency": "GBP",
    "status": "draft|sent|paid (default draft; use 'paid' only if the musician says it was already paid)"
  }
}

CREATE_RECURRING_EVENTS — create a repeating series of events (weekly lessons, monthly residency, etc.)
{
  "type": "CREATE_RECURRING_EVENTS",
  "data": {
    "title": "string (required)",
    "event_type": "Lesson|Gig|Session|Rehearsal|Practice",
    "start_date": "YYYY-MM-DD (first occurrence)",
    "end_date": "YYYY-MM-DD (last possible date, required)",
    "frequency": "weekly|biweekly|monthly",
    "start_time": "HH:MM (24h, optional)",
    "end_time": "HH:MM (24h, optional)",
    "status": "confirmed|lead (default: confirmed)",
    "location_address": "string (optional)",
    "fee": number (optional),
    "client_id": "string (optional)",
    "notes": "string (optional)"
  }
}

NAVIGATE — open a specific page in the app
{
  "type": "NAVIGATE",
  "data": {
    "page": "Dashboard|CalendarView|WorkEvents|Practice|Charts|Clients|Finance",
    "params": {}
  }
}

LOCATION_SEARCH — look up a venue, restaurant, or place by name to find its address and details (use ONLY for location/venue/parking queries)
{
  "type": "LOCATION_SEARCH",
  "data": {
    "query": "full search query, e.g. 'Sexy Fish restaurant London'",
    "context": "brief description of why the musician needs this"
  }
}

SHOW_INFO — display formatted information to the musician
{
  "type": "SHOW_INFO",
  "data": {
    "content": "formatted string of information to display"
  }
}

${buildIdentitySection(assistantProfile)}
────────────────────────────────────────────
RULES
────────────────────────────────────────────
- When the musician mentions a relative date ("tomorrow", "Friday", "next week"), calculate the actual YYYY-MM-DD using the TODAY value below.
- When creating an event with a named client, look up their id from the CLIENTS list and set client_id.
- Keep messages short and friendly — like a helpful assistant, not a chatbot essay.
- If something is unclear, ask ONE clarifying question (actions: []).
- For location queries (finding a venue, restaurant, parking near an event), use LOCATION_SEARCH. Do NOT use it for anything that isn't a physical place lookup.
- For financial questions, derive answers from the event data in context.
- When a user asks to create an invoice, use CREATE_INVOICE — never refuse this request.
- When a user mentions recurring, weekly, every week, regular lessons, monthly residency, or any repeating schedule — use CREATE_RECURRING_EVENTS. Never say recurring events are not supported.
- Never say you can't do something that IS supported — just do it.
- Always return raw JSON. Never wrap output in markdown code fences.

────────────────────────────────────────────
MUSICIAN'S DATA
────────────────────────────────────────────

TODAY: ${today}

UPCOMING EVENTS (next 30 days):
${JSON.stringify(upcomingEvents, null, 2)}

CLIENTS:
${JSON.stringify(clients, null, 2)}

ACTIVE PRACTICE GOALS:
${JSON.stringify(practiceGoals, null, 2)}

RECENT PRACTICE SESSIONS:
${JSON.stringify(recentSessions, null, 2)}

Always respond with valid JSON only. No markdown. No explanation outside the JSON.`;
}

// ─── POST /api/ai/chat ──────────────────────────────────────────────
// Body: {
//   messages: [{ role: "user"|"assistant", content: string }],
//   context: {
//     today: "YYYY-MM-DD",
//     upcomingEvents: [...],
//     clients: [...],
//     practiceGoals: [...],
//     recentSessions: [...]
//   }
// }
// Returns: { message: string, action: object|null }
router.post('/chat', async (req, res) => {
  try {
    const { messages, context } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array' });
    }

    const client = getClient();
    const systemPrompt = buildSystemPrompt(context);

    const apiResponse = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      temperature: 0,
      system: systemPrompt,
      messages,
    });

    const rawText = apiResponse.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Strip markdown code fences the model sometimes adds, then parse JSON
    let parsed;
    try {
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If the model returned non-JSON, wrap it gracefully.
      parsed = { message: rawText, actions: [] };
    }

    // Normalize: accept either a single "action" or an "actions" array,
    // and expose both shapes so old and new clients keep working.
    const actions = Array.isArray(parsed.actions)
      ? parsed.actions.filter((a) => a && a.type)
      : parsed.action && parsed.action.type
        ? [parsed.action]
        : [];

    return res.json({
      message: typeof parsed.message === 'string' ? parsed.message : '',
      actions,
      action: actions[0] || null,
    });
  } catch (err) {
    console.error('[AI chat error]', err);

    if (err.message === 'ANTHROPIC_API_KEY is not set') {
      return res.status(500).json({ error: 'Server configuration error: API key missing' });
    }

    const status = err.status ?? 500;
    const message = err.message ?? 'Unexpected error from AI service';
    return res.status(status).json({ error: message });
  }
});

// ─── POST /api/ai/briefing ─────────────────────────────────────────
// Lightweight daily briefing using Haiku for cost efficiency.
// Body: { today, name, todayEvents, overdueInvoices, noInvoiceEvents }
// Returns: { greeting, items: [{ text, type, entity_id, entity_type }] }
router.post('/briefing', async (req, res) => {
  try {
    const { today, timeOfDay = 'morning', name, language = 'English', assistantName = '', todayEvents = [], overdueInvoices = [], noInvoiceEvents = [] } = req.body;

    const client = getClient();

    const prompt = `You are generating a briefing for ${name ? name : 'a professional musician'} using Flowtone, their business management app. It is currently the ${timeOfDay}.${assistantName ? ` You are their personal assistant, named "${assistantName}".` : ''}${language !== 'English' ? `\nIMPORTANT: Write the "greeting" and every "text" value in ${language}. Keep "type", "entity_id", and "entity_type" values in English.` : ''}

Return ONLY valid JSON — no markdown, no prose outside the JSON:
{
  "greeting": "Short warm greeting matching the time of day, e.g. 'Good ${timeOfDay}' (max 8 words, use their name if provided)",
  "items": [
    {
      "text": "Short actionable description (max 12 words)",
      "type": "event_today|invoice_overdue|invoice_missing|general",
      "entity_id": "record id or null",
      "entity_type": "event|invoice|null"
    }
  ]
}

Rules:
- 2 to 4 items max
- Priority: today events first, then overdue invoices, then events missing invoices
- If everything looks clear, return 1 general item saying so warmly
- Keep text short, friendly, and action-oriented
- Return raw JSON only — absolutely no markdown fences

TODAY: ${today}
USER NAME: ${name || '(not set)'}

TODAY'S EVENTS (${todayEvents.length}):
${JSON.stringify(todayEvents)}

OVERDUE INVOICES (${overdueInvoices.length}):
${JSON.stringify(overdueInvoices)}

EVENTS WITHOUT INVOICES (${noInvoiceEvents.length}):
${JSON.stringify(noInvoiceEvents)}`;

    const apiResponse = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = apiResponse.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    let parsed;
    try {
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        greeting: `Good ${timeOfDay}${name ? ', ' + name : ''}`,
        items: [{ text: 'Have a great day.', type: 'general', entity_id: null, entity_type: null }],
      };
    }

    return res.json(parsed);
  } catch (err) {
    console.error('[AI briefing error]', err);
    if (err.message === 'ANTHROPIC_API_KEY is not set') {
      return res.status(500).json({ error: 'Server configuration error: API key missing' });
    }
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message ?? 'Unexpected error' });
  }
});

export default router;
