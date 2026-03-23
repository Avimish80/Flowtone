import { useState, useRef } from "react";
import { appClient } from "@/api/appClient";
import { X, Upload, CheckCircle2, AlertCircle, Loader2, FileText, Users, CalendarDays } from "lucide-react";

// Status badge colors
const STATUS_COLORS = {
  paid: "bg-green-500/20 text-green-300",
  fully_paid: "bg-green-500/20 text-green-300",
  sent: "bg-blue-500/20 text-blue-300",
  opened: "bg-blue-500/20 text-blue-300",
  unsent: "bg-gray-500/20 text-gray-400",
  draft: "bg-gray-500/20 text-gray-400",
};

export default function InvoiceImportModal({ onClose, onImported }) {
  const [step, setStep] = useState("upload"); // upload | preview | importing | done | error
  const [rows, setRows] = useState([]);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const fileRef = useRef();

  const parseCSV = (text) => {
    const lines = text.trim().split(/\r?\n/);
    const headers = [];
    // Parse header row properly (handle quoted headers)
    let cur = "";
    let inQ = false;
    for (const ch of lines[0]) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { headers.push(cur.trim().replace(/^"|"$/g, "")); cur = ""; }
      else { cur += ch; }
    }
    headers.push(cur.trim().replace(/^"|"$/g, ""));

    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = [];
      let c = "";
      let q = false;
      for (const ch of line) {
        if (ch === '"') { q = !q; }
        else if (ch === ',' && !q) { vals.push(c.trim()); c = ""; }
        else { c += ch; }
      }
      vals.push(c.trim());
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
      return obj;
    });
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseCSV(e.target.result);
        setRows(parsed);
        setStep("preview");
      } catch (err) {
        setError("Failed to parse CSV: " + err.message);
        setStep("error");
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setStep("importing");
    try {
      const res = await appClient.functions.invoke("importInvoicesCSV", { rows });
      setResults(res.data?.results || res.data);
      setStep("done");
      onImported?.();
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  };

  // Count unique clients and statuses in preview
  const uniqueClients = [...new Set(rows.map(r => r.client_name).filter(Boolean))];
  const statusCounts = rows.reduce((acc, r) => {
    const s = (r.invoice_status || "draft").toLowerCase();
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">Import Invoices from CSV</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5">
          {step === "upload" && (
            <div
              className="border-2 border-dashed border-gray-600 rounded-xl p-10 text-center cursor-pointer hover:border-indigo-500 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
              onDragOver={e => e.preventDefault()}
            >
              <Upload className="w-10 h-10 text-gray-500 mx-auto mb-3" />
              <p className="text-gray-300 font-medium">Drop your CSV here or click to browse</p>
              <p className="text-gray-500 text-sm mt-1">Supports Invoice2Go export format</p>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
            </div>
          )}

          {step === "preview" && (
            <div>
              {/* Summary stats */}
              <div className="bg-gray-800 rounded-xl p-4 mb-4">
                <p className="text-white font-semibold text-lg">{rows.length} invoices ready to import</p>
                <div className="flex flex-wrap gap-3 mt-2">
                  <span className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Users className="w-3.5 h-3.5" /> {uniqueClients.length} clients
                  </span>
                  {Object.entries(statusCounts).map(([s, count]) => (
                    <span key={s} className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[s] || "bg-gray-700 text-gray-400"}`}>
                      {count} {s}
                    </span>
                  ))}
                </div>
                <p className="text-gray-500 text-xs mt-2">
                  Creates clients, events, and invoices. Duplicates are auto-skipped.
                </p>
              </div>

              {/* Row preview */}
              <div className="max-h-52 overflow-y-auto space-y-1 mb-4">
                {rows.slice(0, 15).map((r, i) => {
                  const status = (r.invoice_status || "draft").toLowerCase();
                  const clean = (v) => (v || "").toLowerCase() === "not in source" ? "" : v;
                  return (
                    <div key={i} className="bg-gray-800/60 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                      <span className="text-gray-500 text-xs w-8 flex-shrink-0">#{r.invoice_number || "—"}</span>
                      <span className="text-white truncate flex-1">{r.invoice_title || "Untitled"}</span>
                      <span className="text-gray-300 text-xs flex-shrink-0 font-medium">{r.currency || "GBP"} {r.subtotal || "0"}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLORS[status] || "bg-gray-700 text-gray-400"}`}>
                        {status}
                      </span>
                    </div>
                  );
                })}
                {rows.length > 15 && (
                  <p className="text-gray-500 text-xs text-center py-1">...and {rows.length - 15} more</p>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep("upload")} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded-xl py-3 text-sm font-medium transition-colors">Back</button>
                <button onClick={handleImport} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                  Import {rows.length} Invoices
                </button>
              </div>
            </div>
          )}

          {step === "importing" && (
            <div className="text-center py-10">
              <Loader2 className="w-10 h-10 text-indigo-400 animate-spin mx-auto mb-4" />
              <p className="text-white font-medium">Importing...</p>
              <p className="text-gray-400 text-sm mt-1">Creating clients, events & invoices</p>
            </div>
          )}

          {step === "done" && results && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-white font-semibold">Import Complete</p>
                  <p className="text-gray-400 text-sm">
                    {results.documents_created} invoices · {results.events_created} events · {results.clients_created} clients
                    {results.skipped > 0 && <> · {results.skipped} skipped</>}
                  </p>
                </div>
              </div>
              {results.errors?.length > 0 && (
                <div className="bg-red-950/50 border border-red-700/40 rounded-xl p-3 mb-4 max-h-32 overflow-y-auto">
                  <p className="text-red-300 text-sm font-medium mb-1">{results.errors.length} errors:</p>
                  {results.errors.map((e, i) => <p key={i} className="text-red-400 text-xs">Row {e.row}: {e.error}</p>)}
                </div>
              )}
              <button onClick={onClose} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-3 text-sm font-medium transition-colors">Done</button>
            </div>
          )}

          {step === "error" && (
            <div className="text-center py-8">
              <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
              <p className="text-white font-medium mb-1">Import Failed</p>
              <p className="text-gray-400 text-sm">{error}</p>
              <button onClick={() => setStep("upload")} className="mt-4 bg-gray-700 hover:bg-gray-600 text-white rounded-xl px-6 py-2 text-sm font-medium transition-colors">Try Again</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
