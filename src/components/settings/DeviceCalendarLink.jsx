import { useState, useEffect, useMemo } from "react";
import { format, subMonths, subYears, parseISO } from "date-fns";
import { X, Check, Loader2, Sparkles, CalendarDays, Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Toggle } from "@/components/NotificationPrefsEditor";
import { createPageUrl } from "@/utils";
import { listDeviceCalendars, listDeviceEvents } from "@/lib/nativeDevice";
import {
  getCalendarLink, buildImportPlan, classifyWithAI, applyImportPlan, saveLinkAfterImport,
} from "@/lib/deviceCalendarSync";

const today = () => format(new Date(), "yyyy-MM-dd");
const RANGES = [
  { key: "today", label: "From today", from: () => today() },
  { key: "3m", label: "3 months back", from: () => format(subMonths(new Date(), 3), "yyyy-MM-dd") },
  { key: "6m", label: "6 months back", from: () => format(subMonths(new Date(), 6), "yyyy-MM-dd") },
  { key: "1y", label: "1 year back", from: () => format(subYears(new Date(), 1), "yyyy-MM-dd") },
  { key: "custom", label: "Custom date", from: null },
];

// Full-screen flow: pick calendars → pick how far back → review → import.
export default function DeviceCalendarLink({ onClose }) {
  const navigate = useNavigate();
  const existing = getCalendarLink();
  const [step, setStep] = useState("calendars");
  const [calendars, setCalendars] = useState(null);
  const [selectedCals, setSelectedCals] = useState(new Set(existing?.calendarIds || []));
  const [rangeKey, setRangeKey] = useState("1y");
  const [customFrom, setCustomFrom] = useState(format(subYears(new Date(), 1), "yyyy-MM-dd"));
  const [aiCheck, setAiCheck] = useState(!!existing?.aiCheck);
  const [rows, setRows] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const [calCounts, setCalCounts] = useState({});

  useEffect(() => {
    listDeviceCalendars().then(setCalendars).catch((e) => setError(e?.message || "Could not read calendars"));
    // Events per calendar over the last 12 months, so the work calendar is obvious.
    listDeviceEvents(subYears(new Date(), 1), new Date())
      .then((events) => {
        const counts = {};
        for (const e of events) counts[e.calendar_id] = (counts[e.calendar_id] || 0) + 1;
        setCalCounts(counts);
      })
      .catch(() => {});
  }, []);

  const fromDate = rangeKey === "custom" ? customFrom : RANGES.find((r) => r.key === rangeKey).from();

  const findEvents = async () => {
    setError("");
    setStep("review");
    try {
      setBusy("Reading your calendar…");
      let plan = await buildImportPlan({ calendarIds: [...selectedCals], fromDate });
      if (aiCheck && plan.some((r) => r.action === "new")) {
        setBusy("Checking which ones are work…");
        try { plan = await classifyWithAI(plan); } catch { setError("AI check unavailable — showing everything. Untick anything personal."); }
      }
      setRows(plan);
      setPicked(new Set(plan.filter((r) => r.action === "new" && r.ai_work !== false).map((r) => r.key)));
    } catch (e) {
      setError(e?.message || "Could not read events");
    } finally {
      setBusy("");
    }
  };

  const doImport = async () => {
    setBusy("Importing…");
    setError("");
    try {
      const toApply = rows.filter((r) => (r.action === "new" && picked.has(r.key)) || r.action === "update" || r.action === "link");
      const counts = await applyImportPlan(toApply);
      saveLinkAfterImport({ calendarIds: [...selectedCals], fromDate, aiCheck, reviewedKeys: rows.map((r) => r.key) });
      const pastNew = toApply.filter((r) => r.action === "new" && r.device.date < today()).length;
      setResult({ ...counts, pastNew });
      setStep("done");
    } catch (e) {
      setError(e?.message || "Import failed");
    } finally {
      setBusy("");
    }
  };

  const newRows = rows.filter((r) => r.action === "new");
  const knownCount = rows.length - newRows.length;
  const byMonth = useMemo(() => {
    const groups = [];
    for (const r of newRows) {
      const label = format(parseISO(r.device.date), "MMMM yyyy");
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, rows: [] });
      groups[groups.length - 1].rows.push(r);
    }
    return groups;
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Asked for history but the phone returned none older than ~5 weeks: the
  // iOS Calendar "Sync" setting is probably limiting what is stored.
  const oldestDate = rows.length ? rows.reduce((m, r) => (r.device.date < m ? r.device.date : m), "9999") : null;
  const wantedHistory = fromDate < format(subMonths(new Date(), 2), "yyyy-MM-dd");
  const historyMissing = step === "review" && !busy && wantedHistory &&
    (!oldestDate || oldestDate > format(subMonths(new Date(), 1.2), "yyyy-MM-dd"));

  const toggle = (set, key) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <p className="text-base font-semibold text-white">Link iPhone calendar</p>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-white" aria-label="Close"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 max-w-xl w-full mx-auto">
        {step === "calendars" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">Which calendars hold your work? Events from these become gigs in Flowtone and keep syncing.</p>
            {!calendars && !error && <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />}
            <div className="rounded-2xl border border-gray-700/60 bg-gray-800/30 divide-y divide-gray-700/60">
              {(calendars || []).slice().sort((a, b) => (calCounts[b.id] || 0) - (calCounts[a.id] || 0)).map((c) => (
                <button key={c.id} onClick={() => setSelectedCals(toggle(selectedCals, c.id))}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.color || "#6366f1" }} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-white truncate">{c.title}</span>
                    <span className="block text-[11px] text-gray-500 truncate">
                      {[c.account, calCounts[c.id] != null ? `${calCounts[c.id]} events in the last year` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`w-5 h-5 rounded-md border flex items-center justify-center ${selectedCals.has(c.id) ? "bg-indigo-600 border-indigo-500" : "border-gray-600"}`}>
                    {selectedCals.has(c.id) && <Check className="w-3.5 h-3.5 text-white" />}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "range" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm text-gray-400">Import from when? Going back lets you catch up on unpaid or un-invoiced gigs.</p>
              <div className="rounded-2xl border border-gray-700/60 bg-gray-800/30 divide-y divide-gray-700/60">
                {RANGES.map((r) => (
                  <button key={r.key} onClick={() => setRangeKey(r.key)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                    <span className="text-sm text-white">{r.label}</span>
                    {rangeKey === r.key && <Check className="w-4 h-4 text-indigo-400" />}
                  </button>
                ))}
              </div>
              {rangeKey === "custom" && (
                <input type="date" value={customFrom} max={today()} onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm" />
              )}
            </div>
            <div className="flex items-start justify-between gap-3 rounded-2xl border border-gray-700/60 bg-gray-800/30 p-4">
              <div>
                <p className="text-sm text-white flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-indigo-400" />Let AI spot personal events</p>
                <p className="text-[11px] text-gray-500 mt-0.5">For calendars that mix work and personal life. Personal entries start unticked.</p>
              </div>
              <Toggle on={aiCheck} onClick={() => setAiCheck(!aiCheck)} />
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            {busy && <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{busy}</p>}
            {!busy && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-300">
                    {newRows.length} new{knownCount ? ` · ${knownCount} already in Flowtone` : ""}
                  </p>
                  {newRows.length > 0 && (
                    <button onClick={() => setPicked(picked.size === newRows.length ? new Set() : new Set(newRows.map((r) => r.key)))}
                      className="text-gray-500 hover:text-gray-300 text-xs">
                      {picked.size === newRows.length ? "Select none" : "Select all"}
                    </button>
                  )}
                </div>
                {historyMissing && (
                  <div className="flex gap-2 rounded-xl border border-amber-700/40 bg-amber-950/30 p-3">
                    <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-100">Your iPhone may only keep recent events. Open iOS Settings → Apps → Calendar → Sync, choose All Events, wait a minute, then try again.</p>
                  </div>
                )}
                {byMonth.map((g) => (
                  <div key={g.label}>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">{g.label}</p>
                    <div className="rounded-2xl border border-gray-700/60 bg-gray-800/30 divide-y divide-gray-700/60">
                      {g.rows.map((r) => (
                        <button key={r.key} onClick={() => setPicked(toggle(picked, r.key))} className="w-full flex items-center gap-3 px-4 py-2.5 text-left">
                          <span className={`w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center ${picked.has(r.key) ? "bg-indigo-600 border-indigo-500" : "border-gray-600"}`}>
                            {picked.has(r.key) && <Check className="w-3.5 h-3.5 text-white" />}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm text-white truncate">{r.device.title || "(untitled)"}</span>
                            <span className="block text-[11px] text-gray-500 truncate">
                              {format(parseISO(r.device.date), "EEE d MMM")}{r.device.start_time ? ` · ${r.device.start_time}` : ""}{r.device.location ? ` · ${r.device.location}` : ""}
                            </span>
                          </span>
                          {r.ai_work === false
                            ? <span className="text-[10px] px-2 py-0.5 rounded-full border bg-gray-800 border-gray-700 text-gray-500">Personal?</span>
                            : <span className="text-[10px] px-2 py-0.5 rounded-full border bg-gray-800/60 border-gray-700/40 text-gray-400">{r.event_type}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {!newRows.length && !historyMissing && (
                  <p className="text-sm text-gray-500">Nothing new to import — everything in these calendars is already in Flowtone.</p>
                )}
              </>
            )}
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4 pt-6 text-center">
            <CalendarDays className="w-10 h-10 text-indigo-400 mx-auto" />
            <p className="text-base font-semibold text-white">Calendar linked</p>
            <p className="text-sm text-gray-400">
              {result.created} imported{result.linked ? ` · ${result.linked} matched to existing gigs` : ""}{result.updated ? ` · ${result.updated} updated` : ""}.
            </p>
            {result.pastNew > 0 && (
              <p className="text-sm text-gray-400">{result.pastNew} past gigs need a fee — they're waiting in Missions so you can catch up on invoices.</p>
            )}
            <p className="text-xs text-gray-500">New events in these calendars come in automatically whenever you open Flowtone.</p>
          </div>
        )}

        {error && <p className="text-xs text-red-400 mt-4">{error}</p>}
      </div>

      <div className="p-4 border-t border-gray-800 max-w-xl w-full mx-auto">
        {step === "calendars" && (
          <button disabled={!selectedCals.size} onClick={() => setStep("range")}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-40">
            Next{selectedCals.size ? ` · ${selectedCals.size} calendar${selectedCals.size > 1 ? "s" : ""}` : ""}
          </button>
        )}
        {step === "range" && (
          <button onClick={findEvents} className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">
            Find events
          </button>
        )}
        {step === "review" && !busy && (
          <button onClick={doImport}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">
            {picked.size ? `Import ${picked.size} event${picked.size > 1 ? "s" : ""}` : "Link calendar"}
          </button>
        )}
        {step === "review" && busy === "Importing…" && (
          <p className="text-center text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Importing…</p>
        )}
        {step === "done" && (
          <div className="space-y-2">
            {result?.pastNew > 0 && (
              <button onClick={() => { onClose(); navigate(createPageUrl("FeeCatchUp")); }}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">Fill in fees</button>
            )}
            <button onClick={onClose}
              className={`w-full py-3 rounded-xl text-sm font-semibold ${result?.pastNew > 0 ? "text-gray-400" : "bg-indigo-600 hover:bg-indigo-500 text-white"}`}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
