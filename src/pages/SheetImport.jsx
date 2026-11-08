import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Check, ChevronDown, FileSpreadsheet, Loader2, RotateCcw, Upload } from "lucide-react";
import { appClient } from "@/api/appClient";
import { createPageUrl } from "@/utils";
import { readSpreadsheet } from "@/lib/sheetImport/parse";
import { FIELDS, guessMapping, toRecord } from "@/lib/sheetImport/columns";
import { matchRows } from "@/lib/sheetImport/match";
import { dateOrder } from "@/lib/sheetImport/values";
import { readRow, makeContext, planRow, flagRepeat, groupInvoices, invoiceAnchors, dropSharedInvoiceFees } from "@/lib/sheetImport/plan";
import { applyImport, undoImport, getLastImport, importInProgress } from "@/lib/sheetImport/apply";

// "Update gigs from a spreadsheet": pick a file, confirm which column is
// which, review every change gig by gig, then apply (and undo if needed).

const card = "rounded-2xl border border-gray-700/60 bg-gray-800/30";
const primary = "w-full py-3 rounded-xl bg-ink hover:bg-ink/90 text-ink-fg text-sm font-semibold disabled:opacity-40";
const quiet = "text-gray-500 hover:text-gray-300 text-xs transition-colors";

const niceDate = (d) => { try { return format(parseISO(d), "EEE d MMM yyyy"); } catch { return d || ""; } };

const TABS = [
  ["check", "Check"],
  ["change", "To change"],
  ["new", "New gigs"],
  ["optional", "Optional"],
  ["same", "No change"],
  ["skip", "Skipped"],
];

function categoryOf(plan, match) {
  if (plan.kind === "skip") return "skip";
  if (match?.eventId && !match.sure) return "check";
  if (plan.kind === "new") return "new";
  if (plan.kind === "same") return "same";
  return plan.changes.some((c) => c.checked && !c.info) ? "change" : "optional";
}

function Tick({ on, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      className={`h-5 w-5 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${on ? "bg-ink border-ink/60 text-ink-fg" : "border-gray-600 bg-gray-900"} disabled:opacity-30`}>
      {on && <Check className="w-3.5 h-3.5 text-ink-fg" />}
    </button>
  );
}

