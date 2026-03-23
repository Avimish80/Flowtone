import { useState, useRef } from "react";
import { X, Upload, Loader2, CheckCircle2, AlertTriangle, FileText } from "lucide-react";
import { appClient } from "@/api/appClient";

export default function CSVImportModal({ onClose, onImported }) {
  const [step, setStep] = useState("upload"); // upload | preview | importing | done | error
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText(ev.target.result);
      setStep("preview");
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csvText) return;
    setStep("importing");
    setError(null);
    try {
      const res = await appClient.functions.invoke("importFromCSV", { csv_text: csvText });
      if (res.data?.success) {
        setResult(res.data);
        setStep("done");
        onImported && onImported();
      } else {
        setError(res.data?.error || "Import failed");
        setStep("error");
      }
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "Import failed");
      setStep("error");
    }
  };

  const previewLines = csvText.split("\n").slice(0, 6);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-lg border border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-400" />
            <span className="font-semibold text-white text-sm">Import from CSV</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {step === "upload" && (
            <div>
              <p className="text-gray-400 text-sm mb-4">
                Upload a CSV file with your events/gigs. The system will automatically parse columns and create invoices, events, and clients.
              </p>
              <p className="text-xs text-gray-500 mb-4">
                Supported columns (any order, any name): title, date, time, client/venue, location, fee/price, type, status, notes
              </p>
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-700 hover:border-indigo-500 rounded-xl py-10 flex flex-col items-center gap-3 text-gray-400 hover:text-indigo-400 transition-colors"
              >
                <Upload className="w-8 h-8" />
                <span className="text-sm font-medium">Click to upload CSV</span>
                <span className="text-xs text-gray-600">or drag and drop</span>
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
            </div>
          )}

          {step === "preview" && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <span className="text-sm text-gray-300">{fileName}</span>
              </div>
              <p className="text-xs text-gray-500 mb-2">Preview (first {previewLines.length} rows):</p>
              <div className="bg-gray-800 rounded-lg p-3 mb-4 overflow-x-auto">
                {previewLines.map((line, i) => (
                  <p key={i} className={`text-xs font-mono truncate ${i === 0 ? "text-indigo-300 font-semibold" : "text-gray-400"}`}>
                    {line}
                  </p>
                ))}
                {csvText.split("\n").length > 6 && (
                  <p className="text-xs text-gray-600 mt-1">... {csvText.split("\n").length - 6} more rows</p>
                )}
              </div>
              <p className="text-sm text-gray-300 mb-4">
                Ready to import <strong className="text-white">{Math.max(0, csvText.split("\n").filter(l => l.trim()).length - 1)}</strong> rows. This will automatically:
              </p>
              <ul className="text-sm text-gray-400 space-y-1 mb-5 list-disc list-inside">
                <li>Create an <strong className="text-white">Invoice</strong> for each row with full line items</li>
                <li>Create a linked <strong className="text-white">Work Event</strong> if a date is present</li>
                <li>Create or update <strong className="text-white">Clients</strong> with email &amp; address info</li>
              </ul>
              <div className="flex gap-2">
                <button onClick={() => { setStep("upload"); setCsvText(""); setFileName(""); }} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                  Choose different file
                </button>
                <button onClick={handleImport} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-3 text-sm font-semibold transition-colors">
                  Import Now
                </button>
              </div>
            </div>
          )}

          {step === "importing" && (
            <div className="flex flex-col items-center py-8 gap-4">
              <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
              <p className="text-gray-300 text-sm font-medium">Importing your data...</p>
              <p className="text-gray-500 text-xs text-center">Creating invoices, clients, and linked events. This may take a moment.</p>
            </div>
          )}

          {step === "done" && result && (
            <div className="flex flex-col items-center py-6 gap-4">
              <div className="w-14 h-14 bg-green-500/20 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-green-400" />
              </div>
              <p className="text-white font-semibold">Import complete!</p>
              <p className="text-gray-300 text-sm">{result.imported} records imported</p>
              <div className="w-full bg-gray-800 rounded-xl p-3 max-h-40 overflow-y-auto">
                {(result.documents || result.invoices || []).map((doc, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-700 last:border-0">
                    <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />
                    <span className="text-xs text-gray-300 truncate">{doc.document_number ? `#${doc.document_number} ` : ''}{doc.title}</span>
                  </div>
                ))}
              </div>
              <button onClick={onClose} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-3 text-sm font-semibold transition-colors">
                Done
              </button>
            </div>
          )}

          {step === "error" && (
            <div className="flex flex-col items-center py-8 gap-4">
              <AlertTriangle className="w-10 h-10 text-red-400" />
              <p className="text-white font-semibold">Import failed</p>
              <p className="text-gray-400 text-sm text-center">{error}</p>
              <button onClick={() => setStep("preview")} className="w-full bg-gray-700 hover:bg-gray-600 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}