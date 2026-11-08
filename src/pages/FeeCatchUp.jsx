import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { Check, Loader2, SlidersHorizontal } from "lucide-react";
import { appClient } from "@/api/appClient";
import { createPageUrl, currencySymbol } from "@/utils";
import { suggestFee, feeFields } from "@/lib/feeRules";
import { gigsMissingFee } from "@/lib/missingInfo";

// Catch-up screen for past gigs with no fee: each row shows the fee your rates
// suggest (with its breakdown); confirm it, type another amount, or mark the
// gig as one that never happened.
export default function FeeCatchUp() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [settings, setSettings] = useState(null);
  const [amounts, setAmounts] = useState({});
  const [done, setDone] = useState({}); // id → "saved" | "cancelled"
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    (async () => {
      const [ev, docs, cl, s] = await Promise.all([
        appClient.entities.WorkEvent.list("-date"),
        appClient.entities.Document.list().catch(() => []),
        appClient.entities.Client.list().catch(() => []),
        appClient.helpers.ensureSingletonEntity("AppSettings"),
      ]);
      setEvents(ev);
      setDocuments(docs);
      setClients(cl);
      setSettings(s);
      setLoading(false);
    })();
  }, []);

  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const opts = { rules: settings?.fee_rules || [], homeArea: settings?.fee_home_area ?? "London", clientMap };
  const rows = useMemo(
    () => gigsMissingFee(events, documents, Date.now())
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .map((e) => ({ event: e, suggestion: suggestFee(e, opts) })),
    [events, documents, settings, clientMap] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const pending = rows.filter((r) => !done[r.event.id]);
  const shown = filter === "suggested" ? pending.filter((r) => r.suggestion) : pending;
  const withSuggestion = pending.filter((r) => r.suggestion);
  const symbol = currencySymbol(settings?.default_currency || "GBP");

  const save = async ({ event, suggestion }) => {
    const typed = amounts[event.id];
    let fields;
    if (typed !== undefined && typed !== "" && Number(typed) !== suggestion?.total) {
      const n = Number(typed);
      if (!(n > 0)) return;
      fields = { base_price: n, adjustments: [], total_price: n };
    } else if (suggestion) {
      fields = feeFields(suggestion);
    } else {
      return;
    }
    await appClient.entities.WorkEvent.update(event.id, fields);
    setDone((d) => ({ ...d, [event.id]: "saved" }));
  };

  const didntHappen = async (event) => {
    await appClient.entities.WorkEvent.update(event.id, { status: "cancelled" });
    setDone((d) => ({ ...d, [event.id]: "cancelled" }));
  };

  const applyAll = async () => {
    setBusy(`Saving ${withSuggestion.length} fees…`);
    for (const r of withSuggestion) {
      if (amounts[r.event.id] !== undefined) continue; // user is editing this one
      await appClient.entities.WorkEvent.update(r.event.id, feeFields(r.suggestion));
      setDone((d) => ({ ...d, [r.event.id]: "saved" }));
    }
    setBusy("");
  };

  if (loading) return <div className="p-4 text-gray-400">Loading...</div>;

  const savedCount = Object.values(done).filter((v) => v === "saved").length;
  const cancelledCount = Object.values(done).filter((v) => v === "cancelled").length;

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4 pb-28">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-white">{pending.length} past gigs need a fee</p>
          <p className="text-xs text-gray-500">
            {withSuggestion.length} suggested from your rates
            {savedCount ? ` · ${savedCount} saved` : ""}{cancelledCount ? ` · ${cancelledCount} marked didn't happen` : ""}
          </p>
        </div>
        <Link to={createPageUrl("FeeRules")} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 flex-shrink-0">
          <SlidersHorizontal className="w-3.5 h-3.5" />My rates
        </Link>
      </div>

      {withSuggestion.length > 0 && (
        <button onClick={applyAll} disabled={!!busy}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50">
          {busy || `Accept all ${withSuggestion.length} suggestions`}
        </button>
      )}
      {!withSuggestion.length && pending.length > 0 && (
        <Link to={createPageUrl("FeeRules")} className="block rounded-xl border border-gray-700/60 bg-gray-800/30 p-3 text-xs text-gray-400">
          Set up your rates first and Flowtone will suggest a fee for each of these. Or type amounts below.
        </Link>
      )}

      <div className="flex gap-3 text-xs">
        {[["all", "All"], ["suggested", "With suggestion"]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={filter === k ? "text-indigo-400" : "text-gray-500"}>{l}</button>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-700/60 bg-gray-800/30 divide-y divide-gray-700/60 overflow-hidden">
        {shown.map(({ event, suggestion }) => (
          <div key={event.id} className="px-4 py-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <Link to={createPageUrl("WorkEventDetail?id=" + event.id)} className="min-w-0">
                <span className="block text-sm text-white truncate">{event.title || "(untitled)"}</span>
                <span className="block text-[11px] text-gray-500 truncate">
                  {event.date ? format(parseISO(event.date), "EEE d MMM yyyy") : ""}
                  {event.location_address ? ` · ${event.location_address.split("\n")[0]}` : ""}
                </span>
              </Link>
              <button onClick={() => didntHappen(event)} className="text-[11px] text-gray-500 hover:text-gray-300 flex-shrink-0">Didn't happen</button>
            </div>
            {suggestion && (
              <p className="text-[11px] text-indigo-300">
                {symbol}{suggestion.base} {suggestion.baseLabel}
                {suggestion.extras.map((x) => ` + ${symbol}${x.amount} ${x.label}`).join("")}
              </p>
            )}
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center bg-gray-900 border border-gray-700 rounded-lg px-3">
                <span className="text-sm text-gray-500">{symbol}</span>
                <input type="number" inputMode="decimal"
                  className="flex-1 bg-transparent py-2 pl-1 text-white text-sm focus:outline-none placeholder-gray-600"
                  placeholder={suggestion ? String(suggestion.total) : "Fee"}
                  value={amounts[event.id] ?? ""}
                  onChange={(e) => setAmounts((a) => ({ ...a, [event.id]: e.target.value }))} />
              </div>
              <button onClick={() => save({ event, suggestion })}
                disabled={!suggestion && !(Number(amounts[event.id]) > 0)}
                className="h-9 w-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 flex items-center justify-center flex-shrink-0"
                aria-label="Save fee">
                <Check className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        ))}
        {!shown.length && (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">
            {pending.length ? "No gigs match this filter." : "All caught up — every past gig has a fee."}
          </p>
        )}
      </div>
      {busy && <p className="text-xs text-gray-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />{busy}</p>}
    </div>
  );
}
