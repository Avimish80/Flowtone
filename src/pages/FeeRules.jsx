import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronUp, ChevronDown, Trash2, Plus, Check, Sparkles, ArrowRight } from "lucide-react";
import { appClient } from "@/api/appClient";
import { createPageUrl, currencySymbol } from "@/utils";
import {
  CONDITION_TYPES, EVENT_TYPES, newRule, describeCondition, suggestFee,
} from "@/lib/feeRules";
import { gigsMissingFee } from "@/lib/missingInfo";

const inputCls = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-gray-400 placeholder-gray-500";
const STOP_WORDS = new Set(["gig", "the", "with", "and", "for", "option", "provisional", "confirmed", "lesson", "pro"]);

// Most common leading words of gig titles ("Muzika - Manchester" → "muzika"):
// usually the agency/client, so they make good one-tap fee rules.
function commonTitleWords(events, existing) {
  const counts = {};
  for (const e of events) {
    const w = String(e.title || "").toLowerCase().replace(/^confirmed!?\s*/, "").split(/[\s\-—,:@/]+/)[0];
    if (!w || w.length < 3 || STOP_WORDS.has(w) || existing.has(w)) continue;
    counts[w] = (counts[w] || 0) + 1;
  }
  return Object.entries(counts).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6);
}

function RuleEditor({ rule, clients, symbol, onChange, onDone, onDelete }) {
  const set = (patch) => onChange({ ...rule, ...patch });
  const setWhen = (patch) => onChange({ ...rule, when: { ...rule.when, ...patch } });
  const type = rule.when?.type;
  return (
    <div className="p-4 space-y-3 bg-gray-900/40">
      <input className={inputCls} placeholder="Name (e.g. Muzika gigs, Travel)" value={rule.label} onChange={(e) => set({ label: e.target.value })} />
      <select className={inputCls} value={type} onChange={(e) => setWhen({ type: e.target.value, value: "" })}>
        {CONDITION_TYPES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      {type === "keyword" && (
        <input className={inputCls} placeholder="Words, comma separated (e.g. Muzika)" value={rule.when.value} onChange={(e) => setWhen({ value: e.target.value })} />
      )}
      {type === "event_type" && (
        <select className={inputCls} value={rule.when.value} onChange={(e) => setWhen({ value: e.target.value })}>
          <option value="">Choose…</option>
          {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      )}
      {type === "client" && (
        <select className={inputCls} value={rule.when.value} onChange={(e) => setWhen({ value: e.target.value })}>
          <option value="">Choose client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {type === "longer_than" && (
        <input type="number" inputMode="decimal" className={inputCls} placeholder="Hours" value={rule.when.value} onChange={(e) => setWhen({ value: e.target.value })} />
      )}
      <div className="flex items-center gap-2">
        {rule.kind !== "set" && (
          <div className="flex rounded-lg border border-gray-700 overflow-hidden flex-shrink-0">
            {[["add", symbol], ["percent", "%"]].map(([k, l]) => (
              <button key={k} onClick={() => set({ kind: k })}
                className={`px-3 py-2 text-sm ${rule.kind === k ? "bg-gray-700 text-white" : "text-gray-400"}`}>{l}</button>
            ))}
          </div>
        )}
        <input type="number" inputMode="decimal" className={inputCls}
          placeholder={rule.kind === "percent" ? "Percent" : `Amount (${symbol})`}
          value={rule.amount} onChange={(e) => set({ amount: e.target.value })} />
      </div>
      <div className="flex items-center justify-between">
        <button onClick={onDelete} className="text-xs text-red-400 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" />Delete</button>
        <button onClick={onDone} className="text-sm font-medium text-ink flex items-center gap-1"><Check className="w-4 h-4" />Done</button>
      </div>
    </div>
  );
}

export default function FeeRules() {
  const [settings, setSettings] = useState(null);
  const [rules, setRules] = useState([]);
  const [homeArea, setHomeArea] = useState("");
  const [clients, setClients] = useState([]);
  const [events, setEvents] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      const [s, cl, ev, docs] = await Promise.all([
        appClient.helpers.ensureSingletonEntity("AppSettings"),
        appClient.entities.Client.list().catch(() => []),
        appClient.entities.WorkEvent.list().catch(() => []),
        appClient.entities.Document.list().catch(() => []),
      ]);
      setSettings(s);
      setRules(Array.isArray(s?.fee_rules) ? s.fee_rules : []);
      setHomeArea(s?.fee_home_area ?? "London");
      setClients(cl);
      setEvents(ev);
      setDocuments(docs);
    })();
  }, []);

  // Auto-save (debounced) — same no-Save-button behaviour as the rest of the app.
  const persist = (nextRules, nextHome) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (settings?.id) appClient.entities.AppSettings.update(settings.id, { fee_rules: nextRules, fee_home_area: nextHome }).catch(() => {});
    }, 500);
  };
  const updateRules = (next) => { setRules(next); persist(next, homeArea); };
  const updateHome = (v) => { setHomeArea(v); persist(rules, v); };

  const symbol = currencySymbol(settings?.default_currency || "GBP");
  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const missing = useMemo(() => gigsMissingFee(events, documents, Date.now()), [events, documents]);
  const covered = missing.filter((e) => suggestFee(e, { rules, homeArea, clientMap })).length;
  const existingWords = new Set(rules.filter((r) => r.when?.type === "keyword").flatMap((r) => String(r.when.value).toLowerCase().split(",").map((w) => w.trim())));
  const titleWords = commonTitleWords(missing.length ? missing : events, existingWords);

  const addRule = (kind, preset) => {
    const r = { ...newRule(kind), ...preset };
    updateRules([...rules, r]);
    setEditingId(r.id);
  };
  const changeRule = (r) => updateRules(rules.map((x) => (x.id === r.id ? r : x)));
  const deleteRule = (id) => { updateRules(rules.filter((x) => x.id !== id)); setEditingId(null); };
  const move = (id, dir) => {
    const list = rules.filter((r) => r.kind === "set");
    const i = list.findIndex((r) => r.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    updateRules([...list, ...rules.filter((r) => r.kind !== "set")]);
  };

  if (!settings) return <div className="p-4 text-gray-400">Loading...</div>;

  const feeRules = rules.filter((r) => r.kind === "set");
  const extraRules = rules.filter((r) => r.kind !== "set");

  const row = (r, i, list, movable) => (
    <div key={r.id}>
      {editingId === r.id ? (
        <RuleEditor rule={r} clients={clients} symbol={symbol} onChange={changeRule}
          onDone={() => setEditingId(null)} onDelete={() => deleteRule(r.id)} />
      ) : (
        <div className="flex items-center gap-2 px-4 py-3">
          {movable && (
            <div className="flex flex-col -my-1">
              <button onClick={() => move(r.id, -1)} disabled={i === 0} className="text-gray-500 disabled:opacity-20"><ChevronUp className="w-4 h-4" /></button>
              <button onClick={() => move(r.id, 1)} disabled={i === list.length - 1} className="text-gray-500 disabled:opacity-20"><ChevronDown className="w-4 h-4" /></button>
            </div>
          )}
          <button onClick={() => setEditingId(r.id)} className="flex-1 min-w-0 text-left">
            <span className="block text-sm text-white truncate">{r.label || describeCondition(r, clientMap)}</span>
            <span className="block text-[11px] text-gray-500 truncate">{describeCondition(r, clientMap)}</span>
          </button>
          <span className="text-sm font-semibold text-white flex-shrink-0">
            {r.amount === "" ? <span className="text-gray-600">—</span> : r.kind === "percent" ? `+${r.amount}%` : `${r.kind === "add" ? "+" : ""}${symbol}${r.amount}`}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-4 max-w-xl mx-auto space-y-6 pb-28">
      <p className="text-sm text-gray-400">Your rates. Flowtone uses them to suggest the fee for each gig — you always confirm before anything is saved.</p>

      {missing.length > 0 && (
        <Link to={createPageUrl("FeeCatchUp")}
          className="flex items-center justify-between rounded-2xl border border-gray-700/60 bg-gray-700/50 px-4 py-3">
          <span>
            <span className="block text-sm text-white">{missing.length} past gigs need a fee</span>
            <span className="block text-[11px] text-gray-300">{covered} covered by your rates</span>
          </span>
          <ArrowRight className="w-4 h-4 text-gray-300" />
        </Link>
      )}

      <section className="space-y-2">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Fees</h2>
            <p className="text-[11px] text-gray-500">Top to bottom — the first match sets the fee. Otherwise the client's usual fee.</p>
          </div>
          <button onClick={() => addRule("set")} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Add</button>
        </div>
        {feeRules.length > 0 && (
          <div className="rounded-2xl border border-gray-700/60 bg-gray-800/30 divide-y divide-gray-700/60 overflow-hidden">
            {feeRules.map((r, i) => row(r, i, feeRules, true))}
          </div>
        )}
        {titleWords.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-gray-500 flex items-center gap-1"><Sparkles className="w-3 h-3 text-gray-400" />Common in your gig titles — tap to set a fee:</p>
            <div className="flex flex-wrap gap-2">
              {titleWords.map(([w, n]) => (
                <button key={w} onClick={() => addRule("set", { label: w[0].toUpperCase() + w.slice(1), when: { type: "keyword", value: w } })}
                  className="text-xs px-3 py-1.5 rounded-full border border-gray-700 bg-gray-800/60 text-gray-300">
                  {w[0].toUpperCase() + w.slice(1)} <span className="text-gray-500">{n}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Extras</h2>
            <p className="text-[11px] text-gray-500">Added on top when they match — travel, weekends, long gigs.</p>
          </div>
          <button onClick={() => addRule("add")} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Add</button>
        </div>
        {extraRules.length > 0 && (
          <div className="rounded-2xl border border-gray-700/60 bg-gray-800/30 divide-y divide-gray-700/60 overflow-hidden">
            {extraRules.map((r, i) => row(r, i, extraRules, false))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">My area</h2>
        <input className={inputCls} value={homeArea} onChange={(e) => updateHome(e.target.value)} placeholder="e.g. London" />
        <p className="text-[11px] text-gray-500">Words that mean a venue is local, comma separated. A gig whose address mentions none of them counts as outside your area. Place names in titles (Manchester, Italy…) work best as "Title or place mentions" extras.</p>
      </section>
    </div>
  );
}
