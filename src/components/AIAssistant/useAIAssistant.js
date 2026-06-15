import { useState, useCallback, useEffect } from "react";
import { askAI } from "@/api/aiClient";
import { appClient } from "@/api/appClient";
import { sanitizeCustom } from "@/lib/invoiceTemplates";
import { getAssistantProfile } from "@/lib/assistantProfile";

// ─── Helpers ────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function makeMessage(role, content, extra = {}) {
  return { id: uid(), role, content, timestamp: new Date().toISOString(), ...extra };
}

// Build a short, human label for a place from a Nominatim result.
function shortPlaceLabel(r) {
  const a = r.address || {};
  const name =
    a.amenity || a.building || a.shop || a.tourism || a.leisure ||
    (r.display_name || "").split(",")[0];
  const area = a.city || a.town || a.village || a.suburb || a.county || "";
  return [name, area].filter(Boolean).join(", ") || (r.display_name || "Location");
}

// ─── Context builder — returns a structured object for the server ────────────

const EMPTY_CONTEXT = () => ({
  today: new Date().toISOString().slice(0, 10),
  counts: {}, events: [], clients: [], invoices: [],
  practiceGoals: [], recentSessions: [], equipment: [], settings: {},
});

// Build a comprehensive snapshot of the musician's real data so the AI can
// see — and act on — anything: past + upcoming events with full detail, every
// invoice/estimate, full client records, equipment, goals, and settings.
async function buildContext() {
  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const day = 24 * 60 * 60 * 1000;
    const windowPast = new Date(now.getTime() - 180 * day);
    const windowFuture = new Date(now.getTime() + 365 * day);
    const ago7Days = new Date(now.getTime() - 7 * day);

    const [allEvents, allClients, allGoals, allSessions, allDocs, allEquipment, settingsList] =
      await Promise.all([
        appClient.entities.WorkEvent.list().catch(() => []),
        appClient.entities.Client.list().catch(() => []),
        appClient.entities.PracticeGoal.list().catch(() => []),
        appClient.entities.PracticeSession.list().catch(() => []),
        appClient.entities.Document.list().catch(() => []),
        appClient.entities.Equipment.list().catch(() => []),
        appClient.entities.AppSettings.list().catch(() => []),
      ]);

    const clientNameById = {};
    allClients.forEach((c) => { clientNameById[c.id] = c.name; });

    // Events — wide window, full useful detail. Cap at 200, biased to the
    // window around today so the AI can still find what the user references.
    const EVENT_CAP = 200;
    const inWindow = allEvents
      .filter((e) => e.date)
      .filter((e) => { const d = new Date(e.date); return d >= windowPast && d <= windowFuture; })
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    let windowed = inWindow;
    if (inWindow.length > EVENT_CAP) {
      const future = inWindow.filter((e) => e.date >= todayStr);
      const past = inWindow.filter((e) => e.date < todayStr).reverse();
      windowed = [...future.slice(0, EVENT_CAP - 40), ...past.slice(0, 40)]
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    }
    const events = windowed.map((e) => ({
      id: e.id, title: e.title, date: e.date,
      start: e.start_time || undefined, end: e.end_time || undefined,
      type: e.event_type, status: e.status,
      client_id: e.client_id || undefined,
      client: e.client_id ? clientNameById[e.client_id] : undefined,
      location: e.location_address || undefined,
      price: e.total_price || e.base_price || undefined,
      currency: e.currency || undefined,
      recurring: e.is_recurring || undefined,
      past: e.date < todayStr || undefined,
    }));

    const clients = allClients.map((c) => ({
      id: c.id, name: c.name, type: c.client_type || undefined,
      emails: c.emails?.length ? c.emails : undefined,
      phones: c.phones?.length ? c.phones : undefined,
      city: c.city || undefined,
      default_fee: c.default_fee || undefined,
      currency: c.default_currency || undefined,
      late_payer: c.late_payment_flag || undefined,
    }));

    // Invoices + estimates — most recent first, capped.
    const DOC_CAP = 150;
    const invoices = allDocs
      .slice()
      .sort((a, b) => new Date(b.created_at || b.due_date || 0) - new Date(a.created_at || a.due_date || 0))
      .slice(0, DOC_CAP)
      .map((d) => ({
        id: d.id,
        number: d.document_number || d.invoice_number || undefined,
        kind: d.document_type || "invoice",
        title: d.title, status: d.status,
        client_id: d.client_id || undefined,
        client: d.client_id ? clientNameById[d.client_id] : (d.client_name || undefined),
        total: d.total ?? d.subtotal ?? undefined,
        currency: d.currency || undefined,
        due_date: d.due_date || undefined,
        paid_date: d.paid_date || undefined,
        event_id: d.work_event_id || undefined,
      }));

    const practiceGoals = allGoals
      .filter((g) => !g.completed && g.status !== "completed" && g.status !== "abandoned")
      .map((g) => ({ id: g.id, title: g.title, category: g.category }));

    const recentSessions = allSessions
      .filter((s) => s.date && new Date(s.date) >= ago7Days)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10)
      .map((s) => ({ date: s.date, duration_minutes: s.duration_minutes }));

    const equipment = allEquipment.slice(0, 60).map((eq) => ({ id: eq.id, name: eq.name, category: eq.category }));

    const s = settingsList[0] || {};
    const settings = {
      currency: s.currency || s.default_currency || "GBP",
      invoice_prefix: s.invoice_number_prefix || undefined,
      invoice_next: s.invoice_number_next || undefined,
    };

    const assistantProfile = await getAssistantProfile().catch(() => null);

    return {
      today: todayStr,
      counts: {
        events_total: allEvents.length, events_shown: events.length,
        clients_total: allClients.length,
        invoices_total: allDocs.length, invoices_shown: invoices.length,
      },
      events, clients, invoices,
      practiceGoals, recentSessions, equipment, settings,
      assistantProfile,
    };
  } catch (err) {
    console.warn("useAIAssistant: failed to build context", err);
    return EMPTY_CONTEXT();
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
      const {
        start_date, end_date, frequency = "weekly", interval, days_of_week, count,
        title, event_type, start_time, end_time, status, location_address, fee, client_id, notes,
      } = data;
      if (!start_date) return { success: false, type, label: "Need a start date for the recurring lessons." };

      // Resolve the end condition from whatever the AI provided. No end_date /
      // count means an ongoing series — the engine materialises ~6 months and
      // the app's rolling top-up keeps extending it.
      const rule = {
        frequency,
        interval: interval || 1,
        days_of_week: Array.isArray(days_of_week) ? days_of_week : undefined,
        end_type: count ? "count" : end_date ? "until" : "never",
        count: count || undefined,
        until: end_date || undefined,
      };

      const price = Number(fee) || 0;
      const template = {
        title,
        event_type: event_type || "Lesson",
        start_time: start_time || "",
        end_time: end_time || "",
        status: status || "confirmed",
        location_address: location_address || "",
        base_price: price,
        total_price: price,
        notes: notes || "",
        ...(client_id ? { client_id } : {}),
      };

      const res = await appClient.helpers.createRecurringSeries({ template, rule, startDate: start_date });
      if (!res.success) {
        return { success: false, type, label: res.error || "I couldn't set up that recurring series." };
      }

      const tail = res.failed
        ? ` (${res.failed} couldn't be added — reopen the app to retry)`
        : res.open_ended
          ? " — ongoing, I'll keep extending it automatically"
          : "";
      return {
        success: true,
        type,
        label: `Scheduled ${res.created} ${title || "lessons"} · ${res.summary}${tail}`,
        page: "CalendarView",
      };
    }

    case "CREATE_INVOICE_FROM_EVENTS": {
      const eventIds = Array.isArray(data.event_ids) ? data.event_ids.filter(Boolean) : [];
      if (eventIds.length === 0) {
        return { success: false, type, label: "Tell me which lessons to invoice and I'll bundle them." };
      }
      const layout = data.layout === "bundled" ? "bundled" : "per_event";
      const { document, event_count } = await appClient.helpers.buildInvoiceFromEvents({
        event_ids: eventIds,
        layout,
        title: data.title,
        due_date: data.due_date,
        notes: data.notes,
        status: data.status,
        currency: data.currency,
      });
      return {
        success: true,
        type,
        label: `Created invoice for ${event_count} ${event_count === 1 ? "session" : "sessions"}${document.document_number ? " #" + document.document_number : ""}`,
        entityId: document.id,
        page: "DocumentDetail",
        navigate: { page: "DocumentDetail", params: { id: document.id } },
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

    case "UPDATE_CLIENT": {
      if (!data.id) return { success: false, type, label: "Which client should I update?" };
      const { id, ...patch } = data;
      await appClient.entities.Client.update(id, patch);
      return {
        success: true, type,
        label: `Updated client${data.name ? ": " + data.name : ""}`,
        entityId: id, page: "ClientDetail",
        navigate: { page: "ClientDetail", params: { id } },
      };
    }

    case "DELETE_EVENT": {
      if (!data.id) return { success: false, type, label: "Which event should I delete?" };
      await appClient.entities.WorkEvent.delete(data.id);
      return { success: true, type, label: `Deleted event${data.title ? ": " + data.title : ""}` };
    }

    case "DELETE_CLIENT": {
      if (!data.id) return { success: false, type, label: "Which client should I delete?" };
      await appClient.entities.Client.delete(data.id);
      return { success: true, type, label: `Deleted client${data.name ? ": " + data.name : ""}` };
    }

    case "UPDATE_INVOICE": {
      if (!data.id) return { success: false, type, label: "Which invoice should I update?" };
      const { id, ...patch } = data;
      const todayStr = new Date().toISOString().slice(0, 10);
      // Auto-stamp the matching date when a status change implies one.
      if (patch.status === "paid" && patch.paid_date == null) patch.paid_date = todayStr;
      if (patch.status === "sent" && patch.sent_date == null) patch.sent_date = todayStr;
      await appClient.entities.Document.update(id, patch);
      return {
        success: true, type,
        label: `Updated invoice${patch.status ? " → " + patch.status : ""}`,
        entityId: id, page: "DocumentDetail",
        navigate: { page: "DocumentDetail", params: { id } },
      };
    }

    case "DELETE_INVOICE": {
      if (!data.id) return { success: false, type, label: "Which invoice should I delete?" };
      await appClient.entities.Document.delete(data.id);
      return { success: true, type, label: `Deleted invoice${data.title ? ": " + data.title : ""}` };
    }

    case "RECORD_PAYMENT": {
      const documentId = data.document_id || data.invoice_id;
      if (!documentId) return { success: false, type, label: "Which invoice was paid?" };
      await appClient.helpers.recordPayment({
        document_id: documentId,
        amount: Number(data.amount) || 0,
        payment_date: data.payment_date || new Date().toISOString().slice(0, 10),
        payment_method: data.payment_method || "",
        reference: data.reference || "",
        notes: data.notes || "",
      });
      return {
        success: true, type,
        label: `Recorded payment${data.amount ? ": " + data.amount : ""}`,
        entityId: documentId, page: "DocumentDetail",
        navigate: { page: "DocumentDetail", params: { id: documentId } },
      };
    }

    case "UPDATE_INVOICE_STYLE": {
      // Restyle the Personal invoice template within fixed rails.
      // sanitizeCustom() whitelists fields + clamps values, so the AI can
      // only change accent/header/font/footer/logo — never the layout.
      const all = await appClient.entities.AppSettings.list().catch(() => []);
      const current = all[0];
      const merged = sanitizeCustom({ ...(current?.invoice_custom || {}), ...data });
      if (current?.id) {
        await appClient.entities.AppSettings.update(current.id, { invoice_custom: merged, invoice_template: 6 });
      } else {
        await appClient.entities.AppSettings.create({ invoice_custom: merged, invoice_template: 6 });
      }
      return { success: true, type, label: "Updated your invoice style" };
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
  "Hey! I'm your Flow Assistant. Ask me anything about your gigs, clients and invoices — I can create, find, update or cancel events and invoices, add clients, record payments, look up venues, and keep your schedule in order.";

function personalGreeting(profile) {
  if (!profile?.user_name) return DEFAULT_GREETING;
  const aiName = profile.assistant_name ? `I'm ${profile.assistant_name}` : "I'm your assistant";
  return `Hey ${profile.user_name}! ${aiName} — ask me anything about your gigs, clients and invoices. I can create, find, update or cancel events and invoices, add clients, record payments, and look up venues.`;
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

          // Handle SUGGEST_CONTACT_PICKER — show a card offering to pull the
          // new client's phone/email from the device contacts. The user taps,
          // picks the contact, and the details flow back as a message.
          if (action.type === "SUGGEST_CONTACT_PICKER") {
            const supported = "contacts" in navigator && "ContactsManager" in window;
            if (supported) {
              const name = action.data?.name || "";
              // Resolve real client id: the AI may not know it, but we do from
              // the CREATE_CLIENT that ran earlier in this same turn.
              const resolvedId = action.data?.client_id
                || (name ? batchClientIds[name.toLowerCase().trim()] : "")
                || "";
              setMessages((prev) => [
                ...prev,
                makeMessage("contact_picker", action.data?.prompt || `Want me to grab ${name || "their"} phone and email from your contacts?`, {
                  clientName: name,
                  clientId: resolvedId,
                }),
              ]);
            }
            // If not supported, silently skip — the client was already created with just the name.
            continue;
          }

          // Handle LOCATION_SEARCH inline — render tappable options the user
          // picks from; the chosen address flows back so the AI can finish.
          if (action.type === "LOCATION_SEARCH") {
            try {
              const query = encodeURIComponent(action.data?.query || "");
              const resp = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${query}`,
                { headers: { "User-Agent": "Flowtone/1.0" } }
              );
              const results = await resp.json();
              if (Array.isArray(results) && results.length > 0) {
                const locations = results.slice(0, 5).map((r) => ({
                  label: shortPlaceLabel(r),
                  address: r.display_name,
                }));
                setMessages((prev) => [
                  ...prev,
                  makeMessage("locations", "Tap the right place:", { locations }),
                ]);
              } else {
                setMessages((prev) => [...prev, makeMessage("assistant", "I couldn't find that place. Could you give me the area or a postcode?")]);
              }
            } catch {
              setMessages((prev) => [...prev, makeMessage("assistant", "I couldn't search for that location just now — you can paste the address and I'll use it.")]);
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
