import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { flushSync } from "react-dom";
import { appClient } from "@/api/appClient";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { createPageUrl, formatMoney } from "@/utils";
import { useGoBack } from "@/hooks/useGoBack";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft, Trash2, Banknote, Phone, User, Clock, MapPin,
  Package, Mail, Navigation, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, AlertTriangle, FileText, CalendarDays, RefreshCw,
  Dumbbell, Check, X, CheckCircle2, Target, ExternalLink, Loader2, MessageCircle, Plus, Sparkles
} from "lucide-react";
import { deleteCalendarEvent } from "@/lib/calendarClient";
import { suggestClientForEvent } from "@/lib/clientMatch";
import { hasFee } from "@/lib/missingInfo";

const STATUS_LABELS = { lead: "Tentative", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" };
const SERIES_FIELDS = ["start_time", "end_time", "base_price", "total_price", "currency", "location_address"];

function buildNavUrl(address) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

// wa.me needs an international number with digits only (no +, spaces or dashes).
function whatsappUrl(phone) {
  return `https://wa.me/${(phone || "").replace(/[^\d]/g, "")}`;
}

function eventDateLabel(date) {
  if (!date) return "";
  try { return format(parseISO(date), "EEE d MMM"); } catch { return date; }
}
import EventInfoSection from "../components/workevent/EventInfoSection";
import EventFinancialsSection from "../components/workevent/EventFinancialsSection";
import EventEquipmentSection from "../components/workevent/EventEquipmentSection";
import EventNavigationSection from "../components/workevent/EventNavigationSection";
import EventEmailSection from "../components/workevent/EventEmailSection";

const SECTIONS = [
  { key: "info",       label: "Info",       icon: CalendarDays },
  { key: "practice",   label: "Practice",   icon: Dumbbell },
  { key: "financials", label: "Financials", icon: Banknote, hideForPractice: true },
  { key: "equipment",  label: "Equipment",  icon: Package },
  { key: "navigation", label: "Navigate",   icon: Navigation },
  { key: "email",      label: "Email",      icon: Mail },
];

const TODAY = format(new Date(), "yyyy-MM-dd");

// Chronological order for prev/next: date, then start time, then a stable tiebreak.
const eventOrderKey = (e) => `${e.date || ""}T${e.start_time || e.time || "00:00"}#${e.id}`;

// Keyed on the event id so swiping to a neighbour mounts a clean page — the
// loaded estimate/invoice, open section and prompts must not carry over.
export default function WorkEventDetail() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  return <WorkEventDetailInner key={id || "new"} id={id} params={params} slideFrom={location.state?.slide} />;
}

