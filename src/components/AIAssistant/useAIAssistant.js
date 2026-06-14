import { useState, useCallback, useEffect } from "react";
import { askAI } from "@/api/aiClient";
import { appClient } from "@/api/appClient";
import { getAssistantProfile } from "@/lib/assistantProfile";

// ─── Helpers ────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function makeMessage(role, content, extra = {}) {
  return { id: uid(), role, content, timestamp: new Date().toISOString(), ...extra };
}

// ─── Context builder — returns a structured object for the server ────────────

async function buildContext() {
  try {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const ago7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [allEvents, allClients, allGoals, allSessions] = await Promise.all([
      appClient.entities.WorkEvent.list().catch(() => []),
      appClient.entities.Client.list().catch(() => []),
      appClient.entities.PracticeGoal.list().catch(() => []),
      appClient.entities.PracticeSession.list().catch(() => []),
    ]);

    const upcomingEvents = allEvents
      .filter((e) => { if (!e.date) return false; const d = new Date(e.date); return d >= now && d <= in30Days; })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 20)
      .map((e) => ({ id: e.id, title: e.title, date: e.date, event_type: e.event_type, status: e.status, client_id: e.client_id }));

    const clients = allClients.map((c) => ({ id: c.id, name: c.name }));

    const practiceGoals = allGoals
      .filter((g) => g.status !== "completed" && g.status !== "abandoned")
      .map((g) => ({ id: g.id, title: g.title, category: g.category }));

    const recentSessions = allSessions
      .filter((s) => s.date && new Date(s.date) >= ago7Days)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10)
      .map((s) => ({ date: s.date, duration_minutes: s.duration_minutes }));

    const assistantProfile = await getAssistantProfile().catch(() => null);

    return {
      today: now.toISOString().slice(0, 10),
      upcomingEvents,
      clients,
      practiceGoals,
      recentSessions,
      assistantProfile,
    };
  } catch (err) {
    console.warn("useAIAssistant: failed to build context", err);
    return { today: new Date().toISOString().slice(0, 10), upcomingEvents: [], clients: [], practiceGoals: [], recentSessions: [] };
  }
}

// ─── Action executor ────────────────────────────────────────────────────────