export default function SheetImport() {
  const [step, setStep] = useState("file"); // file | columns | review | applying | done
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState({});
  const [rows, setRows] = useState([]);
  const [matches, setMatches] = useState([]);
  const [basePlans, setBasePlans] = useState([]);
  const [ticks, setTicks] = useState({}); // "row:changeKey" → the user's own tick
  const [ctx, setCtx] = useState(null);
  const [tab, setTab] = useState("change");
  const [picking, setPicking] = useState(null); // row index whose gig is being changed
  const [progress, setProgress] = useState([0, 0]);
  const [result, setResult] = useState(null);
  const [lastImport, setLastImport] = useState(() => getLastImport());
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(() => !!importInProgress());

  // An import keeps saving if the user leaves this screen; while it does, no
  // second import or undo is offered.
  useEffect(() => {
    if (!saving) return undefined;
    const t = setInterval(() => {
      if (!importInProgress()) { setSaving(false); setLastImport(getLastImport()); }
    }, 1000);
    return () => clearInterval(t);
  }, [saving]);

  const sheet = sheets[sheetIdx];

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    setBusy("Reading the file…");
    try {
      const { sheets: found } = await readSpreadsheet(file);
      if (!found.length) throw new Error("No rows found in this file.");
      setFileName(file.name);
      setSheets(found);
      setSheetIdx(0);
      setMapping(guessMapping(found[0].headers, found[0].rows));
      setStep("columns");
    } catch (err) {
      setError(err?.message?.includes("Unsupported") ? "This file type can't be read. Save it as .xlsx or .csv and try again." : err?.message || "Couldn't read this file.");
    }
    setBusy("");
  };

  const pickSheet = (i) => {
    setSheetIdx(i);
    setMapping(guessMapping(sheets[i].headers, sheets[i].rows));
  };

  const review = async () => {
    setError("");
    setBusy(`Matching ${sheet.rows.length} rows to your gigs…`);
    try {
      const [events, clients, documents, settings] = await Promise.all([
        appClient.entities.WorkEvent.list(),
        appClient.entities.Client.list(),
        appClient.entities.Document.list(),
        appClient.helpers.ensureSingletonEntity("AppSettings"),
      ]);
      // One reading of d/m vs m/d for the whole file, from all its date columns.
      const order = dateOrder(["date", "paid_date", "due_date"].flatMap((k) => (mapping[k] ? sheet.rows.map((r) => r[mapping[k]]) : [])));
      const read = dropSharedInvoiceFees(sheet.rows.map((r, i) => readRow(toRecord(r, mapping), {
        feeInNameMapped: !!mapping.fee_in_name, order, index: i, line: sheet.lines?.[i],
      })));
      const c = makeContext({
        events, clients, documents, settings, fileName, today: format(new Date(), "yyyy-MM-dd"),
        sheetClients: read.map((r) => r.client),
      });
      const m = matchRows(read, events, c.clientsById, invoiceAnchors(read, c));
      const p = read.map((r, i) => flagRepeat(read, i, planRow(r, m[i].eventId ? c.eventsById[m[i].eventId] : null, c)));
      setRows(read);
      setMatches(m);
      setBasePlans(p);
      setTicks({});
      setCtx(c);
      const grouped = groupInvoices(read, p, c);
      const cats = grouped.map((x, i) => categoryOf(x, m[i]));
      setTab(cats.includes("check") ? "check" : cats.includes("change") ? "change" : cats.includes("new") ? "new" : "same");
      setStep("review");
    } catch (err) {
      setError(err?.message || "Couldn't load your gigs.");
    }
    setBusy("");
  };

  // What the user sees: rows sharing an invoice number grouped into one
  // invoice, with the user's own ticks over the defaults.
  const plans = useMemo(() => {
    if (!ctx) return [];
    return groupInvoices(rows, basePlans, ctx).map((p, i) => ({
      ...p,
      changes: p.changes.map((c) => (`${i}:${c.key}` in ticks ? { ...c, checked: ticks[`${i}:${c.key}`] } : c)),
    }));
  }, [rows, basePlans, ctx, ticks]);

  const toggle = (i, key) => {
    const current = plans[i]?.changes.find((c) => c.key === key);
    if (current) setTicks((t) => ({ ...t, [`${i}:${key}`]: !current.checked }));
  };

  // Point row i at another gig (eventId), a new gig (null) or nothing ("skip").
  const repoint = (i, target) => {
    const nextMatches = matches.map((m) => ({ ...m }));
    const nextPlans = [...basePlans];
    const touched = new Set([i]);
    const replan = (k) => {
      const id = nextMatches[k].eventId;
      nextPlans[k] = flagRepeat(rows, k, planRow(rows[k], id ? ctx.eventsById[id] : null, ctx));
      touched.add(k);
    };
    if (target && target !== "skip") {
      const other = nextMatches.findIndex((m, k) => k !== i && m.eventId === target);
      if (other >= 0) { nextMatches[other].eventId = null; nextMatches[other].sure = false; replan(other); }
    }
    nextMatches[i].eventId = target === "skip" ? null : target;
    nextMatches[i].sure = true; // the user chose it
    if (target === "skip") nextPlans[i] = { kind: "skip", reason: "Skipped by you", changes: [] };
    else replan(i);
    setMatches(nextMatches);
    setBasePlans(nextPlans);
    // Re-planned rows start again from their defaults.
    setTicks((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !touched.has(Number(k.split(":")[0])))));
    setPicking(null);
  };

  const categories = useMemo(() => plans.map((p, i) => categoryOf(p, matches[i])), [plans, matches]);
  const counts = useMemo(() => categories.reduce((acc, c) => ({ ...acc, [c]: (acc[c] || 0) + 1 }), {}), [categories]);
  const ticked = plans.flatMap((p) => p.changes.filter((c) => c.checked && !c.info));
  const touchedRows = plans.filter((p) => p.changes.some((c) => c.checked && !c.info)).length;

  const apply = async () => {
    if (importInProgress()) { setError("An import is still being saved. Wait for it to finish."); return; }
    // Rows with a ticked change, plus every row a ticked invoice covers (its
    // gig must be known even when nothing else on that row changes).
    const on = (p) => p.changes.filter((c) => c.checked && !c.info);
    const needed = new Set(plans.flatMap((p, i) => (on(p).length ? [i, ...on(p).flatMap((c) => c.rowIndexes || [])] : [])));
    const todo = plans
      .map((plan, index) => ({ index, plan, event: matches[index]?.eventId ? ctx.eventsById[matches[index].eventId] : null }))
      .filter((r) => needed.has(r.index));
    setError("");
    setStep("applying");
    setProgress([0, 0]);
    try {
      const res = await applyImport(todo, { fileName, onProgress: (d, n) => setProgress([d, n]) });
      setResult(res);
      setStep("done");
    } catch (err) {
      // Stopped before or between rows (no connection, signed out): what was
      // written so far can still be undone from the first screen.
      setError(`Saving stopped: ${err?.message || err}. Anything already saved can be undone from the first screen.`);
      setStep("review");
    }
    setLastImport(getLastImport());
  };

  const undo = async (batch) => {
    if (importInProgress()) { setError("An import is still being saved. Wait for it to finish."); return; }
    if (!window.confirm(`Undo the import of ${batch.fileName}? What it added or changed goes back to how it was. Anything you've changed since stays as you left it.`)) return;
    setError("");
    setNotice("");
    setBusy("Undoing…");
    setProgress([0, 0]);
    try {
      const { failed, kept } = await undoImport(batch, { onProgress: (d, n) => setProgress([d, n]) });
      if (failed) setError(`${failed} changes couldn't be undone (check your connection). Tap Undo again to retry.`);
      else setNotice(`The import of ${batch.fileName} was undone.${kept ? ` ${kept} items you changed since were left as they are.` : ""}`);
      setResult(null);
      setStep("file");
    } catch (err) {
      setError(`Undo stopped: ${err?.message || err}. Tap Undo again to retry.`);
    }
    setLastImport(getLastImport());
    setBusy("");
  };

  useEffect(() => { window.scrollTo(0, 0); }, [step]);

  // ── Applying / undoing ───────────────────────────────────────────
  if (step === "applying" || busy === "Undoing…") {
    const [d, n] = progress;
    return (
      <div className="p-4 max-w-xl mx-auto space-y-3 pt-16 text-center">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin mx-auto" />
        <p className="text-sm text-white">{busy || "Saving changes…"} {n ? `${d} of ${n}` : ""}</p>
        <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
          <div className="h-full bg-ink transition-all" style={{ width: n ? `${(d / n) * 100}%` : "0%" }} />
        </div>
        <p className="text-[11px] text-gray-600">Keep the app open until this finishes.</p>
      </div>
    );
  }

  // ── File ─────────────────────────────────────────────────────────
  if (step === "file") {
    return (
      <div className="p-4 max-w-xl mx-auto space-y-4 pb-28">
        <div>
          <p className="text-base font-semibold text-white">Update gigs from a spreadsheet</p>
          <p className="text-xs text-gray-500 mt-1">
            Fees, clients, venues, invoices and payments from an Excel or CSV file. Rows are matched to the gigs already
            in Flowtone, and you see every change before anything is saved.
          </p>
        </div>
        <label className={`${card} flex flex-col items-center justify-center gap-2 py-10 cursor-pointer hover:border-gray-500 transition-colors`}>
          {busy ? <Loader2 className="w-6 h-6 text-gray-400 animate-spin" /> : <Upload className="w-6 h-6 text-gray-400" />}
          <span className="text-sm text-white font-medium">{busy || "Choose a file"}</span>
          <span className="text-[11px] text-gray-500">.xlsx · .xls · .csv · .numbers</span>
          <input type="file" className="hidden" disabled={!!busy || saving}
            accept=".xlsx,.xls,.xlsm,.csv,.tsv,.numbers,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={onFile} />
        </label>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {notice && <p className="text-xs text-green-400">{notice}</p>}
        {saving && <p className="text-xs text-amber-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />The last import is still being saved…</p>}
        {lastImport && !saving && (
          <div className={`${card} p-4 space-y-2`}>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">Last import</p>
            <p className="text-sm text-white">{lastImport.fileName}</p>
            <p className="text-xs text-gray-500">
              {format(new Date(lastImport.at), "d MMM yyyy, HH:mm")}
              {lastImport.retry ? " · partly undone" : lastImport.counts ? ` · ${lastImport.counts.updated} gigs updated · ${lastImport.counts.created} added · ${lastImport.counts.invoices} invoices` : " · did not finish"}
            </p>
            <button onClick={() => undo(lastImport)} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
              <RotateCcw className="w-3.5 h-3.5" />Undo this import
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Columns ──────────────────────────────────────────────────────
  if (step === "columns") {
    const sample = (h) => sheet.rows.map((r) => r[h]).filter((v) => v != null && String(v).trim() !== "").slice(0, 2).join(" · ");
    return (
      <div className="p-4 max-w-xl mx-auto space-y-4 pb-28">
        <div>
          <p className="text-base font-semibold text-white flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-gray-400" />{fileName}</p>
          <p className="text-xs text-gray-500 mt-1">{sheet.rows.length} rows. Check what each column holds; leave a field empty if the file doesn't have it.</p>
        </div>
        {sheets.length > 1 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-400">Sheet</span>
            <select value={sheetIdx} onChange={(e) => pickSheet(Number(e.target.value))}
              className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white">
              {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>)}
            </select>
          </div>
        )}
        <div className={`${card} divide-y divide-gray-700/60`}>
          {FIELDS.map((f) => (
            <div key={f.key} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-300">{f.label}{f.required && <span className="text-red-400"> *</span>}</span>
                <select value={mapping[f.key] || ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white max-w-[55%]">
                  <option value="">Not in file</option>
                  {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              {mapping[f.key] && <p className="text-[11px] text-gray-600 truncate mt-1">{sample(mapping[f.key]) || "(empty)"}</p>}
            </div>
          ))}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button onClick={review} disabled={!mapping.date || !!busy} className={primary}>
          {busy || (mapping.date ? "Match to my gigs" : "Choose the date column first")}
        </button>
        <button onClick={() => setStep("file")} className={`${quiet} w-full text-center`}>Choose another file</button>
      </div>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────
  if (step === "done" && result) {
    const c = result.counts;
    const lines = [
      c.updated && `${c.updated} gigs updated`,
      c.created && `${c.created} gigs added`,
      c.invoices && `${c.invoices} invoices created`,
      c.paid && `${c.paid} invoices marked paid or sent`,
      c.clients && `${c.clients} new clients`,
    ].filter(Boolean);
    return (
      <div className="p-4 max-w-xl mx-auto space-y-4 pb-28">
        <div className={`${card} p-4 space-y-2`}>
          <p className="text-base font-semibold text-white flex items-center gap-2"><Check className="w-4 h-4 text-green-400" />Import finished</p>
          {lines.map((l) => <p key={l} className="text-sm text-gray-300">{l}</p>)}
          {!lines.length && !result.errors.length && <p className="text-sm text-gray-400">Nothing needed changing.</p>}
        </div>
        {result.errors.length > 0 && (
          <div className="rounded-2xl border border-red-700/40 bg-red-950/30 p-4 space-y-1">
            <p className="text-sm text-red-300">{result.errors.length} rows could not be saved</p>
            {result.errors.slice(0, 8).map((e) => (
              <p key={`${e.index}-${e.message}`} className="text-[11px] text-red-400/80">Line {rows[e.index]?.line} ({rows[e.index]?.title}): {e.message}</p>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Link to={createPageUrl("WorkEvents")} className="py-2.5 rounded-xl bg-gray-800 text-center text-sm text-gray-200">Events</Link>
          <Link to={createPageUrl("Finance")} className="py-2.5 rounded-xl bg-gray-800 text-center text-sm text-gray-200">Finance</Link>
        </div>
        {(result.batch.created.length > 0 || result.batch.updated.length > 0) && (
          <button onClick={() => undo(result.batch)} className="w-full text-xs text-red-400 hover:text-red-300 flex items-center justify-center gap-1 py-2">
            <RotateCcw className="w-3.5 h-3.5" />Undo this import
          </button>
        )}
      </div>
    );
  }

  // ── Review ───────────────────────────────────────────────────────
  const shown = plans.map((p, i) => i).filter((i) => categories[i] === tab);
  const newCount = plans.filter((p) => p.kind === "new" && p.changes.some((c) => c.key === "create" && c.checked)).length;
  const invoiceCount = ticked.filter((c) => c.key === "invoice").length;

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4 pb-28">
      <div className={`${card} p-4 space-y-3`}>
        <div>
          <p className="text-base font-semibold text-white">{ticked.length ? `${ticked.length} changes to ${touchedRows} gigs` : "Nothing to change"}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {fileName} · {rows.length} rows
            {newCount ? ` · ${newCount} new gigs` : ""}{invoiceCount ? ` · ${invoiceCount} invoices` : ""}
          </p>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button onClick={apply} disabled={!ticked.length} className={primary}>
          {ticked.length ? `Apply ${ticked.length} changes` : "Nothing ticked"}
        </button>
        <p className="text-[11px] text-gray-600">Filling in something blank is ticked; replacing what's already there is not. You can undo the whole import afterwards.</p>
      </div>

      <div className="flex gap-3 overflow-x-auto text-xs -mx-4 px-4 pb-1">
        {TABS.filter(([k]) => counts[k]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`whitespace-nowrap ${tab === k ? "text-ink" : k === "check" ? "text-amber-400" : "text-gray-500"}`}>
            {l} {counts[k]}
          </button>
        ))}
      </div>
      {tab === "check" && <p className="text-[11px] text-amber-400/80">These rows were matched to a gig with a different name or date (or by invoice number). Check each one is the right gig, or change it.</p>}

      <div className="space-y-3">
        {shown.map((i) => {
          const row = rows[i], plan = plans[i], m = matches[i];
          const event = m.eventId ? ctx.eventsById[m.eventId] : null;
          return (
            <div key={i} className={`${card} p-3 space-y-2`}>
              <div className="min-w-0">
                <p className="text-[10px] text-gray-600">Line {row.line} · {niceDate(row.date)}{m.byInvoice ? " · matched by invoice number" : ""}</p>
                <p className="text-sm text-white break-words">{row.title || "(no name)"}</p>
              </div>

              {plan.kind !== "skip" || m.nearby.length ? (
                <button onClick={() => setPicking(picking === i ? null : i)} className="w-full text-left flex items-center justify-between gap-2 rounded-lg bg-gray-900/60 px-2.5 py-1.5">
                  <span className="min-w-0 text-xs">
                    {event ? (
                      <>
                        <span className="text-gray-500">Your gig: </span>
                        <span className="text-gray-200">{event.title}</span>
                        {event.date !== row.date && <span className="text-amber-400"> · {niceDate(event.date)}</span>}
                      </>
                    ) : plan.kind === "skip" ? <span className="text-gray-500">{plan.reason}</span> : <span className="text-gray-400">Not in Flowtone yet</span>}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-gray-500 flex-shrink-0 transition-transform ${picking === i ? "rotate-180" : ""}`} />
                </button>
              ) : <p className="text-xs text-gray-500">{plan.reason}</p>}

              {picking === i && (
                <div className="rounded-lg border border-gray-700/60 divide-y divide-gray-700/40 text-xs">
                  {m.nearby.map((id) => {
                    const e = ctx.eventsById[id];
                    const takenBy = matches.findIndex((x, k) => k !== i && x.eventId === id);
                    return (
                      <button key={id} onClick={() => repoint(i, id)}
                        className={`w-full text-left px-2.5 py-2 ${id === m.eventId ? "text-white font-medium" : "text-gray-300"}`}>
                        {e.title || "(untitled)"} <span className="text-gray-500">· {niceDate(e.date)}{takenBy >= 0 ? ` · line ${rows[takenBy].line}` : ""}</span>
                      </button>
                    );
                  })}
                  {!m.nearby.length && <p className="px-2.5 py-2 text-gray-500">No gigs within a week of this date.</p>}
                  <button onClick={() => repoint(i, null)} className="w-full text-left px-2.5 py-2 text-gray-300">Add as a new gig</button>
                  <button onClick={() => repoint(i, "skip")} className="w-full text-left px-2.5 py-2 text-gray-500">Skip this row</button>
                </div>
              )}

              {plan.reason && plan.kind !== "skip" && (
                <p className="text-[11px] text-amber-400/80 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{plan.reason}</p>
              )}

              {plan.changes.length > 0 && (
                <div className="space-y-1.5">
                  {plan.changes.map((c) => (
                    <div key={c.key} className="flex items-start gap-2">
                      {c.info ? <span className="w-5 flex-shrink-0" /> : <Tick on={c.checked} onClick={() => toggle(i, c.key)} />}
                      <p className={`text-xs min-w-0 break-words ${c.info ? "text-gray-500" : c.checked ? "text-gray-200" : "text-gray-500"}`}>
                        <span className="text-gray-400">
                          {c.key === "invoice" && (c.rowIndexes?.length || 1) === 1 && plan.kind === "new" && !plan.changes.find((x) => x.key === "create")?.checked ? "Invoice (on its own, no gig)" : c.label}:{" "}
                        </span>
                        {c.from && <><span className="line-through text-gray-600">{c.from}</span> → </>}
                        {c.to}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {ticked.length > 0 && (
        <button onClick={apply} className={primary}>Apply {ticked.length} changes</button>
      )}
      <button onClick={() => setStep("columns")} className={`${quiet} w-full text-center`}>Back to columns</button>
    </div>
  );
}
