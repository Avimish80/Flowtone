import { useState } from "react";
import { Link } from "react-router-dom";
import { Lock, Plus, Trash2, FileText, Receipt, ChevronRight, Loader2 } from "lucide-react";
import { currencySymbol, createPageUrl } from "@/utils";

const docStatusColors = {
  draft: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  sent: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  accepted: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  converted: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  paid: "bg-green-500/20 text-green-400 border-green-500/30",
  cancelled: "bg-gray-600/20 text-gray-500 border-gray-600/30",
};

export default function EventFinancialsSection({ event, onChange, estimate, invoice, onCreateInvoice, creatingInvoice }) {
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const locked = event.base_price_locked;

  const adjustments = event.adjustments || [];
  const total = (parseFloat(event.base_price) || 0) + adjustments.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

  const addAdjustment = () => {
    if (!newLabel || !newAmount) return;
    const updated = [...adjustments, { label: newLabel, amount: parseFloat(newAmount) }];
    onChange("adjustments", updated);
    onChange("total_price", (parseFloat(event.base_price) || 0) + updated.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0));
    setNewLabel("");
    setNewAmount("");
  };

  const removeAdjustment = (idx) => {
    const updated = adjustments.filter((_, i) => i !== idx);
    onChange("adjustments", updated);
    onChange("total_price", (parseFloat(event.base_price) || 0) + updated.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0));
  };

  const handleBasePrice = (val) => {
    if (locked) return;
    const bp = parseFloat(val) || 0;
    onChange("base_price", bp);
    onChange("total_price", bp + adjustments.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0));
  };

  return (
    <div className="space-y-3">
      {/* Currency */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs text-gray-400 mb-1 block">Currency</label>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
            value={event.currency || "GBP"}
            onChange={e => onChange("currency", e.target.value)}
          >
            {["GBP", "USD", "EUR", "AUD", "CAD"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Base Price */}
      <div>
        <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
          Base Price {locked && <Lock className="w-3 h-3 text-yellow-500" />}
        </label>
        <div className="relative">
          <input
            type="number"
            className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 ${
              locked ? "border-yellow-700/50 cursor-not-allowed opacity-70" : "border-gray-700"
            }`}
            placeholder="0.00"
            value={event.base_price || ""}
            onChange={e => handleBasePrice(e.target.value)}
            disabled={locked}
          />
          {locked && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <span className="text-xs text-yellow-500 font-medium">LOCKED</span>
            </div>
          )}
        </div>
        {locked && <p className="text-xs text-yellow-600 mt-1">Base price is locked after confirmation. Use adjustments to modify total.</p>}
      </div>

      {/* Adjustments */}
      {adjustments.length > 0 && (
        <div className="space-y-2">
          {adjustments.map((adj, i) => (
            <div key={i} className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
              <span className="flex-1 text-sm text-gray-300">{adj.label}</span>
              <span className={`text-sm font-medium ${adj.amount >= 0 ? "text-green-400" : "text-red-400"}`}>
                {adj.amount >= 0 ? "+" : ""}{currencySymbol(event.currency)}{adj.amount}
              </span>
              <button onClick={() => removeAdjustment(i)} className="text-gray-600 hover:text-red-400 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Adjustment */}
      <div className="flex gap-2">
        <input
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
          placeholder="Label (e.g. overtime)"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
        />
        <input
          type="number"
          className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
          placeholder="Amount"
          value={newAmount}
          onChange={e => setNewAmount(e.target.value)}
        />
        <button onClick={addAdjustment} className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-3 py-2 transition-colors">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Total */}
      <div className="bg-indigo-950/50 border border-indigo-700/30 rounded-xl p-3 flex items-center justify-between">
        <span className="text-gray-300 font-medium">Total</span>
        <span className="text-xl font-bold text-indigo-300">{currencySymbol(event.currency)}{total.toFixed(2)}</span>
      </div>

      {/* Invoice — create or open. Estimate shown only if one already exists. */}
      {event.id && (
        <div className="pt-2 space-y-2">
          {estimate && (
            <Link
              to={createPageUrl(`DocumentDetail?id=${estimate.id}`)}
              className="flex items-center gap-3 bg-gray-800 rounded-xl p-3 hover:bg-gray-700 transition-colors"
            >
              <FileText className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Estimate</p>
                <p className="text-sm text-white truncate">{currencySymbol(estimate.currency)}{(estimate.total || estimate.subtotal || 0).toFixed(2)}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${docStatusColors[estimate.status] || docStatusColors.draft}`}>
                {estimate.status}
              </span>
              <ChevronRight className="w-4 h-4 text-gray-600" />
            </Link>
          )}

          {invoice ? (
            <Link
              to={createPageUrl(`DocumentDetail?id=${invoice.id}`)}
              className="flex items-center gap-3 bg-gray-800 rounded-xl p-3 hover:bg-gray-700 transition-colors"
            >
              <Receipt className="w-4 h-4 text-green-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Invoice</p>
                <p className="text-sm text-white truncate">{currencySymbol(invoice.currency)}{(invoice.total || invoice.subtotal || 0).toFixed(2)}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${docStatusColors[invoice.status] || docStatusColors.draft}`}>
                {invoice.status}
              </span>
              <ChevronRight className="w-4 h-4 text-gray-600" />
            </Link>
          ) : (
            <button
              onClick={onCreateInvoice}
              disabled={creatingInvoice}
              className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {creatingInvoice ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating invoice…</> : <><Receipt className="w-4 h-4" /> Create invoice</>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}