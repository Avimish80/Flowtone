import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';

// POST /api/ai/classify-calendar-events
// Optional AI pass for "Link iPhone calendar": decides which calendar entries
// are paid work and what kind. Used only when the user turns on the AI check
// (for calendars that mix work with personal life).
// Body: { events: [{ i, title, date, start_time, location }] }  (max 200)
// Returns: { results: [{ i, work: bool, event_type: "Gig"|"Lesson"|"Rehearsal"|"Session" }] }
const router = Router();

let anthropic;
function getClient() {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

const TYPES = new Set(['Gig', 'Lesson', 'Rehearsal', 'Session']);

router.post('/classify-calendar-events', async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 200) : [];
    if (!events.length) return res.json({ results: [] });

    const lines = events.map((e) =>
      JSON.stringify({ i: e.i, title: String(e.title || '').slice(0, 120), date: e.date, time: e.start_time || '', location: String(e.location || '').slice(0, 80) })
    ).join('\n');

    const prompt = `You sort a working musician's calendar entries. For each entry decide:
- work: true if it is paid music work (gig, wedding, function, concert, session, lesson they teach, rehearsal for a booked job), false if personal (doctor, family, birthday, holiday, travel, dinner with friends, reminders).
- event_type: one of Gig, Lesson, Rehearsal, Session (only meaningful when work is true).
When unsure, prefer work: true — the musician reviews the list before importing.

Return ONLY JSON, no prose: {"results":[{"i":0,"work":true,"event_type":"Gig"}]}
One result per entry, same "i" values.

ENTRIES:
${lines}`;

    const apiResponse = await getClient().messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = apiResponse.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    let parsed = null;
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { /* fall through */ }

    const results = (parsed?.results || [])
      .filter((r) => r && Number.isInteger(r.i))
      .map((r) => ({ i: r.i, work: r.work !== false, event_type: TYPES.has(r.event_type) ? r.event_type : 'Gig' }));

    return res.json({ results });
  } catch (err) {
    console.error('[AI classify-calendar-events error]', err);
    return res.status(err.status ?? 500).json({ error: err.message ?? 'Unexpected error' });
  }
});

export default router;
