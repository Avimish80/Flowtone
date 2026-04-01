import { useState, useCallback, useRef } from "react";
import { askAI } from "@/api/aiClient";
import { appClient } from "@/api/appClient";
import { format } from "date-fns";

// ─── Helpers ────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function makeMessage(role, content, extra = {}) {
  return { id: uid(), role, content, timestamp: new Date().toISOString(), ...extra };
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ─── Context builder — full financial + event context ───────────────────────

async function buildContext() {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const ago7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const [allEvents, allClients, allGoals, allSessions, allDocuments, allPayments] = await Promise.all([
      appClient.entities.WorkEvent.list().catch(() => []),
      appClient.entities.Client.list().catch(() => []),
      appClient.entities.PracticeGoal.list().catch(() => []),
      appClient.entities.PracticeSession.list().catch(() => []),
      appClient.entities.Document.list().catch(() => []),
      appClient.entities.Payment.list().catch(() => []),
    ]);

    const clientMap = Object.fromEntries(allClients.map(c => [c.id, c]));
    const invoices = allDocuments.filter(d => d.document_type === "invoice");
    const overdueInvoices = invoices.filter(d => d.status === "sent" && d.due_date && d.due_date < today);
    const sentInvoices = invoices.filter(d => d.status === "sent");
    const paidInvoices = invoices.filter(d => d.status === "paid");
    const draftInvoices = invoices.filter(d => d.status === "draft");

    const outstanding = sentInvoices.reduce((s, d) => s + (d.total || 0), 0);
    const overdueTotal = overdueInvoices.reduce((s, d) => s + (d.total || 0), 0);
    const paidThisMonth = paidInvoices
      .filter(d => d.paid_date >= monthStart)
      .reduce((s, d) => s + (d.paid_amount || d.total || 0), 0);
    const paidThisYear = paidInvoices
      .filter(d => d.paid_date >= `${now.getFullYear()}-01-01`)
      .reduce((s, d) => s + (d.paid_amount || d.total || 0), 0);

    const upcomingEvents = allEvents
      .filter(e => e.date && new Date(e.date) >= now && new Date(e.date) <= in30Days)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 30)
      .map(e => ({
        id: e.id, title: e.title, date: e.date, start_time: e.start_time,
        event_type: e.event_type, status: e.status,
        client_name: clientMap[e.client_id]?.name || "",
        base_price: e.base_price || 0, total_price: e.total_price || 0,
        currency: e.currency || "GBP",
        location_address: e.location_address || "",
      }));

    const recentSessions = allSessions
      .filter(s => s.date && new Date(s.date) >= ago7Days)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map(s => ({ date: s.date, duration_minutes: s.duration_minutes }));

    return {
      today,
      clients: allClients.map(c => ({
        id: c.id, name: c.name, client_type: c.client_type,
        default_fee: c.default_fee || 0, emails: c.emails || [],
      })),
      upcomingEvents,
      recentSessions,
      practiceGoals: allGoals
        .filter(g => !g.completed)
        .map(g => ({ id: g.id, title: g.title })),
      finance: {
        outstanding,
        overdueCount: overdueInvoices.length,
        overdueTotal,
        sentCount: sentInvoices.length,
        draftCount: draftInvoices.length,
        paidThisMonth,
        paidThisYear,
        overdueInvoices: overdueInvoices.slice(0, 5).map(d => ({
          id: d.id,
          title: d.title,
          client_name: clientMap[d.client_id]?.name || d.client_name || "",
          total: d.total || 0,
          due_date: d.due_date,
          currency: d.currency || "GBP",
        })),
        recentPaid: paidInvoices
          .filter(d => d.paid_date >= monthStart)
          .slice(0, 5)
          .map(d => ({
            id: d.id, title: d.title,
            client_name: clientMap[d.client_id]?.name || d.client_name || "",
            paid_amount: d.paid_amount || d.total || 0,
            currency: d.currency || "GBP",
          })),
      },
    };
  } catch (err) {
    console.warn("useAIAssistant: failed to build context", err);
    return {
      today: new Date().toISOString().slice(0, 10),
      clients: [], upcomingEvents: [], recentSessions: [], practiceGoals: [],
      finance: { outstanding: 0, overdueCount: 0, overdueTotal: 0, sentCount: 0, draftCount: 0, paidThisMonth: 0, paidThisYear: 0, overdueInvoices: [], recentPaid: [] },
    };
  }
}

// ─── Proactive brief builder ────────────────────────────────────────────────

