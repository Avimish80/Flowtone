import { useState, useRef } from "react";
import { appClient } from "@/api/appClient";
import { X, Upload, CheckCircle2, Loader2, ChevronDown } from "lucide-react";

// ─── Smart column mapping ────────────────────────────────────────────────────

const CLIENT_ALIASES = {
  name: ["name", "full name", "client name", "customer name", "contact", "full_name", "client", "company", "organisation", "organization", "business name"],
  email: ["email", "email address", "e-mail", "email_address", "mail"],
  phone: ["phone", "phone number", "tel", "mobile", "telephone", "phone_number", "cell", "mobile number"],
  client_type: ["type", "client type", "category", "client_type"],
  notes: ["notes", "note", "comments", "comment", "description"],
};

const EVENT_ALIASES = {
  title: ["title", "event", "name", "gig", "job", "subject", "event title", "event name", "description"],
  date: ["date", "event date", "start date", "start", "date_start", "event_date", "gig date"],
  start_time: ["start time", "time", "start_time", "start", "from"],
  end_time: ["end time", "end", "end_time", "finish", "to"],
  location_address: ["location", "venue", "place", "address", "venue name", "venue_name"],
  event_type: ["type", "event type", "category", "kind", "event_type"],
  status: ["status", "state"],
  fee: ["fee", "amount", "price", "cost", "payment", "rate"],
  notes: ["notes", "note", "comments", "description", "details"],
};

const INVOICE_ALIASES = {
  title: ["title", "description", "service", "item", "name", "invoice title"],
  document_number: ["invoice number", "number", "invoice #", "inv number", "invoice_number", "doc number", "#"],
  client_id: ["client", "client name", "customer", "client_name", "customer name"],
  total: ["total", "amount", "value", "price", "cost", "invoice total", "grand total"],
  due_date: ["due date", "due", "payment due", "due_date", "pay by"],
  status: ["status", "state", "payment status"],
  notes: ["notes", "note", "comments", "description"],
};

function normalizeHeader(h) {
  return h.toLowerCase().replace(/[_\-]/g, " ").trim();
}

function detectType(headers) {
  const norm = headers.map(normalizeHeader);
  let clientScore = 0, eventScore = 0, invoiceScore = 0;

  for (const h of norm) {
    if (CLIENT_ALIASES.name.includes(h)) clientScore += 3;
    if (CLIENT_ALIASES.email.includes(h)) clientScore += 2;
    if (CLIENT_ALIASES.phone.includes(h)) clientScore += 2;
    if (CLIENT_ALIASES.client_type.includes(h)) clientScore += 1;

    if (EVENT_ALIASES.title.some(a => h.includes(a) || a.includes(h))) eventScore += 2;
    if (EVENT_ALIASES.date.some(a => h.includes(a) || a.includes(h))) eventScore += 3;
    if (EVENT_ALIASES.location_address.some(a => h.includes(a) || a.includes(h))) eventScore += 2;
    if (EVENT_ALIASES.start_time.some(a => h === a)) eventScore += 2;

    if (INVOICE_ALIASES.document_number.some(a => h.includes(a) || a.includes(h))) invoiceScore += 3;
    if (INVOICE_ALIASES.total.some(a => h.includes("total") || h.includes("amount"))) invoiceScore += 2;
    if (INVOICE_ALIASES.due_date.some(a => h.includes("due"))) invoiceScore += 2;
    if (h.includes("invoice")) invoiceScore += 3;
  }

  if (clientScore >= eventScore && clientScore >= invoiceScore) return "clients";
  if (invoiceScore >= eventScore) return "invoices";
  return "events";
}

function buildMapping(headers, aliases) {
  const mapping = {};
  const norm = headers.map(normalizeHeader);
  for (const [field, fieldAliases] of Object.entries(aliases)) {
    for (let i = 0; i < norm.length; i++) {
      if (fieldAliases.some(a => norm[i] === a || norm[i].includes(a) || a.includes(norm[i]))) {
        if (!mapping[field]) mapping[field] = headers[i];
        break;
      }
    }
  }
  return mapping;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row");

  const parseRow = (line) => {
    const vals = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim().replace(/^"|"$/g, "")); cur = ""; }
      else { cur += ch; }
    }
    vals.push(cur.trim().replace(/^"|"$/g, ""));
    return vals;
  };

  const headers = parseRow(lines[0]);
  return {
    headers,
    rows: lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = parseRow(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
      return obj;
    }),
  };
}

function parseDate(str) {
  if (!str) return "";
  // Try ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  // Try DD/MM/YYYY or MM/DD/YYYY
  const parts = str.split(/[\/\-\.]/);
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number);
    if (c > 1900) {
      if (a > 12) return `${c}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`;
      return `${c}-${String(a).padStart(2,'0')}-${String(b).padStart(2,'0')}`;
    }
    if (a > 1900) return `${a}-${String(b).padStart(2,'0')}-${String(c).padStart(2,'0')}`;
  }
  return "";
}

function parseAmount(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[^0-9.]/g, "")) || 0;
}