async function executeAction(action) {
  const { type, data } = action;

  switch (type) {
    case "CREATE_EVENT": {
      const created = await appClient.entities.WorkEvent.create(data);
      return {
        success: true,
        type,
        label: `Created: ${data.title || "New Event"}${data.date ? " – " + new Date(data.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : ""}`,
        entityId: created?.id,
        page: "WorkEventDetail",
        navigate: { page: "WorkEventDetail", params: { id: created?.id } },
      };
    }

    case "UPDATE_EVENT": {
      await appClient.entities.WorkEvent.update(data.id, data);
      return {
        success: true,
        type,
        label: `Updated event${data.title ? ": " + data.title : ""}`,
        entityId: data.id,
        page: "WorkEventDetail",
        navigate: { page: "WorkEventDetail", params: { id: data.id } },
      };
    }

    case "CREATE_CLIENT": {
      const created = await appClient.entities.Client.create(data);
      return {
        success: true,
        type,
        label: `Added client: ${data.name}`,
        entityId: created?.id,
        page: "ClientDetail",
        navigate: { page: "ClientDetail", params: { id: created?.id } },
      };
    }

    case "LOG_PRACTICE": {
      const created = await appClient.entities.PracticeSession.create(data);
      return {
        success: true,
        type,
        label: `Logged practice: ${data.duration_minutes || "?"} min on ${data.date || "today"}`,
        entityId: created?.id,
        page: "Practice",
      };
    }

    case "CREATE_RECURRING_EVENTS": {
      const { start_date, end_date, frequency = "weekly", title, event_type, start_time, end_time, status, location_address, fee, client_id, notes } = data;
      if (!start_date || !end_date) return { success: false, type, label: "Need a start and end date for recurring events." };

      // Build list of dates
      const dates = [];
      const cur = new Date(start_date + "T12:00:00");
      const end = new Date(end_date + "T12:00:00");
      const step = frequency === "monthly" ? null : frequency === "biweekly" ? 14 : 7;
      while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10));
        if (frequency === "monthly") {
          cur.setMonth(cur.getMonth() + 1);
        } else {
          cur.setDate(cur.getDate() + step);
        }
      }

      // Create all events. Use the real column names the rest of the app
      // reads: base_price/total_price for the fee, recurrence_id/_index to
      // group the series. client_id is omitted when blank (the data layer
      // would otherwise have to coerce "" → null on a uuid column).
      const seriesId = Math.random().toString(36).slice(2);
      const price = Number(fee) || 0;
      let index = 0;
      for (const date of dates) {
        await appClient.entities.WorkEvent.create({
          title, event_type: event_type || "Lesson", date,
          start_time: start_time || "", end_time: end_time || "",
          status: status || "confirmed",
          location_address: location_address || "",
          base_price: price, total_price: price,
          notes: notes || "",
          ...(client_id ? { client_id } : {}),
          is_recurring: true, recurrence_id: seriesId, recurrence_index: index,
        });
        index += 1;
      }

      return {
        success: true,
        type,
        label: `Created ${dates.length} recurring events: ${title} (${frequency}, ${dates[0]} → ${dates[dates.length - 1]})`,
        page: "WorkEvents",
      };
    }

    case "CREATE_GOAL": {
      const created = await appClient.entities.PracticeGoal.create(data);
      return {
        success: true,
        type,
        label: `New goal: ${data.title}`,
        entityId: created?.id,
        page: "Practice",
      };
    }

    case "CREATE_INVOICE": {
      // Get next invoice number
      const docNumber = await appClient.helpers.getNextDocumentNumber("invoice");

      // Calculate totals from line items
      const lineItems = (data.line_items || [{ description: data.title || "Service", quantity: 1, unit_price: 0 }]).map(item => ({
        description: item.description || "Service",
        quantity: Number(item.quantity) || 1,
        unit_price: Number(item.unit_price) || 0,
        total: (Number(item.quantity) || 1) * (Number(item.unit_price) || 0),
      }));
      const subtotal = lineItems.reduce((sum, i) => sum + i.total, 0);

      const status = ["draft", "sent", "paid"].includes(data.status) ? data.status : "draft";
      const todayStr = new Date().toISOString().slice(0, 10);

      const created = await appClient.entities.Document.create({
        document_type: "invoice",
        document_number: docNumber,
        title: data.title || "New Invoice",
        client_id: data.client_id || "",
        status,
        currency: data.currency || "GBP",
        line_items: lineItems,
        subtotal,
        total: subtotal,
        due_date: data.due_date || "",
        notes: data.notes || "",
        tax_rate: 0,
        tax_amount: 0,
        discount_value: 0,
        discount_amount: 0,
        is_locked: false,
        paid_amount: status === "paid" ? subtotal : 0,
        ...(status === "paid" ? { paid_date: todayStr } : {}),
        ...(status === "sent" || status === "paid" ? { sent_date: todayStr } : {}),
      });

      return {
        success: true,
        type,
        label: `Created invoice: ${data.title || "New Invoice"}${docNumber ? " #" + docNumber : ""}`,
        entityId: created?.id,
        page: "DocumentDetail",
        navigate: { page: "DocumentDetail", params: { id: created?.id } },
      };
    }

    case "NAVIGATE": {
      return {
        success: true,
        type,
        navigate: data,
        label: `Navigating to ${data.page}…`,
      };
    }

    case "SHOW_INFO": {
      return { success: true, type, label: null };
    }

    default:
      console.warn("useAIAssistant: unknown action type", type);
      return null;
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

const DEFAULT_GREETING =
  "Hey! I'm your Flowtone Assistant. Ask me anything — I can create events, log practice, add clients, or help you stay on top of your work. 🎵";

function personalGreeting(profile) {
  if (!profile?.user_name) return DEFAULT_GREETING;
  const aiName = profile.assistant_name ? `I'm ${profile.assistant_name}` : "I'm your assistant";
  return `Hey ${profile.user_name}! ${aiName} — ask me anything. I can create events, log practice, add clients, or help you stay on top of your work.`;
}