async function buildProactiveBrief() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const [allEvents, allClients, allDocuments] = await Promise.all([
    appClient.entities.WorkEvent.list().catch(() => []),
    appClient.entities.Client.list().catch(() => []),
    appClient.entities.Document.list().catch(() => []),
  ]);

  const clientMap = Object.fromEntries(allClients.map(c => [c.id, c]));

  // Today's events
  const todayEvents = allEvents
    .filter(e => e.date === today && e.status !== "cancelled")
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""))
    .map(e => ({
      id: e.id,
      title: e.title,
      start_time: e.start_time || "",
      event_type: e.event_type,
      client_name: clientMap[e.client_id]?.name || "",
      base_price: e.base_price || 0,
      total_price: e.total_price || 0,
      currency: e.currency || "GBP",
      location_address: e.location_address || "",
    }));

  // This week's events
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);
  const weekEvents = allEvents.filter(e => e.date >= today && e.date <= weekEndStr && e.status !== "cancelled");

  // Finance
  const invoices = allDocuments.filter(d => d.document_type === "invoice");
  const overdueInvoices = invoices
    .filter(d => d.status === "sent" && d.due_date && d.due_date < today)
    .map(d => ({
      id: d.id,
      title: d.title,
      client_name: clientMap[d.client_id]?.name || d.client_name || "",
      total: d.total || 0,
      due_date: d.due_date,
      days_overdue: Math.floor((now - new Date(d.due_date)) / 86400000),
    }));
  const outstanding = invoices
    .filter(d => d.status === "sent")
    .reduce((s, d) => s + (d.total || 0), 0);

  return {
    greeting: getGreeting(),
    date: format(now, "EEEE, d MMMM yyyy"),
    stats: {
      todayCount: todayEvents.length,
      weekCount: weekEvents.length,
      overdueCount: overdueInvoices.length,
      outstanding,
    },
    todayEvents,
    overdueInvoices: overdueInvoices.slice(0, 3),
    chips: ["Today's schedule", "Who owes me money?", "This month's earnings", "Upcoming gigs"],
  };
}

// ─── Action executor ────────────────────────────────────────────────────────

