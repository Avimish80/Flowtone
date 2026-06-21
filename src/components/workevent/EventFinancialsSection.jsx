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

// Friendly label for the first (base) line of the fee breakdown, by event type.
const FEE_LABELS = {
  Gig: "Performance fee",
  Lesson: "Lesson fee",
  Session: "Session fee",
  Rehearsal: "Rehearsal fee",
  "Tour Day": "Day fee",
  Residency: "Residency fee",
  Practice: "Fee",
};

export default function EventFinancialsSection({ event, onChange, estimate, invoice, onCreateInvoice, creatingInvoice }) {
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [allowEdit, setAllowEdit] = useState(false);

  // Lock the fee only once an invoice exists — so the event fee and the invoice
  // stay in sync. Confirmed-but-not-invoiced gigs remain freely editable.
  const locked = !!invoice;
  const editable = !locked || allowEdit;

  const sym = currencySymbol(event.currency);
  const adjustments = event.adjustments || [];
  const baseLabel = FEE_LABELS[event.event_type] || "Fee";
  const sumTotal = (bp, adjs) =>
    (parseFloat(bp) || 0) + adjs.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
  const total = sumTotal(event.base_price, adjustments);

  const setBase = (val) => {
    if (!editable) return;
    const bp = parseFloat(val) || 0;
    onChange("base_price", bp);
    onChange("total_price", sumTotal(bp, adjustments));
  };

  const updateAdjustment = (idx, field, value) => {
    if (!editable) return;
    const updated = adjustments.map((a, i) => (i === idx ? { ...a, [field]: value } : a));
    onChange("adjustments", updated);
    onChange("total_price", sumTotal(event.base_price, updated));
  };

  const addAdjustment = () => {
    if (!newLabel || !newAmount) return;
    const updated = [...adjustments, { label: newLabel, amount: newAmount }];
    onChange("adjustments", updated);
    onChange("total_price", sumTotal(event.base_price, updated));
    setNewLabel("");
    setNewAmount("");
  };

  const removeAdjustment = (idx) => {
    const updated = adjustments.filter((_, i) => i !== idx);
    onChange("adjustments", updated);
    onChange("total_price", sumTotal(event.base_price, updated));
  };

  return (
    <div className="space-y-3">
      {/* Total — lead with the money */}
      <div className="bg-indigo-950/40 border border-indigo-700/30 rounded-2xl p-4 flex items-end justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-indigo-300/70">Total</p>
          <p className="text-3xl font-bold text-white mt-0.5">{sym}{total.toFixed(2)}</p>
        </div>
        {locked && !allowEdit && (
          <button
            onClick={() => setAllowEdit(true)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            <Lock className="w-3 h-3" /> Edit fee
          </button>
        )}
      </div>

      {/* Fee breakdown — one clean list; the first line is the fee itself */}
      <div className="rounded-xl border border-gray-700/50 divide-y divide-gray-700/40 overflow-hidden">
        {/* Base fee line */}
        <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-800/40">
          <span className="flex-1 text-sm text-gray-300">{baseLabel}</span>
          <span className="text-sm text-gray-500">{sym}</span>
          <input
            type="number"
            inputMode="decimal"
            disabled={!editable}
            value={event.base_price || ""}
            onChange={(e) => setBase(e.target.value)}
            placeholder="0.00"
            className={`w-24 bg-transparent text-right text-sm text-white placeholder-gray-600 focus:outline-none ${editable ? "" : "opacity-70 cursor-not-allowed"}`}
          />
        </div>

        {/* Adjustment lines */}
        {adjustments.map((adj, i) => {
          const amt = parseFloat(adj.amount) || 0;
          return (
            <div key={i} className="flex items-center gap-2 px-3 py-2.5">
              <input
                type="text"
                disabled={!editable}
                value={adj.label || ""}
                onChange={(e) => updateAdjustment(i, "label", e.target.value)}
                placeholder="Label"
                className="flex-1 bg-transparent text-sm text-gray-300 placeholder-gray-600 focus:outline-none min-w-0"
              />
              <span className="text-sm text-gray-500">{sym}</span>
              <input
                type="number"
                inputMode="decimal"
                disabled={!editable}
                value={adj.amount ?? ""}
                onChange={(e) => updateAdjustment(i, "amount", e.target.value)}
                placeholder="0.00"
                className={`w-20 bg-transparent text-right text-sm focus:outline-none placeholder-gray-600 ${amt < 0 ? "text-red-400" : "text-green-400"}`}
              />
              {editable && (
                <button onClick={() => removeAdjustment(i)} className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}

        {/* Add line */}
        {editable && (
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/30">
            <input
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none min-w-0"
              placeholder="Add a line (e.g. travel, overtime)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addAdjustment(); }}
            />
            <input
              type="number"
              inputMode="decimal"
              className="w-20 bg-transparent text-right text-sm text-white placeholder-gray-600 focus:outline-none"
              placeholder="Amount"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addAdjustment(); }}
            />
            <button onClick={addAdjustment} className="text-indigo-400 hover:text-indigo-300 transition-colors flex-shrink-0">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Locked note — calm, with a way out */}
      {locked && (
        <p className="text-xs text-gray-500 px-1">
          {allowEdit
            ? "Editing the fee — note the invoice below won't update automatically."
            : "Locked to stay in sync with the invoice below."}
        </p>
      )}

      {/* Currency — secondary */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-gray-500">Currency</span>
        <select
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-indigo-500"
          value={event.currency || "GBP"}
          onChange={(e) => onChange("currency", e.target.value)}
        >
          {["GBP", "USD", "EUR", "AUD", "CAD"].map((c) => <option key={c}>{c}</option>)}
        </select>
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
