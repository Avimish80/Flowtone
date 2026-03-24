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
  const res = await fetch(`${AI_BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, context }),
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

  // Server returns { message: string, action: object|null } directly
  return await res.json();
}
