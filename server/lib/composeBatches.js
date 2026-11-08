// Batching for /api/ai/compose-missions. Pure: the model call is passed in, so
// this runs (and is tested) without the server or the network.
//
// Why: one call for ~100 missions ran out of output tokens, came back as cut-off
// JSON, and every mission lost its AI title. Now missions go in batches of
// BATCH_SIZE with short keys ("1", "2", ...). A batch that is cut off or
// unparsable is split in half and retried once; whatever still fails gets no
// AI result (template title, or kept as-is for decisions) and never affects
// the other batches.
import { extractJsonObject } from './extractJson.js';

export const BATCH_SIZE = 15;
export const TITLES_MAX_TOKENS = 1500;
export const DECISIONS_MAX_TOKENS = 2000;
const CONCURRENCY = 3;

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Runs fn over the list with at most `limit` calls in flight, keeping order.
async function mapPool(list, limit, fn) {
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      results[i] = await fn(list[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
}

// One batch → { ok, result, error, batch }. A cut-off or unparsable reply (or a thrown
// error) is not ok; a multi-item batch is then split in half and retried once.
async function runWithRecovery(batch, runBatch, canSplit = true) {
  let attempt;
  try {
    attempt = await runBatch(batch);
  } catch (error) {
    attempt = { ok: false, error };
  }
  attempt = { ...attempt, batch };
  if (attempt.ok || !canSplit || batch.length < 2) return [attempt];

  const mid = Math.ceil(batch.length / 2);
  const halves = [batch.slice(0, mid), batch.slice(mid)];
  const retried = await Promise.all(halves.map((h) => runWithRecovery(h, runBatch, false)));
  return retried.flat();
}

// Shared driver: batches, recovers, and rethrows only when nothing worked and
// something threw (so a missing key / API outage still reaches the route's
// error handler instead of silently returning nothing).
async function runAll(list, runBatch) {
  const batches = chunk(list, BATCH_SIZE);
  const attempts = (await mapPool(batches, CONCURRENCY, (b) => runWithRecovery(b, runBatch))).flat();
  if (!attempts.some((a) => a.ok)) {
    const thrown = attempts.find((a) => a.error);
    if (thrown) throw thrown.error;
  }
  return attempts;
}

// ─── Titles (legacy path: code decides, AI only writes the line) ────────────

export function describeItem(item, key) {
  const p = item.payload || {};
  const cur = p.currency || 'GBP';
  switch (item.item_type) {
    case 'gig_missing_location':
      return `{ key: "${key}", type: "problem", gig: "${p.event_title}", date: "${p.event_date}", issue: "no venue address — can't plan travel" }`;
    case 'gig_missing_fee':
      return `{ key: "${key}", type: "problem", gig: "${p.event_title}", date: "${p.event_date}", issue: "no fee set — can't create invoice" }`;
    case 'gig_missing_client':
      return `{ key: "${key}", type: "problem", gig: "${p.event_title}", date: "${p.event_date}", fee: ${p.fee}, currency: "${cur}", issue: "no client on the gig — need to know who it's for before invoicing" }`;
    case 'gig_missing_contact':
      return `{ key: "${key}", type: "problem", gig: "${p.event_title}", date: "${p.event_date}", client: "${p.client_name}", issue: "no email on file for this client — needed to send their invoice" }`;
    case 'gig_ready_to_invoice':
      return `{ key: "${key}", type: "opportunity", gig: "${p.event_title}", client: "${p.client_name}", fee: ${p.fee}, currency: "${cur}", issue: "needs an invoice" }`;
    case 'invoice_overdue':
      return `{ key: "${key}", type: "urgent", invoice: "${p.invoice_title}", client: "${p.client_name}", due: "${p.due_date}", total: ${p.total}, currency: "${cur}" }`;
    case 'invoice_draft_stale':
      return `{ key: "${key}", type: "problem", invoice: "${p.invoice_title}", client: "${p.client_name}", issue: "draft sitting for over a week" }`;
    case 'invoice_ready_to_send':
      return `{ key: "${key}", type: "opportunity", invoice: "${p.invoice_title}", client: "${p.client_name}", total: ${p.total}, currency: "${cur}", issue: "draft is complete — ready to send" }`;
    case 'invoice_ready_no_email':
      return `{ key: "${key}", type: "opportunity", invoice: "${p.invoice_title}", client: "${p.client_name}", total: ${p.total}, currency: "${cur}", issue: "invoice is ready but there's no email on file — suggest grabbing the PDF to send by WhatsApp or another way" }`;
    case 'lead_new_unanswered':
      return `{ key: "${key}", type: "urgent", lead: "${p.client_name}", event_date: "${p.event_date}", issue: "new enquiry waiting over a day for a reply" }`;
    case 'lead_quote_no_reply':
      return `{ key: "${key}", type: "problem", lead: "${p.client_name}", event_date: "${p.event_date}", issue: "quote sent, no reply yet — worth a follow-up" }`;
    default:
      return `{ key: "${key}", type: "unknown" }`;
  }
}

export function buildTitlesPrompt(batch, { name = '', language = 'English', assistantName = '' } = {}) {
  const keyMap = {};
  const lines = batch.map((item, i) => {
    const short = String(i + 1);
    keyMap[short] = `${item.item_type}::${item.entity_id}`;
    return describeItem(item, short);
  });

  const prompt = `You are Flowtone, a personal assistant for ${name || 'a professional musician'}.${assistantName ? ` Your name is "${assistantName}".` : ''}${language !== 'English' ? `\nIMPORTANT: Write ALL text values in ${language}.` : ''}

Write a short, natural message for each item below. You are speaking directly to the user.

Rules:
- Max 15 words per message
- ALWAYS name the specific client, gig, or invoice from the item — never say "this client", "their", or "the gig" vaguely. Use the actual name.
- Include the key number (fee or total) when present, using the symbol for that item's own "currency" field — GBP → £, USD → $, EUR → €, AUD → A$, CAD → C$ — never default to dollars.
- Sound like a real human assistant — warm, direct, no BS
- For opportunities: state what's ready and the key detail (client + amount)
- For problems: say what's missing and why it matters
- For urgent items: be direct about the urgency
- Speak in first person as the assistant ("I can...", "Your...", "The...")
- Return ONLY raw JSON — no markdown fences

Items:
[${lines.join(',\n')}]

Return this exact format, one entry per item, using each item's "key" exactly:
{
  "titles": {
    "1": "natural message text",
    ...
  }
}`;

  return { prompt, keyMap };
}

// → { ok, titles: { "item_type::entity_id": "text" } }
export function parseTitles(rawText, keyMap) {
  const parsed = extractJsonObject(rawText);
  if (!parsed || typeof parsed.titles !== 'object' || parsed.titles === null) {
    return { ok: false, titles: {} };
  }
  const titles = {};
  for (const [short, text] of Object.entries(parsed.titles)) {
    const key = keyMap[String(short).trim()];
    if (key && typeof text === 'string' && text.trim()) titles[key] = text.trim();
  }
  return { ok: true, titles };
}

// callModel(prompt, maxTokens) → { text, stopReason }
export async function composeTitles(items, opts, callModel) {
  const attempts = await runAll(items, async (batch) => {
    const { prompt, keyMap } = buildTitlesPrompt(batch, opts);
    const { text, stopReason } = await callModel(prompt, TITLES_MAX_TOKENS);
    if (stopReason === 'max_tokens') return { ok: false };
    const { ok, titles } = parseTitles(text, keyMap);
    return { ok, result: titles };
  });
  return Object.assign({}, ...attempts.filter((a) => a.ok).map((a) => a.result));
}

// ─── Decisions (hybrid path: user's context_notes, AI selects) ──────────────

export function buildDecisionsPrompt(batch, { context_notes = '', name = '', language = 'English', assistantName = '' } = {}) {
  const keyMap = {};
  const list = batch.map((c, i) => {
    const short = String(i + 1);
    keyMap[short] = c;
    return {
      key: short,
      default_item_type: c.default_item_type,
      allowed_item_types: c.allowed_item_types,
      payload: c.payload,
    };
  });

  const prompt = `You are ${assistantName || 'Flowtone'}, a warm, direct, personal assistant for ${name || 'a professional musician'}.${language !== 'English' ? `\nIMPORTANT: Write ALL text values in ${language}.` : ''}

You are evaluating a list of "candidate findings" (potential alerts/opportunities) from their business database.
The user has configured the following personal instructions or preferences ("context_notes") that define how you should act, prioritize, and adjust your alerts:
=== USER CUSTOM PREFERENCES ===
"${context_notes}"
===============================

Analyze each candidate finding in the list below. For each candidate:
1. **Decide if it should be an active mission.** Set "keep" to false to suppress the alert if it violates the user's custom preferences (e.g. if the user says "ignore rehearsal locations" and the event title contains "rehearsal"). Otherwise, set "keep" to true.
2. **Choose the item_type.** You can keep the candidate's default_item_type, or adjust/upgrade it based on user preferences.
   - You MUST select only from the allowed_item_types array for that candidate.
   - Example upgrade: If a gig is ready to invoice (default \`gig_ready_to_invoice\`) but the user preferences say "don't make me draft invoices, just make them ready to send", you can upgrade the type to \`invoice_ready_to_send\` (if it is listed in allowed_item_types).
3. **Write a title (message).** Max 15 words. Be direct, natural, warm, and speak in the first person ("I...", "Your..."). Always specify the actual client, gig, or invoice name directly. When you mention a money amount, use the symbol for that candidate's own "currency" field — GBP → £, USD → $, EUR → €, AUD → A$, CAD → C$ — never default to dollars.
4. **Choose priority.** Set to \`0\` (low), \`1\` (normal), or \`2\` (high).
5. **Echo the key exactly.** Return each candidate's "key" exactly as received.

Candidates:
${JSON.stringify(list, null, 2)}

Return ONLY raw JSON in the following format (no markdown fences, no extra text), one entry per candidate:
{
  "items": [
    {
      "key": "1",
      "keep": true | false,
      "item_type": "one of the allowed_item_types",
      "title": "Natural language title",
      "priority": 0 | 1 | 2
    }
  ]
}`;

  return { prompt, keyMap };
}

function defaultDecision(c) {
  return {
    key: c.candidate_key,
    item_type: c.default_item_type,
    title: '',
    priority: typeof c.priority === 'number' ? c.priority : 1,
  };
}

// → { ok, items: [{ key: candidate_key, item_type, title, priority }] }
// Only an explicit keep:false suppresses; a candidate the AI left out is kept
// with its defaults (a forgetful reply must not silently drop a mission).
export function parseDecisions(rawText, keyMap) {
  const parsed = extractJsonObject(rawText);
  if (!parsed || !Array.isArray(parsed.items)) return { ok: false, items: [] };

  const byShort = new Map();
  for (const item of parsed.items) {
    if (item && item.key != null && keyMap[String(item.key).trim()]) byShort.set(String(item.key).trim(), item);
  }

  const items = [];
  for (const [short, c] of Object.entries(keyMap)) {
    const item = byShort.get(short);
    if (!item) { items.push(defaultDecision(c)); continue; }
    if (item.keep === false) continue;
    items.push({
      key: c.candidate_key,
      item_type: c.allowed_item_types.includes(item.item_type) ? item.item_type : c.default_item_type,
      title: typeof item.title === 'string' ? item.title.trim() : '',
      priority: typeof item.priority === 'number' ? Math.max(0, Math.min(2, item.priority)) : defaultDecision(c).priority,
    });
  }
  return { ok: true, items };
}

export async function composeDecisions(candidates, opts, callModel) {
  const attempts = await runAll(candidates, async (batch) => {
    const { prompt, keyMap } = buildDecisionsPrompt(batch, opts);
    const { text, stopReason } = await callModel(prompt, DECISIONS_MAX_TOKENS);
    if (stopReason === 'max_tokens') return { ok: false };
    const { ok, items } = parseDecisions(text, keyMap);
    return { ok, result: items };
  });
  return attempts.flatMap((a) => (a.ok ? a.result : a.batch.map(defaultDecision)));
}
