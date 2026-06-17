import { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { format } from "date-fns";
import { X, Loader2, FileText, CheckSquare, Square } from "lucide-react";
import { currencySymbol, formatMoney, eventsNoun } from "@/utils";

// Picker for turning several of a client's events into ONE invoice.
// Mirrors the AI's CREATE_INVOICE_FROM_EVENTS path (same helper underneath).
export default function InvoiceLessonsModal({ clientId, clientName, onClose, onCreated }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState({}); // id -> bool
  const [layout, setLayout] = useState("per_event");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    appClient.entities.WorkEvent.filter({ client_id: clientId })
      .then((list) => {
        if (!active) return;
        const today = format(new Date(), "yyyy-MM-dd");
        const billable = (list || [])
          .filter((e) => e.status !== "cancelled" && !e.invoice_id)
          // Past + today first (most likely to invoice), newest at top.
          .sort((a, b) => String(b.date).localeCompare(String(a.date)));
        setEvents(billable);
        // Pre-select past/today events by default — the common case.
        const preset = {};
        billable.forEach((e) => { if (e.date && e.date <= today) preset[e.id] = true; });
        setSelected(preset);
        setLoading(false);
      })
      .catch(() => { if (active) { setEvents([]); setLoading(false); } });
    return () => { active = false; };
  }, [clientId]);

  const priceOf = (e) => Number(e.total_price ?? e.base_price) || 0;
  const selectedIds = useMemo(() => events.filter((e) => selected[e.id]).map((e) => e.id), [events, selected]);
  const selectedEvents = useMemo(() => events.filter((e) => selected[e.id]), [events, selected]);
  const total = useMemo(() => selectedEvents.reduce((s, e) => s + priceOf(e), 0), [selectedEvents]);
  const currency = events[0]?.currency || "GBP";
  // Language follows the events themselves — gigs, lessons, sessions, etc.
  const noun = eventsNoun(events);              // plural, e.g. "gigs"
  const nounSingular = eventsNoun(events, 1);   // singular, e.g. "gig"

  const toggle = (id) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  const allSelected = events.length > 0 && selectedIds.length === events.length;
  const toggleAll = () => {
    if (allSelected) setSelected({});
    else setSelected(Object.fromEntries(events.map((e) => [e.id, true])));
  };

  const handleCreate = async () => {
    if (selectedIds.length === 0) return;
    setCreating(true);
    setError("");
    try {
      const { document } = await appClient.helpers.buildInvoiceFromEvents({
        event_ids: selectedIds,
        layout,
      });
      onCreated?.(document);
    } catch (err) {
      setError(err.message || "Couldn't create the invoice.");
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <FileText className="w-5 h-5 text-indigo-400" />
          <div className="flex-1">
            <h2 className="text-white font-semibold text-sm">Invoice {noun}</h2>
            <p className="text-xs text-gray-500">{clientName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="p-8 flex justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No un-invoiced events for this client.</div>
        ) : (
          <>
            {/* Select all */}
            <button onClick={toggleAll} className="flex items-center gap-2 px-4 py-2 text-xs text-gray-400 hover:text-gray-200 border-b border-gray-800 transition-colors">
              {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {allSelected ? "Clear all" : "Select all"}
            </button>

            {/* Event list */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-800/60">
              {events.map((e) => {
                const on = !!selected[e.id];
                return (
                  <button
                    key={e.id}
                    onClick={() => toggle(e.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-800/40 transition-colors"
                  >
                    {on ? <CheckSquare className="w-4 h-4 text-indigo-400 flex-shrink-0" /> : <Square className="w-4 h-4 text-gray-600 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{e.title || e.event_type || "Session"}</p>
                      <p className="text-xs text-gray-500">
                        {e.date ? format(new Date(e.date + "T12:00:00"), "EEE d MMM yyyy") : "No date"}
                      </p>
                    </div>
                    <span className="text-sm text-gray-300">{formatMoney(priceOf(e), currency)}</span>
                  </button>
                );
              })}
            </div>

            {/* Layout toggle */}
            <div className="px-4 pt-3">
              <label className="text-xs text-gray-400 mb-1 block">Invoice layout</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setLayout("per_event")}
                  className={`py-2 rounded-lg text-xs font-medium transition-colors ${layout === "per_event" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                >
                  One line per {nounSingular}
                </button>
                <button
                  onClick={() => setLayout("bundled")}
                  className={`py-2 rounded-lg text-xs font-medium transition-colors ${layout === "bundled" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                >
                  Bundled single line
                </button>
              </div>
            </div>

            {error && <p className="px-4 pt-2 text-xs text-red-400">{error}</p>}

            {/* Footer */}
            <div className="p-4 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs text-gray-500">{selectedIds.length} selected</p>
                <p className="text-base font-bold text-white">{currencySymbol(currency)}{total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <button
                onClick={handleCreate}
                disabled={creating || selectedIds.length === 0}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl px-5 py-2.5 text-sm font-semibold flex items-center gap-2 transition-colors"
              >
                {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : "Create invoice"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