function WorkEventDetailInner({ id, params, slideFrom }) {
  const prefilledDate     = params.get("date");         // passed from calendar when creating new event
  const prefilledType     = params.get("event_type");   // e.g. "Practice" from Practice page shortcut
  const prefilledLinkedGig = params.get("linked_gig_id"); // pre-link practice to a gig
  const navigate = useNavigate();
  const goBack = useGoBack("WorkEvents");

  const [event, setEvent] = useState({
    title: "", event_type: prefilledType || "Gig", status: "lead",
    date: prefilledDate || "",
    currency: "GBP", base_price: 0, adjustments: [], total_price: 0,
    equipment_checklist: [], base_price_locked: false,
    ...(prefilledLinkedGig ? { linked_gig_id: prefilledLinkedGig } : {}),
  });
  const [clients, setClients] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [savingState, setSavingState] = useState("idle"); // 'idle' | 'saving' | 'saved'
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  // Existing events open with everything collapsed so the hero leads; new
  // events open the form (Info, or Practice when prefilled) since there's no hero.
  const [openSection, setOpenSection] = useState(
    id ? null : (prefilledType === "Practice" ? "practice" : "info")
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Every event, loaded once: feeds prev/next, linked practice sessions and
  // the "preparing for" gig picker.
  const [allEvents, setAllEvents] = useState([]);
  const [practiceGoals, setPracticeGoals] = useState([]);
  const [loggingPractice, setLoggingPractice] = useState(false);
  // Proactive client link for an event with no client — see clientMatch.js.
  // { client, confidence, applied, auto, fee, before } | null
  const [clientSuggestion, setClientSuggestion] = useState(null);
  // "Apply to series" prompt — shown after a recurring event's time/price/
  // location changes vs. the baseline it was loaded with. `fields` lists what changed.
  const [seriesPrompt, setSeriesPrompt] = useState(null); // { fields: string[], event } | null
  const [applyingToSeries, setApplyingToSeries] = useState(false);

  // Refs for the debounced auto-save (read latest values without stale closures)
  const eventRef = useRef(event);
  const estimateRef = useRef(estimate);
  const invoiceRef = useRef(invoice);
  const saveTimerRef = useRef(null);
  const seriesBaselineRef = useRef(null); // series-field values as loaded, for diffing
  useEffect(() => { eventRef.current = event; }, [event]);
  useEffect(() => { estimateRef.current = estimate; }, [estimate]);
  useEffect(() => { invoiceRef.current = invoice; }, [invoice]);

  const isPractice = event.event_type === "Practice";

  const clientObj = useMemo(
    () => clients.find(c => c.id === event.client_id) || null,
    [clients, event.client_id]
  );
  const clientPhone = clientObj?.phones?.find(Boolean) || "";
  const clientEmail = clientObj?.emails?.find(Boolean) || "";
  const eventFee = event.total_price || event.base_price || 0;

  // Filter sections based on event type
  const visibleSections = useMemo(() =>
    SECTIONS.filter(s => {
      if (s.hideForPractice && isPractice) return false;
      return true;
    }),
    [isPractice]
  );

  useEffect(() => {
    const promises = [appClient.entities.Client.list()];
    if (id) promises.push(appClient.entities.WorkEvent.filter({ id }));
    Promise.all(promises).then(async ([cls, evts]) => {
      setClients(cls);
      if (evts && evts[0]) {
        const e = evts[0];
        setEvent(e);
        seriesBaselineRef.current = e;

        // Load linked documents (one-directional: Document owns work_event_id)
        const docs = await appClient.entities.Document.filter({ work_event_id: e.id });
        const est = docs.find(d => d.document_type === "estimate");
        const inv = docs.find(d => d.document_type === "invoice");
        if (est) setEstimate(est);
        if (inv) setInvoice(inv);
      }
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (!id && !isPractice) return;
    appClient.entities.WorkEvent.list("date", 1000).then(setAllEvents);
  }, [id, isPractice]);

  useEffect(() => {
    if (!isPractice) return;
    appClient.entities.PracticeGoal.list().then(goals => setPracticeGoals(goals.filter(g => !g.completed)));
  }, [isPractice]);

  const upcomingGigs = useMemo(() =>
    allEvents
      .filter(e => e.event_type !== "Practice" && e.date >= TODAY && e.id !== id)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 40),
    [allEvents, id]
  );
  const linkedPracticeSessions = useMemo(() =>
    allEvents.filter(e => e.event_type === "Practice" && e.linked_gig_id === id),
    [allEvents, id]
  );

  // Neighbours on the calendar, for swiping between events.
  const { prevEvent, nextEvent } = useMemo(() => {
    const ordered = allEvents
      .filter(e => e.date)
      .sort((a, b) => eventOrderKey(a).localeCompare(eventOrderKey(b)));
    const i = ordered.findIndex(e => e.id === id);
    return {
      prevEvent: i > 0 ? ordered[i - 1] : null,
      nextEvent: i >= 0 && i < ordered.length - 1 ? ordered[i + 1] : null,
    };
  }, [allEvents, id]);

  // ── Auto-save (existing events) ─────────────────────────────────────
  // Persist the latest event to the DB. Reads from refs so the debounced
  // timer never captures a stale event/estimate/invoice.
  const persist = useCallback(async () => {
    const ev = eventRef.current;
    if (!ev?.id) return;
    setSavingState("saving");
    try {
      await appClient.entities.WorkEvent.update(ev.id, ev);

      // If the event is now confirmed and has an estimate but no invoice, convert it.
      if ((ev.status === "confirmed" || ev.status === "completed") && estimateRef.current && !invoiceRef.current) {
        const newInvoice = await appClient.helpers.convertEstimateToInvoice(estimateRef.current.id);
        await appClient.entities.Document.update(newInvoice.id, { work_event_id: ev.id });
        setInvoice(newInvoice);
      }

      // For recurring events, offer to apply series-relevant changes to the rest.
      if (ev.is_recurring && ev.recurrence_id && seriesBaselineRef.current) {
        const baseline = seriesBaselineRef.current;
        const changed = SERIES_FIELDS.filter(
          (f) => String(ev[f] ?? "") !== String(baseline[f] ?? ""),
        );
        if (changed.length > 0) setSeriesPrompt({ fields: changed, event: ev });
      }

      setSavingState("saved");
      setTimeout(() => setSavingState((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch (err) {
      console.error("Auto-save error:", err);
      setSavingState("idle");
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { persist(); }, 1200);
  }, [persist]);

  // Flush any pending save when leaving the page (e.g. tapping a bottom-nav
  // item) so nothing is lost. Fire-and-forget raw update — no setState on an
  // unmounting component.
  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      const ev = eventRef.current;
      if (ev?.id) appClient.entities.WorkEvent.update(ev.id, ev).catch(() => {});
    }
  }, []);

  // Open an accordion section — used by the hero's clickable rows/badges so a
  // tap jumps straight to the editable fields. With a focusId the field is
  // focused synchronously inside the tap (flushSync), which is what iOS needs
  // to actually raise the keyboard; otherwise the section is scrolled into view.
  const goToSection = (key, focusId) => {
    flushSync(() => setOpenSection(key));
    const field = focusId && document.getElementById(focusId);
    if (field) {
      field.focus();
      return;
    }
    setTimeout(() => {
      document.getElementById(`section-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  // Move to a neighbouring event. Any pending edit is saved first; the history
  // entry is replaced so Back still returns to the list, not through every
  // event swiped past.
  const goToEvent = async (target, slide) => {
    if (!target) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      await persist();
    }
    navigate(createPageUrl(`WorkEventDetail?id=${target.id}`), { replace: true, state: { slide } });
  };

  const touchRef = useRef(null);
  const onTouchStart = (e) => {
    const t = e.touches[0];
    const el = e.target;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
    // Leave the first strip of the screen to the OS back-swipe.
    touchRef.current = !t || t.clientX < 24 || typing ? null : { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const start = touchRef.current;
    touchRef.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) goToEvent(nextEvent, "left");
    else goToEvent(prevEvent, "right");
  };

  const onChange = (field, value) => {
    setEvent(prev => {
      const updated = { ...prev, [field]: value };
      return updated;
    });
    // Auto-open the practice accordion when user picks Practice type
    if (field === "event_type" && value === "Practice") {
      setOpenSection("practice");
    }
    if (id) scheduleSave();
  };

  // Link a client to this event; pull their usual fee in if the event has none.
  const applyClient = (client, { auto } = {}) => {
    const ev = eventRef.current;
    const fee = !hasFee(ev) && Number(client.default_fee) > 0 ? Number(client.default_fee) : null;
    const before = { client_id: ev.client_id || "", base_price: ev.base_price, total_price: ev.total_price, currency: ev.currency };
    setEvent(prev => ({
      ...prev,
      client_id: client.id,
      ...(fee ? { base_price: fee, total_price: fee, currency: client.default_currency || prev.currency } : {}),
    }));
    scheduleSave();
    setClientSuggestion({ client, applied: true, auto, fee, before });
  };

  const undoClient = () => {
    const before = clientSuggestion?.before;
    setEvent(prev => ({ ...prev, ...(before || {}), client_suggestion_dismissed: true }));
    scheduleSave();
    setClientSuggestion(null);
  };

  const dismissClientSuggestion = () => {
    setEvent(prev => ({ ...prev, client_suggestion_dismissed: true }));
    scheduleSave();
    setClientSuggestion(null);
  };

  // Once loaded: if the event has no client but its words name one we know,
  // link it (sure match) or ask (partial match). Dismissals stick on the event.
  useEffect(() => {
    if (loading || !id) return;
    const ev = eventRef.current;
    if (ev.client_id || ev.client_suggestion_dismissed || ev.event_type === "Practice") return;
    const match = suggestClientForEvent(ev, clients);
    if (!match) return;
    if (match.confidence === "high") applyClient(match.client, { auto: true });
    else setClientSuggestion({ ...match, applied: false });
  }, [loading]);

  // Flush before navigating back, so a half-typed change still lands.
  const handleBack = async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (id) await persist();
    goBack();
  };

  // New events still need an explicit "create" action — auto-saving a blank
  // event on the first keystroke would litter the calendar with junk.
  const handleCreate = async () => {
    setSaving(true);
    try {
      const created = await appClient.entities.WorkEvent.create(event);

      // Skip auto-estimate for Practice events — no financials needed
      if (created.event_type !== "Practice") {
        const client = clients.find(c => c.id === created.client_id);
        const fee = created.base_price || client?.default_fee || 0;
        const estNumber = await appClient.helpers.getNextDocumentNumber("estimate");
        await appClient.entities.Document.create({
          document_type: "estimate",
          document_number: estNumber,
          title: created.title,
          client_id: created.client_id || "",
          client_email: "",
          work_event_id: created.id,
          is_standalone: false,
          status: "draft",
          currency: created.currency || "GBP",
          line_items: fee > 0 ? [{ description: created.event_type || "Performance", quantity: 1, unit_price: fee, total: fee }] : [],
          subtotal: fee,
          total: fee,
          discount_type: null,
          discount_value: 0,
          discount_amount: 0,
          tax_rate: 0,
          tax_amount: 0,
          is_locked: false,
          paid_amount: 0,
        });
      }

      // Go back to wherever the user came from (calendar, practice page, events list)
      goBack();
    } catch (err) {
      console.error("Create error:", err);
    }
    setSaving(false);
  };

  // Log a practice session when the user checks in "Yes I did this"
  const handlePracticeCheckin = async (completed) => {
    if (!id || loggingPractice) return;
    setLoggingPractice(true);
    try {
      if (completed) {
        const session = await appClient.entities.PracticeSession.create({
          date: event.date || TODAY,
          duration_minutes: (event.duration_hours || 1) * 60,
          notes: event.practice_plan || "",
          goal_id: event.practice_goal_id || null,
          work_event_id: id,
          energy_rating: 3,
          items: [],
        });
        await appClient.entities.WorkEvent.update(id, {
          ...event,
          practice_logged: true,
          practice_session_id: session.id,
        });
        setEvent(prev => ({ ...prev, practice_logged: true, practice_session_id: session.id }));
      } else {
        // Mark as skipped (logged = false, explicitly set)
        await appClient.entities.WorkEvent.update(id, {
          ...event,
          practice_logged: false,
          practice_skipped: true,
        });
        setEvent(prev => ({ ...prev, practice_logged: false, practice_skipped: true }));
      }
    } catch (err) {
      console.error("Practice check-in error:", err);
    }
    setLoggingPractice(false);
  };

  // Create an invoice for this gig directly — works whether or not an estimate
  // exists. If there's an estimate, convert it (keeps its line items); otherwise
  // build the invoice straight from the event's fee. Fixes the dead-end where
  // gigs that arrived via calendar sync/import had no way to be invoiced.
  const handleCreateInvoice = async () => {
    if (!id || invoice) return;
    setCreatingInvoice(true);
    try {
      let newInvoice;
      if (estimate) {
        newInvoice = await appClient.helpers.convertEstimateToInvoice(estimate.id);
        await appClient.entities.Document.update(newInvoice.id, { work_event_id: id });
        const docs = await appClient.entities.Document.filter({ id: estimate.id });
        if (docs[0]) setEstimate(docs[0]);
      } else {
        const { document } = await appClient.helpers.buildInvoiceFromEvents({ event_ids: [id] });
        newInvoice = document;
      }
      setInvoice(newInvoice);
      navigate(createPageUrl(`DocumentDetail?id=${newInvoice.id}`));
    } catch (err) {
      console.error("Create invoice error:", err);
    }
    setCreatingInvoice(false);
  };

  const handleDelete = async () => {
    // Remove the Google copy too — a delete is a real delete. Best-effort:
    // deleteCalendarEvent fails quiet, so a sync hiccup never blocks the delete.
    if (event?.google_calendar_event_id) {
      await deleteCalendarEvent(event.google_calendar_event_id);
    }
    await appClient.entities.WorkEvent.delete(id);
    navigate(createPageUrl("WorkEvents"));
  };

  const toggleSection = (key) => setOpenSection(openSection === key ? null : key);

  const handleApplyToSeries = async () => {
    if (!seriesPrompt) return;
    setApplyingToSeries(true);
    await appClient.helpers.applyToUpcomingInSeries({
      event: seriesPrompt.event,
      fields: seriesPrompt.fields,
    });
    setApplyingToSeries(false);
    seriesBaselineRef.current = eventRef.current; // changes are now the new baseline
    setSeriesPrompt(null);
  };

  // Dismiss the series offer ("just this one" / close) and stop re-prompting
  // for the same change by re-baselining to the current values.
  const dismissSeriesPrompt = () => {
    seriesBaselineRef.current = eventRef.current;
    setSeriesPrompt(null);
  };

  // Is this a past or today's practice event that hasn't been logged yet?
  const showCheckin = isPractice && id && event.date && event.date <= TODAY && !event.practice_logged && !event.practice_skipped;
  const alreadyLogged = isPractice && event.practice_logged;
  const wasSkipped = isPractice && event.practice_skipped && !event.practice_logged;

  // Hero summary bits — what's attached, shown as clickable indicators.
  const notesFirstLine = (event.notes || "").trim().split("\n").find(Boolean) || "";
  const equipmentCount = (event.equipment_checklist || []).filter(Boolean).length;
  const linkedDoc = invoice || estimate;
  const linkedDocLabel = invoice ? "Invoice" : estimate ? "Estimate" : "";
  const practiceCount = linkedPracticeSessions.length;
  const heroBadge = "flex items-center gap-1.5 text-xs font-medium text-gray-200 bg-gray-800/60 hover:bg-gray-700/70 border border-gray-700/50 px-2.5 py-1 rounded-lg transition-colors";
  const heroAddChip = "flex items-center gap-1 text-xs font-medium text-indigo-200/90 hover:text-white border border-dashed border-indigo-500/50 hover:border-indigo-400 px-2.5 py-1 rounded-lg transition-colors";

  if (loading) return <div className="p-4 text-gray-400">Loading...</div>;

  const slideCls = slideFrom === "left" ? "animate-in slide-in-from-right-4 fade-in duration-200"
    : slideFrom === "right" ? "animate-in slide-in-from-left-4 fade-in duration-200" : "";

  return (
    <div className="max-w-xl mx-auto" onTouchStart={id ? onTouchStart : undefined} onTouchEnd={id ? onTouchEnd : undefined}>
      {/* New events keep a small bar with Create — existing events navigate
           back via the bottom nav, so they need no header at all. */}
      {!id && (
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 sticky top-0 z-20 border-b border-gray-800">
          <button onClick={handleBack} className="text-gray-400 hover:text-white transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="flex-1 min-w-0 font-semibold text-white truncate">New Event</h1>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white flex items-center gap-1.5 transition-colors flex-shrink-0"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <><Check className="w-4 h-4" /> Create</>}
          </button>
        </div>
      )}

      {/* Hero ticket — at-a-glance, fully clickable summary for an existing event */}
      {id && (
        <div className={`mx-4 mt-4 bg-gradient-to-br from-indigo-900/80 to-gray-900 rounded-2xl border border-indigo-700/30 overflow-hidden ${slideCls}`}>
          <div className="p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-2xl font-bold text-white leading-tight">{event.title || "Untitled Event"}</h2>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {eventFee > 0 && (
                  <span className="text-xl font-bold text-white whitespace-nowrap sensitive">
                    {formatMoney(eventFee, event.currency || "GBP").replace(/\.00$/, "")}
                  </span>
                )}
                <span className="text-[11px] h-4 flex items-center">
                  {savingState === "saving" && <span className="text-indigo-300/80 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>}
                  {savingState === "saved" && <span className="text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> Saved</span>}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              {event.event_type && (
                <span className="text-[11px] font-medium text-indigo-200 bg-indigo-600/30 px-2 py-0.5 rounded-full">{event.event_type}</span>
              )}
              {event.status && (
                <span className="text-[11px] font-medium text-gray-300 bg-gray-700/50 px-2 py-0.5 rounded-full">{STATUS_LABELS[event.status] || event.status}</span>
              )}
              {event.is_recurring && (
                <span className="text-[11px] font-medium text-indigo-200 bg-indigo-600/30 px-2 py-0.5 rounded-full flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Recurring</span>
              )}
              {isPractice && alreadyLogged && (
                <span className="text-[11px] font-medium text-teal-300 bg-teal-900/50 px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Logged</span>
              )}
            </div>

            {(event.date || event.start_time) && (
              <div className="flex items-center gap-3 text-sm text-gray-200 flex-wrap mt-4">
                {event.date && (
                  <button
                    onClick={() => navigate(createPageUrl(`CalendarView?date=${event.date}`))}
                    className="flex items-center gap-1.5 hover:text-white transition-colors"
                  >
                    <CalendarDays className="w-4 h-4 text-indigo-400" />{eventDateLabel(event.date)}
                  </button>
                )}
                {event.start_time && (
                  <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-indigo-400" />{event.start_time}{event.end_time ? `–${event.end_time}` : ""}</span>
                )}
              </div>
            )}

            {clientObj && (
              <div className="mt-3">
                <Link to={createPageUrl(`ClientDetail?id=${clientObj.id}`)} className="flex items-center gap-1.5 text-sm text-gray-200 hover:text-white transition-colors min-w-0">
                  <User className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                  <span className="truncate">{clientObj.name}</span>
                </Link>
                {(clientPhone || clientEmail) && (
                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    {clientPhone && (
                      <a href={whatsappUrl(clientPhone)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-green-300 bg-green-600/20 hover:bg-green-600/35 border border-green-700/30 px-2.5 py-1 rounded-lg transition-colors">
                        <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                      </a>
                    )}
                    {clientPhone && (
                      <a href={`tel:${clientPhone}`} className="flex items-center gap-1.5 text-xs font-medium text-indigo-200 bg-indigo-600/30 hover:bg-indigo-600/50 px-2.5 py-1 rounded-lg transition-colors">
                        <Phone className="w-3.5 h-3.5" /> Call
                      </a>
                    )}
                    {clientEmail && (
                      <a href={`mailto:${clientEmail}`} className="flex items-center gap-1.5 text-xs font-medium text-indigo-200 bg-indigo-600/30 hover:bg-indigo-600/50 px-2.5 py-1 rounded-lg transition-colors">
                        <Mail className="w-3.5 h-3.5" /> Email
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {event.location_address && (
              <div className="flex items-center gap-2 mt-3 text-sm text-gray-300">
                <button
                  onClick={() => goToSection("info", "event-location")}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-white transition-colors"
                >
                  <MapPin className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                  <span className="truncate">{event.location_address}</span>
                </button>
                <a
                  href={buildNavUrl(event.location_address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Directions"
                  className="p-1 -m-1 text-indigo-400 hover:text-indigo-300 transition-colors flex-shrink-0"
                >
                  <Navigation className="w-4 h-4" />
                </a>
              </div>
            )}

            {/* What's still missing — one tap lands in the field, keyboard up */}
            {(!event.location_address || (!isPractice && !(eventFee > 0)) || !event.start_time) && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {!event.location_address && (
                  <button onClick={() => goToSection("info", "event-location")} className={heroAddChip}>
                    <Plus className="w-3 h-3" /> Add location
                  </button>
                )}
                {!isPractice && !(eventFee > 0) && (
                  <button onClick={() => goToSection("financials", "event-fee")} className={heroAddChip}>
                    <Plus className="w-3 h-3" /> Add fee
                  </button>
                )}
                {!event.start_time && (
                  <button onClick={() => goToSection("info", "event-start-time")} className={heroAddChip}>
                    <Plus className="w-3 h-3" /> Add time
                  </button>
                )}
              </div>
            )}

            {notesFirstLine && (
              <button
                onClick={() => goToSection("info")}
                className="flex items-start gap-2 mt-3 text-sm text-gray-300 hover:text-white transition-colors text-left w-full"
              >
                <FileText className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                <span className="truncate flex-1">{notesFirstLine}</span>
              </button>
            )}

            {/* What's attached — tap to jump to that section */}
            {(linkedDoc || equipmentCount > 0 || (!isPractice && practiceCount > 0)) && (
              <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-indigo-700/20">
                {linkedDoc && (
                  <button onClick={() => goToSection("financials")} className={heroBadge}>
                    <FileText className="w-3.5 h-3.5 text-indigo-400" /> {linkedDocLabel}
                  </button>
                )}
                {equipmentCount > 0 && (
                  <button onClick={() => goToSection("equipment")} className={heroBadge}>
                    <Package className="w-3.5 h-3.5 text-indigo-400" /> Gear · {equipmentCount}
                  </button>
                )}
                {!isPractice && practiceCount > 0 && (
                  <button onClick={() => goToSection("practice")} className={heroBadge}>
                    <Dumbbell className="w-3.5 h-3.5 text-teal-400" /> Practice · {practiceCount}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Neighbours on the calendar — also reachable by swiping left/right */}
          {(prevEvent || nextEvent) && (
            <div className="flex items-stretch border-t border-indigo-700/20 divide-x divide-indigo-700/20">
              <button
                onClick={() => goToEvent(prevEvent, "right")}
                disabled={!prevEvent}
                className="flex-1 min-w-0 flex items-center gap-1.5 px-4 py-2.5 text-left hover:bg-indigo-900/30 disabled:invisible transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[10px] uppercase tracking-wide text-gray-500">Previous</span>
                  <span className="block text-xs text-gray-200 truncate">{prevEvent && `${eventDateLabel(prevEvent.date)} · ${prevEvent.title || "Untitled"}`}</span>
                </span>
              </button>
              <button
                onClick={() => goToEvent(nextEvent, "left")}
                disabled={!nextEvent}
                className="flex-1 min-w-0 flex items-center justify-end gap-1.5 px-4 py-2.5 text-right hover:bg-indigo-900/30 disabled:invisible transition-colors"
              >
                <span className="min-w-0">
                  <span className="block text-[10px] uppercase tracking-wide text-gray-500">Next</span>
                  <span className="block text-xs text-gray-200 truncate">{nextEvent && `${eventDateLabel(nextEvent.date)} · ${nextEvent.title || "Untitled"}`}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Client spotted in the title/notes — linked, or offered */}
      {id && clientSuggestion && (
        <div className="mx-4 mt-4 bg-indigo-950/60 border border-indigo-700/50 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              {clientSuggestion.applied ? (
                <>
                  <p className="text-sm text-indigo-100 font-medium">
                    Linked to <Link to={createPageUrl(`ClientDetail?id=${clientSuggestion.client.id}`)} className="underline decoration-indigo-500/60 hover:text-white">{clientSuggestion.client.name}</Link>
                  </p>
                  <p className="text-xs text-indigo-300/70 mt-0.5">
                    {clientSuggestion.auto ? "Their name is in this event. " : ""}
                    {clientSuggestion.fee
                      ? <>Fee set to <span className="sensitive">{formatMoney(clientSuggestion.fee, eventRef.current.currency || "GBP")}</span> from their usual rate.</>
                      : null}
                  </p>
                </>
              ) : (
                <p className="text-sm text-indigo-100 font-medium">
                  Is this for <span className="text-white">{clientSuggestion.client.name}</span>?
                </p>
              )}
            </div>
            {clientSuggestion.applied ? (
              <button onClick={undoClient} className="text-xs text-indigo-300 hover:text-white transition-colors flex-shrink-0">Undo</button>
            ) : (
              <button onClick={dismissClientSuggestion} className="text-indigo-400/60 hover:text-indigo-300 transition-colors flex-shrink-0" aria-label="No">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {!clientSuggestion.applied && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => applyClient(clientSuggestion.client)}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Yes, link {clientSuggestion.client.name}
              </button>
              <button
                onClick={dismissClientSuggestion}
                className="px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg py-2 text-sm font-medium transition-colors"
              >
                No
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pulled from Google with no details — nudge the user to complete it */}
      {id && event.created_from_gcal && !event.client_id && (
        <div className="mx-4 mt-4 bg-amber-900/25 border border-amber-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-100">This gig came from Google. Add the client, fee and any details to complete it.</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button onClick={() => goToSection("info", "event-client")} className="text-xs font-medium text-amber-100 bg-amber-800/40 hover:bg-amber-700/50 border border-amber-700/40 px-2.5 py-1 rounded-lg transition-colors">Add client</button>
            {!isPractice && !(eventFee > 0) && (
              <button onClick={() => goToSection("financials", "event-fee")} className="text-xs font-medium text-amber-100 bg-amber-800/40 hover:bg-amber-700/50 border border-amber-700/40 px-2.5 py-1 rounded-lg transition-colors">Add fee</button>
            )}
            {!event.location_address && (
              <button onClick={() => goToSection("info", "event-location")} className="text-xs font-medium text-amber-100 bg-amber-800/40 hover:bg-amber-700/50 border border-amber-700/40 px-2.5 py-1 rounded-lg transition-colors">Add location</button>
            )}
          </div>
        </div>
      )}

      {/* Apply-to-series prompt — shown after saving a recurring event when
           time or price changed */}
      {seriesPrompt && (
        <div className="mx-4 mt-4 bg-indigo-950/60 border border-indigo-700/50 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <RefreshCw className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-indigo-100 font-medium mb-0.5">Apply to all upcoming lessons?</p>
              <p className="text-xs text-indigo-300/70">
                {seriesPrompt.fields
                  .map((f) => ({
                    start_time: "start time", end_time: "end time",
                    base_price: "fee", total_price: "fee", currency: "currency",
                    location_address: "location",
                  }[f] || f))
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .join(", ")
                  .replace(/^(.)/, (c) => c.toUpperCase())} changed — apply to future occurrences in this series.
              </p>
            </div>
            <button
              onClick={dismissSeriesPrompt}
              className="text-indigo-400/60 hover:text-indigo-300 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleApplyToSeries}
              disabled={applyingToSeries}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              {applyingToSeries
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying…</>
                : <><CheckCircle2 className="w-3.5 h-3.5" /> Yes, apply to all upcoming</>}
            </button>
            <button
              onClick={dismissSeriesPrompt}
              className="px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg py-2 text-sm font-medium transition-colors"
            >
              Just this one
            </button>
          </div>
        </div>
      )}

      {/* Practice check-in banner — shown for past/today practice events */}
      {showCheckin && (
        <div className="mx-4 mt-4 bg-teal-900/30 border border-teal-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Dumbbell className="w-4 h-4 text-teal-400" />
            <span className="text-sm font-semibold text-teal-200">Did you complete this practice session?</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => handlePracticeCheckin(true)}
              disabled={loggingPractice}
              className="flex-1 flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors"
            >
              {loggingPractice ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Yes, I did it!
            </button>
            <button
              onClick={() => handlePracticeCheckin(false)}
              disabled={loggingPractice}
              className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 rounded-lg py-2.5 text-sm font-semibold transition-colors"
            >
              <X className="w-4 h-4" />
              Skipped
            </button>
          </div>
        </div>
      )}

      {/* Already logged confirmation */}
      {alreadyLogged && (
        <div className="mx-4 mt-4 bg-teal-900/20 border border-teal-700/40 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-teal-400" />
            <span className="text-sm text-teal-300 font-medium">Practice session logged</span>
          </div>
          <button
            onClick={() => navigate(createPageUrl("Practice"))}
            className="flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 transition-colors"
          >
            View <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Skipped notice */}
      {wasSkipped && (
        <div className="mx-4 mt-4 bg-gray-800/60 border border-gray-700/40 rounded-xl px-4 py-3 flex items-center gap-2">
          <X className="w-4 h-4 text-gray-500" />
          <span className="text-sm text-gray-500">Session marked as skipped</span>
          <button
            onClick={() => setEvent(prev => ({ ...prev, practice_skipped: false }))}
            className="ml-auto text-xs text-gray-400 hover:text-white transition-colors"
          >
            Undo
          </button>
        </div>
      )}

      {/* Sections */}
      <div className="p-4 space-y-2">
        {visibleSections.map(({ key, label, icon: Icon }) => (
          <div key={key} id={`section-${key}`} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
            <button
              onClick={() => toggleSection(key)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/50 transition-colors"
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${key === "practice" ? "text-teal-400" : "text-indigo-400"}`} />
              <span className="flex-1 font-medium text-gray-200 text-sm">{label}</span>
              {openSection === key ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
            </button>
            {openSection === key && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-800">
                {key === "info" && <EventInfoSection event={event} onChange={onChange} clients={clients} />}

                {key === "practice" && isPractice && (
                  <div className="space-y-4 pt-2">
                    {/* Preparing for a gig */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
                        <Dumbbell className="w-3 h-3" /> Preparing For
                      </label>
                      <select
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500"
                        value={event.linked_gig_id || ""}
                        onChange={e => onChange("linked_gig_id", e.target.value || null)}
                      >
                        <option value="">No gig linked</option>
                        {upcomingGigs.map(g => (
                          <option key={g.id} value={g.id}>
                            {g.title} · {g.date}{g.event_type ? ` (${g.event_type})` : ""}
                          </option>
                        ))}
                      </select>
                      {upcomingGigs.length === 0 && (
                        <p className="text-xs text-gray-600 mt-1">No upcoming gigs found.</p>
                      )}
                    </div>

                    {/* Goal link */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
                        <Target className="w-3 h-3" /> Linked Goal
                      </label>
                      <select
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500"
                        value={event.practice_goal_id || ""}
                        onChange={e => onChange("practice_goal_id", e.target.value || null)}
                      >
                        <option value="">No goal linked</option>
                        {practiceGoals.map(g => (
                          <option key={g.id} value={g.id}>{g.title}</option>
                        ))}
                      </select>
                    </div>

                    {/* Practice plan / what to work on */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Practice Plan</label>
                      <textarea
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-500 resize-none"
                        placeholder="What will you work on? (scales, repertoire, technique...)"
                        rows={4}
                        value={event.practice_plan || ""}
                        onChange={e => onChange("practice_plan", e.target.value)}
                      />
                    </div>

                    {/* Duration hint */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Planned Duration (hours)</label>
                      <input
                        type="number"
                        min={0.25}
                        max={8}
                        step={0.25}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500"
                        value={event.duration_hours || 1}
                        onChange={e => onChange("duration_hours", parseFloat(e.target.value) || 1)}
                      />
                    </div>

                    {/* Already logged: show quick link */}
                    {alreadyLogged && (
                      <div className="flex items-center gap-2 bg-teal-900/20 border border-teal-700/40 rounded-lg px-3 py-2">
                        <CheckCircle2 className="w-4 h-4 text-teal-400 flex-shrink-0" />
                        <span className="text-xs text-teal-300 flex-1">Session has been logged to your Practice log.</span>
                        <button
                          onClick={() => navigate(createPageUrl("Practice"))}
                          className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1"
                        >
                          View <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {key === "practice" && !isPractice && (
                  <div className="space-y-3 pt-2">
                    {/* Linked practice sessions */}
                    {linkedPracticeSessions.length > 0 ? (
                      <div className="space-y-2">
                        {linkedPracticeSessions.map(p => (
                          <button
                            key={p.id}
                            onClick={() => navigate(createPageUrl("WorkEventDetail?id=" + p.id))}
                            className="w-full flex items-center gap-3 bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2.5 text-left hover:bg-gray-800 transition-colors"
                          >
                            <Dumbbell className="w-4 h-4 text-teal-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white truncate">{p.title || "Practice Session"}</p>
                              <p className="text-xs text-gray-500">{p.date}{p.start_time ? ` · ${p.start_time}` : ""}{p.duration_hours ? ` · ${p.duration_hours}h` : ""}</p>
                            </div>
                            {p.practice_logged && (
                              <CheckCircle2 className="w-4 h-4 text-teal-400 flex-shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600">No practice sessions linked to this event yet.</p>
                    )}

                    {/* Add practice session button */}
                    {id && (
                      <button
                        onClick={() => navigate(createPageUrl(
                          `WorkEventDetail?event_type=Practice&date=${event.date || ""}&linked_gig_id=${id}`
                        ))}
                        className="w-full flex items-center justify-center gap-2 border border-teal-700/50 text-teal-400 hover:bg-teal-900/20 rounded-xl py-2.5 text-sm font-medium transition-colors"
                      >
                        <Dumbbell className="w-4 h-4" />
                        Add Practice Session
                      </button>
                    )}
                  </div>
                )}

                {key === "financials" && (
                  <EventFinancialsSection
                    event={event}
                    onChange={onChange}
                    estimate={estimate}
                    invoice={invoice}
                    onCreateInvoice={handleCreateInvoice}
                    creatingInvoice={creatingInvoice}
                  />
                )}
                {key === "equipment" && <EventEquipmentSection event={event} onChange={onChange} />}
                {key === "navigation" && <EventNavigationSection event={event} />}
                {key === "email" && <EventEmailSection event={event} />}
              </div>
            )}
          </div>
        ))}

        {/* Delete */}
        {id && (
          <div className="pt-2">
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="w-full text-red-500 hover:text-red-400 text-sm flex items-center gap-2 justify-center py-2 transition-colors">
                <Trash2 className="w-4 h-4" /> Delete Event
              </button>
            ) : (
              <div className="bg-red-950/50 border border-red-700/40 rounded-xl p-4">
                <div className="flex items-center gap-2 text-red-300 text-sm font-medium mb-3">
                  <AlertTriangle className="w-4 h-4" /> Delete this event?
                </div>
                <div className="flex gap-2">
                  <button onClick={handleDelete} className="flex-1 bg-red-600 hover:bg-red-500 text-white rounded-lg py-2 text-sm font-medium transition-colors">Delete</button>
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg py-2 text-sm font-medium transition-colors">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