export function useAIAssistant() {
  const [messages, setMessages] = useState([makeMessage("assistant", DEFAULT_GREETING)]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // pendingNavigate: { page, params } — set when AI returns NAVIGATE action
  const [pendingNavigate, setPendingNavigate] = useState(null);

  // Personalize the greeting once the assistant profile loads —
  // only if the user hasn't started chatting yet
  useEffect(() => {
    getAssistantProfile()
      .then((profile) => {
        if (!profile?.user_name) return;
        setMessages((prev) =>
          prev.length === 1 && prev[0].role === "assistant"
            ? [makeMessage("assistant", personalGreeting(profile))]
            : prev
        );
      })
      .catch(() => {});
  }, []);

  const sendMessage = useCallback(
    async (text) => {
      const trimmed = (text || "").trim();
      if (!trimmed || loading) return;

      // Add user message immediately
      const userMsg = makeMessage("user", trimmed);
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        // Build structured context from app data
        const context = await buildContext();

        // Build conversation history for the AI (only user+assistant roles)
        const history = [...messages, userMsg]
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content }));

        // Call AI — returns { message, actions } already parsed
        const response = await askAI(history, context);
        const aiMessage = response.message || "";
        const actions = Array.isArray(response.actions)
          ? response.actions
          : response.action
            ? [response.action]
            : [];

        // Add assistant message
        const assistantMsg = makeMessage("assistant", aiMessage);
        setMessages((prev) => [...prev, assistantMsg]);

        // Track clients created during THIS turn so a follow-up event,
        // invoice, or recurring series that names a brand-new client (which
        // has no id yet when the AI builds the action) still links to them.
        const batchClientIds = {};

        // Execute every action, in order
        for (const action of actions) {
          if (!action || !action.type) continue;

          // Resolve a client referenced by name (e.g. one created earlier in
          // this same turn) to its real id before the action runs.
          if (action.data && !action.data.client_id && action.data.client_name) {
            const key = String(action.data.client_name).toLowerCase().trim();
            if (batchClientIds[key]) action.data.client_id = batchClientIds[key];
          }

          // Handle LOCATION_SEARCH inline (no executeAction needed)
          if (action.type === "LOCATION_SEARCH") {
            try {
              const query = encodeURIComponent(action.data?.query || "");
              const resp = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&limit=3&q=${query}`,
                { headers: { "User-Agent": "Flowtone/1.0" } }
              );
              const results = await resp.json();
              if (results && results.length > 0) {
                const locationMsg = results.map((r) => `📍 ${r.display_name}`).join("\n");
                setMessages((prev) => [...prev, makeMessage("assistant", locationMsg)]);
              } else {
                setMessages((prev) => [...prev, makeMessage("assistant", "Couldn't find that location. Try being more specific.")]);
              }
            } catch {
              setMessages((prev) => [...prev, makeMessage("assistant", "Couldn't find that location. Try being more specific.")]);
            }
            continue;
          }

          try {
            const result = await executeAction(action);
            if (result) {
              // Remember a newly created client so later actions this turn can link to it.
              if (action.type === "CREATE_CLIENT" && result.entityId && action.data?.name) {
                batchClientIds[String(action.data.name).toLowerCase().trim()] = result.entityId;
              }

              // Only an explicit NAVIGATE request moves the user away.
              // Created records stay in chat as a green card with a View link.
              if (result.type === "NAVIGATE" && result.navigate) {
                setPendingNavigate(result.navigate);
              }

              if (result.label) {
                const actionMsg = makeMessage("action", result.label, {
                  action: {
                    type: result.type,
                    page: result.page,
                    entityId: result.entityId,
                    navigate: result.navigate,
                  },
                });
                setMessages((prev) => [...prev, actionMsg]);
              }
            }
          } catch (actionErr) {
            // Log the real error for debugging, but never surface raw
            // database/internal messages to the musician.
            console.error("useAIAssistant: action failed", actionErr);
            const errMsg = makeMessage(
              "action",
              "I couldn't finish that one — please try again, or tell me a bit more.",
              { action: { type: "ERROR" } }
            );
            setMessages((prev) => [...prev, errMsg]);
          }
        }
      } catch (err) {
        console.error("useAIAssistant: AI call failed", err);
        const errMsg = makeMessage(
          "assistant",
          "Sorry, I couldn't reach the AI right now. Please try again in a moment."
        );
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setLoading(false);
      }
    },
    [messages, loading]
  );

  const clearHistory = useCallback(() => {
    setMessages([makeMessage("assistant", "Chat cleared. How can I help you?")]);
    setPendingNavigate(null);
  }, []);

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);

  return {
    messages,
    loading,
    open,
    openPanel,
    closePanel,
    sendMessage,
    clearHistory,
    pendingNavigate,
    clearPendingNavigate: useCallback(() => setPendingNavigate(null), []),
  };
}