function mapRow(row, mapping) {
  const result = {};
  for (const [field, csvCol] of Object.entries(mapping)) {
    if (csvCol) result[field] = row[csvCol] || "";
  }
  return result;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SmartCSVImport({ onClose, onImported }) {
  const [step, setStep] = useState("upload");
  const [detectedType, setDetectedType] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const fileRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { headers: h, rows: r } = parseCSV(e.target.result);
        const type = detectType(h);
        const aliases = type === "clients" ? CLIENT_ALIASES : type === "events" ? EVENT_ALIASES : INVOICE_ALIASES;
        const m = buildMapping(h, aliases);
        setHeaders(h);
        setRows(r);
        setDetectedType(type);
        setMapping(m);
        setStep("preview");
      } catch (err) {
        setError("Could not read this file: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setImporting(true);
    let imported = 0, skipped = 0;

    try {
      for (const row of rows) {
        const mapped = mapRow(row, mapping);
        try {
          if (detectedType === "clients") {
            if (!mapped.name) { skipped++; continue; }
            await appClient.entities.Client.create({
              name: mapped.name,
              email: mapped.email || "",
              phone: mapped.phone || "",
              client_type: mapped.client_type || "other",
              notes: mapped.notes || "",
            });
            imported++;
          } else if (detectedType === "events") {
            if (!mapped.title) { skipped++; continue; }
            await appClient.entities.WorkEvent.create({
              title: mapped.title,
              date: parseDate(mapped.date),
              start_time: mapped.start_time || "",
              end_time: mapped.end_time || "",
              location_address: mapped.location_address || "",
              event_type: mapped.event_type || "gig",
              status: mapped.status || "confirmed",
              fee: parseAmount(mapped.fee),
              notes: mapped.notes || "",
            });
            imported++;
          } else {
            if (!mapped.title && !mapped.document_number) { skipped++; continue; }
            await appClient.entities.Document.create({
              document_type: "invoice",
              document_number: mapped.document_number || "",
              title: mapped.title || "Imported Invoice",
              total: parseAmount(mapped.total),
              subtotal: parseAmount(mapped.total),
              due_date: parseDate(mapped.due_date),
              status: mapped.status || "draft",
              notes: mapped.notes || "",
              line_items: mapped.title ? [{ description: mapped.title, quantity: 1, unit_price: parseAmount(mapped.total), total: parseAmount(mapped.total) }] : [],
              currency: "GBP",
            });
            imported++;
          }
        } catch { skipped++; }
      }
      setResults({ imported, skipped });
      setStep("done");
    } catch (err) {
      setError("Import failed: " + err.message);
    } finally {
      setImporting(false);
    }
  };

  const aliases = detectedType === "clients" ? CLIENT_ALIASES : detectedType === "events" ? EVENT_ALIASES : INVOICE_ALIASES;
  const fields = detectedType ? Object.keys(aliases) : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="font-semibold text-white">Smart CSV Import</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Upload step */}
          {step === "upload" && (
            <div>
              <p className="text-sm text-gray-400 mb-4">Upload any CSV — from Apple Contacts, Google Calendar, QuickBooks, or your own spreadsheet. GigFlow will figure out what it is and map the columns automatically.</p>
              {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-700 hover:border-indigo-500 rounded-xl p-8 flex flex-col items-center gap-3 transition-colors"
              >
                <Upload className="w-8 h-8 text-gray-500" />
                <span className="text-gray-300 font-medium">Tap to choose a CSV file</span>
                <span className="text-xs text-gray-600">Clients, events, or invoices — any format</span>
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
            </div>
          )}

          {/* Preview step */}
          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 bg-indigo-900/30 border border-indigo-700/40 rounded-xl px-4 py-3">
                <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                <span className="text-sm text-indigo-300">
                  Detected: <strong className="capitalize">{detectedType}</strong> — {rows.length} row{rows.length !== 1 ? "s" : ""} found
                </span>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Column Mapping</p>
                <div className="space-y-2">
                  {fields.map(field => (
                    <div key={field} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-28 flex-shrink-0 capitalize">{field.replace(/_/g, " ")}</span>
                      <div className="relative flex-1">
                        <select
                          value={mapping[field] || ""}
                          onChange={e => setMapping(prev => ({ ...prev, [field]: e.target.value || undefined }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500 appearance-none"
                        >
                          <option value="">— skip —</option>
                          {headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview of first 3 rows */}
              {rows.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Preview (first 3 rows)</p>
                  <div className="bg-gray-800 rounded-xl overflow-hidden">
                    {rows.slice(0, 3).map((row, i) => {
                      const mapped = mapRow(row, mapping);
                      const label = mapped.name || mapped.title || mapped.document_number || Object.values(mapped)[0] || "—";
                      return (
                        <div key={i} className={`px-3 py-2 text-sm ${i > 0 ? "border-t border-gray-700" : ""}`}>
                          <p className="text-white truncate">{label}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {Object.entries(mapped).filter(([k, v]) => v && k !== "name" && k !== "title").slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && <p className="text-red-400 text-sm">{error}</p>}
            </div>
          )}

          {/* Done step */}
          {step === "done" && results && (
            <div className="text-center py-6">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <p className="text-white font-semibold text-lg mb-1">{results.imported} imported</p>
              {results.skipped > 0 && <p className="text-gray-400 text-sm">{results.skipped} row{results.skipped !== 1 ? "s" : ""} skipped (missing required fields)</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-800 flex gap-2">
          {step === "upload" && (
            <button onClick={onClose} className="flex-1 bg-gray-800 text-gray-300 rounded-xl py-2.5 text-sm font-medium">Cancel</button>
          )}
          {step === "preview" && (
            <>
              <button onClick={() => setStep("upload")} className="flex-1 bg-gray-800 text-gray-300 rounded-xl py-2.5 text-sm font-medium">Back</button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2"
              >
                {importing ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</> : `Import ${rows.length} rows`}
              </button>
            </>
          )}
          {step === "done" && (
            <button onClick={() => { onImported?.(); onClose(); }} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-medium">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