async function executeAction(action) {
  const { type, data } = action;

  switch (type) {
    case "CREATE_EVENT": {
      const created = await appClient.entities.WorkEvent.create(data);
      return {
        success: true, type,
        label: `Created: ${data.title || "New Event"}${data.date ? " – " + new Date(data.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : ""}`,
        entityId: created?.id, page: "WorkEvents",
      };
    }

    case "UPDATE_EVENT": {
      await appClient.entities.WorkEvent.update(data.id, data);
      return { success: true, type, label: `Updated event${data.title ? ": " + data.title : ""}`, entityId: data.id, page: "WorkEvents" };
    }

    case "CREATE_CLIENT": {
      const created = await appClient.entities.Client.create(data);
      return { success: true, type, label: `Added client: ${data.name}`, entityId: created?.id, page: "Clients" };
    }

    case "LOG_PRACTICE": {
      const created = await appClient.entities.PracticeSession.create(data);
      return { success: true, type, label: `Logged practice: ${data.duration_minutes || "?"} min on ${data.date || "today"}`, entityId: created?.id, page: "Practice" };
    }

    case "CREATE_RECURRING_EVENTS": {
      const { start_date, end_date, frequency = "weekly", title, event_type, start_time, end_time, status, location_address, fee, client_id, notes } = data;
      if (!start_date || !end_date) return { success: false, type, label: "Need a start and end date for recurring events." };
      const dates = [];
      const cur = new Date(start_date + "T12:00:00");
      const end = new Date(end_date + "T12:00:00");
      const step = frequency === "biweekly" ? 14 : 7;
      while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10));
        if (frequency === "monthly") cur.setMonth(cur.getMonth() + 1);
        else cur.setDate(cur.getDate() + step);
      }
      const seriesId = Math.random().toString(36).slice(2);
      for (const date of dates) {
        await appClient.entities.WorkEvent.create({
          title, event_type: event_type || "Lesson", date,
          start_time: start_time || "", end_time: end_time || "",
          status: status || "confirmed", location_address: location_address || "",
          fee: fee || 0, client_id: client_id || "", notes: notes || "",
          is_recurring: true, recurring_series_id: seriesId,
        });
      }
      return { success: true, type, label: `Created ${dates.length} recurring events: ${title} (${frequency}, ${dates[0]} → ${dates[dates.length - 1]})`, page: "WorkEvents" };
    }

    case "CREATE_GOAL": {
      const created = await appClient.entities.PracticeGoal.create(data);
      return { success: true, type, label: `New goal: ${data.title}`, entityId: created?.id, page: "Practice" };
    }

    case "CREATE_INVOICE": {
      const docNumber = await appClient.helpers.getNextDocumentNumber("invoice");
      const lineItems = (data.line_items || [{ description: data.title || "Service", quantity: 1, unit_price: 0 }]).map(item => ({
        description: item.description || "Service",
        quantity: Number(item.quantity) || 1,
        unit_price: Number(item.unit_price) || 0,
        total: (Number(item.quantity) || 1) * (Number(item.unit_price) || 0),
      }));
      const subtotal = lineItems.reduce((sum, i) => sum + i.total, 0);
      const created = await appClient.entities.Document.create({
        document_type: "invoice", document_number: docNumber,
        title: data.title || "New Invoice", client_id: data.client_id || "",
        status: "draft", currency: data.currency || "GBP",
        line_items: lineItems, subtotal, total: subtotal,
        due_date: data.due_date || "", notes: data.notes || "",
        tax_rate: 0, tax_amount: 0, discount_value: 0, discount_amount: 0,
        is_locked: false, paid_amount: 0,
      });
      return { success: true, type, label: `Created invoice: ${data.title || "New Invoice"}${docNumber ? " #" + docNumber : ""}`, entityId: created?.id, page: "DocumentDetail", navigate: { page: "DocumentDetail", params: { id: created?.id } } };
    }

    case "NAVIGATE":
      return { success: true, type, navigate: data, label: `Navigating to ${data.page}…` };

    case "SHOW_INFO":
      return { success: true, type, label: null };

    default:
      console.warn("useAIAssistant: unknown action type", type);
      return null;
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useAIAssistant() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [briefLoading, setBriefLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [pendingNavigate, setPendingNavigate] = useState(null);
  const briefShownRef = useRef(false);

  const openPanel = useCallback(async () => {
    setOpen(true);
    // Generate proactive brief the first time this session
    if (!briefShownRef.current) {
      briefShownRef.current = true;
      setBriefLoading(true);
      try {
        const briefData = await buildProactiveBrief();
        setMessages([makeMessage("brief", "", { richData: briefData })]);
      } catch {
        setMessages([makeMessage("assistant", "Hey! I'm your Flowtone assistant. Ask me about your schedule, earnings, invoices, or anything else.")]);
      } finally {
        setBriefLoading(false);
      }
    }
  }, []);

  const closePanel = useCallback(() => setOpen(false), []);

  const sendMessage = useCallback(
    async (text) => {
      const trimmed = (text || "").trim();
      if (!trimmed || loading) return;

      const userMsg = makeMessage("user", trimmed);
      setMessages(prev => [...prev, userMsg]);
      setLoading(true);

      try {
        const context = await buildContext();
        const history = [...messages, userMsg]
          .filter(m => m.role === "user" || m.role === "assistant")
          .map(m => ({ role: m.role, content: m.content }));

        const { message: aiMessage, action = null } = await askAI(history, context);
        const assistantMsg = makeMessage("assistant", aiMessage);
        setMessages(prev => [...prev, assistantMsg]);

        if (action && action.type === "LOCATION_SEARCH") {
          try {
            const query = encodeURIComponent(action.data?.query || "");
            const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=3&q=${query}`, { headers: { "User-Agent": "Flowtone/1.0" } });
            const results = await resp.json();
            const locationMsg = results?.length > 0
              ? results.map(r => `${r.display_name}`).join("\n")
              : "Couldn't find that location. Try being more specific.";
            setMessages(prev => [...prev, makeMessage("assistant", locationMsg)]);
          } catch {
            setMessages(prev => [...prev, makeMessage("assistant", "Couldn't find that location.")]);
          }
        }

        if (action && action.type && action.type !== "LOCATION_SEARCH") {
          try {
            const result = await executeAction(action);
            if (result) {
              if (result.navigate) setPendingNavigate(result.navigate);
              if (result.label) {
                setMessages(prev => [...prev, makeMessage("action", result.label, {
                  action: { type: result.type, page: result.page, entityId: result.entityId, navigate: result.navigate },
                })]);
              }
            }
          } catch (actionErr) {
            console.error("useAIAssistant: action failed", actionErr);
            setMessages(prev => [...prev, makeMessage("action", `Something went wrong: ${actionErr.message || "Unknown error"}`, { action: { type: "ERROR" } })]);
          }
        }
      } catch (err) {
        console.error("useAIAssistant: AI call failed", err);
        setMessages(prev => [...prev, makeMessage("assistant", "Sorry, I couldn't reach the AI right now. Please try again.")]);
      } finally {
        setLoading(false);
      }
    },
    [messages, loading]
  );

  const clearHistory = useCallback(() => {
    briefShownRef.current = false;
    setMessages([]);
    setPendingNavigate(null);
    setBriefLoading(false);
  }, []);

  return {
    messages, loading, briefLoading, open,
    openPanel, closePanel,
    sendMessage, clearHistory,
    pendingNavigate,
    clearPendingNavigate: useCallback(() => setPendingNavigate(null), []),
  };
}
