const AI_BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/ai`
  : 'http://localhost:3001/api/ai';

/**
 * Send a chat request to the GigFlow AI backend.
 *
 * @param {Array<{ role: 'user' | 'assistant', content: string }>} messages
 * @param {object} [context] - Structured context object: { today, upcomingEvents, clients, practiceGoals, recentSessions }
 * @returns {Promise<{ message: string, action: object|null }>} Parsed AI response.
 */
export async function askAI(messages, context = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${AI_BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errorMsg = `AI request failed with status ${res.status}`;
      try {
        const data = await res.json();
        if (data.error) errorMsg = data.error;
      } catch {
        // ignore JSON parse errors
      }
      throw new Error(errorMsg);
    }

    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The AI is taking too long to respond. Check that the server is running.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
