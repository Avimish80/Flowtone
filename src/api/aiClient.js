import { flowtoneJson } from "@/lib/flowtoneApi";

/**
 * Send a chat request to the Flowtone AI backend.
 * Authenticated: flowtoneJson attaches the Supabase access token.
 *
 * @param {Array<{ role: 'user' | 'assistant', content: string }>} messages
 * @param {object} [context] - Structured context object: { today, upcomingEvents, clients, practiceGoals, recentSessions, assistantProfile }
 * @returns {Promise<{ message: string, actions: array, action: object|null }>} Parsed AI response.
 */
export async function askAI(messages, context = {}) {
  try {
    return await flowtoneJson("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ messages, context }),
      timeoutMs: 30000,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The AI is taking too long to respond. Check that the server is running.");
    }
    throw err;
  }
}
