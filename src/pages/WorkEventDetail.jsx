import { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useGoBack } from "@/hooks/useGoBack";
import { format } from "date-fns";
import {
  ArrowLeft, Save, Trash2, DollarSign,
  Package, Mail, Navigation, ChevronDown, ChevronUp, AlertTriangle, FileText, CalendarDays, RefreshCw,
  Dumbbell, Check, X, CheckCircle2, Target, ExternalLink, Loader2, CalendarPlus
} from "lucide-react";
import { eventsToIcal, downloadIcal } from "@/lib/icalExport";
import EventInfoSection from "../components/workevent/EventInfoSection";
import EventFinancialsSection from "../components/workevent/EventFinancialsSection";
import EventEquipmentSection from "../components/workevent/EventEquipmentSection";
import EventNavigationSection from "../components/workevent/EventNavigationSection";
import EventEmailSection from "../components/workevent/EventEmailSection";
import EventLinkedDocsSection from "../components/workevent/EventLinkedDocsSection";

const SECTIONS = [
  { key: "info",       label: "Info",       icon: CalendarDays },
  { key: "practice",   label: "Practice",   icon: Dumbbell },
  { key: "financials", label: "Financials", icon: DollarSign, hideForPractice: true },
  { key: "docs",       label: "Docs",       icon: FileText,   hideForPractice: true },
  { key: "equipment",  label: "Equipment",  icon: Package },
  { key: "navigation", label: "Navigate",   icon: Navigation },
  { key: "email",      label: "Email",      icon: Mail },
];

const TODAY = format(new Date(), "yyyy-MM-dd");

export default function WorkEventDetail() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
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
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [openSection, setOpenSection] = useState(prefilledType === "Practice" ? "practice" : "info");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Practice-specific state
  const [practiceGoals, setPracticeGoals] = useState([]);
  const [upcomingGigs, setUpcomingGigs] = useState([]);
  const [linkedPracticeSessions, setLinkedPracticeSessions] = useState([]);
  const [loggingPractice, setLoggingPractice] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const isPractice = event.event_type === "Practice";

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
        if (e.status === "confirmed" || e.status === "completed") e.base_price_locked = true;
        setEvent(e);

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

  // Load practice data — goals + upcoming gigs for practice events,
  // linked practice sessions for non-practice events
  useEffect(() => {
    if (isPractice) {
      const todayStr = TODAY;
      Promise.all([
        appClient.entities.PracticeGoal.list(),
        appClient.entities.WorkEvent.list("date", 500),
      ]).then(([goals, events]) => {
        setPracticeGoals(goals.filter(g => !g.completed));
        setUpcomingGigs(
          events
            .filter(e => e.event_type !== "Practice" && e.date >= todayStr && e.id !== id)
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(0, 40)
        );
      });
    } else if (id) {
      // For gigs/lessons: load any practice events that are linked to this event
      appClient.entities.WorkEvent.list("-date", 500).then(events => {
        setLinkedPracticeSessions(
          events.filter(e => e.event_type === "Practice" && e.linked_gig_id === id)
        );
      });
    }
  }, [isPractice, id]);

  const onChange = (field, value) => {
    setEvent(prev => {
      const updated = { ...prev, [field]: value };
      if (field === "status" && (value === "confirmed" || value === "completed")) {
        updated.base_price_locked = true;
      }
      return updated;
    });
    // Auto-open the practice accordion when user picks Practice type
    if (field === "event_type" && value === "Practice") {
      setOpenSection("practice");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (id) {
        await appClient.entities.WorkEvent.update(id, event);

        // If event is now confirmed and has an estimate but no invoice, convert estimate to invoice
        if ((event.status === "confirmed" || event.status === "completed") && estimate && !invoice) {
          const newInvoice = await appClient.helpers.convertEstimateToInvoice(estimate.id);
          await appClient.entities.Document.update(newInvoice.id, { work_event_id: id });
          setInvoice(newInvoice);
        }

        // Flash "Saved ✓" briefly for existing events
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2000);
      } else {
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
      }
    } catch (err) {
      console.error("Save error:", err);
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

  const handleCreateInvoiceFromEstimate = async () => {
    if (!estimate) return;
    setCreatingInvoice(true);
    try {
      const newInvoice = await appClient.helpers.convertEstimateToInvoice(estimate.id);
      await appClient.entities.Document.update(newInvoice.id, { work_event_id: id });
      setInvoice(newInvoice);
      // Refresh estimate to see "converted" status
      const docs = await appClient.entities.Document.filter({ id: estimate.id });
      if (docs[0]) setEstimate(docs[0]);
    } catch (err) {
      console.error("Convert error:", err);
    }
    setCreatingInvoice(false);
  };

  const handleDelete = async () => {
    await appClient.entities.WorkEvent.delete(id);
    navigate(createPageUrl("WorkEvents"));
  };

  const toggleSection = (key) => setOpenSection(openSection === key ? null : key);

  // Is this a past or today's practice event that hasn't been logged yet?
  const showCheckin = isPractice && id && event.date && event.date <= TODAY && !event.practice_logged && !event.practice_skipped;
  const alreadyLogged = isPractice && event.practice_logged;
  const wasSkipped = isPractice && event.practice_skipped && !event.practice_logged;

  if (loading) return <div className="p-4 text-gray-400">Loading...</div>;

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 sticky top-0 z-20 border-b border-gray-800">
        <button onClick={goBack} className="text-gray-400 hover:text-white transition-colors flex-shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-white truncate">{event.title || "New Event"}</h1>
            {event.is_recurring && (
              <span className="flex-shrink-0 flex items-center gap-1 text-xs bg-indigo-900/60 text-indigo-300 border border-indigo-700/40 px-2 py-0.5 rounded-full">
                <RefreshCw className="w-3 h-3" /> Recurring
              </span>
            )}
            {isPractice && alreadyLogged && (
              <span className="flex-shrink-0 flex items-center gap-1 text-xs bg-teal-900/60 text-teal-300 border border-teal-700/40 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" /> Logged
              </span>
            )}
          </div>
          {event.event_type && (
            <p className="text-xs text-gray-500 truncate">
              {event.event_type}
              {event.status ? ` · ${{ lead: "Tentative", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" }[event.status] || event.status}` : ""}
            </p>
          )}
          {event.start_time && (
            <p className="text-xs text-gray-500">
              {event.start_time}{event.end_time ? `–${event.end_time}` : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {id && event.date && (
            <button
              onClick={() => {
                const ics = eventsToIcal([event]);
                downloadIcal(`${(event.title || "event").replace(/[^a-z0-9]/gi, "-").toLowerCase()}.ics`, ics);
              }}
              title="Add to iPhone Calendar"
              className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-300 hover:bg-gray-800 transition-colors"
            >
              <CalendarPlus className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all ${
              savedFlash
                ? "bg-green-600 text-white"
                : "bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
            }`}
          >
            {savedFlash
              ? <><CheckCircle2 className="w-4 h-4" /> Saved</>
              : <><Save className="w-4 h-4" /> {saving ? "Saving..." : "Save"}</>
            }
          </button>
        </div>
      </div>

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
          <div key={key} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
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

                {key === "financials" && <EventFinancialsSection event={event} onChange={onChange} />}
                {key === "docs" && (
                  <EventLinkedDocsSection
                    event={event}
                    estimate={estimate}
                    invoice={invoice}
                    onCreateInvoiceFromEstimate={handleCreateInvoiceFromEstimate}
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
