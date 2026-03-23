import { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl, currencySymbol } from "@/utils";
import { FileText, Receipt, ChevronRight, Plus, CalendarDays, CheckCircle2, Loader2, Lock, ArrowRightLeft } from "lucide-react";
import { appClient } from "@/api/appClient";

const statusColors = {
  draft: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  sent: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  accepted: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  converted: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  paid: "bg-green-500/20 text-green-400 border-green-500/30",
  cancelled: "bg-gray-600/20 text-gray-500 border-gray-600/30",
};

export default function EventLinkedDocsSection({ event, estimate, invoice, onCreateInvoiceFromEstimate, creatingInvoice }) {
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(!!event.google_calendar_event_id);

  const handleSyncCalendar = async () => {
    if (!event.id || !event.date) return;
    setSyncing(true);
    const res = await appClient.functions.invoke('syncToGoogleCalendar', { event_id: event.id });
    if (res.data?.success) setSynced(true);
    setSyncing(false);
  };

  return (
    <div className="space-y-3">
      {/* Estimate */}
      <div>
        <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Estimate</p>
        {estimate ? (
          <Link
            to={createPageUrl(`DocumentDetail?id=${estimate.id}`)}
            className="flex items-center gap-3 bg-gray-800 rounded-xl p-3 hover:bg-gray-700 transition-colors"
          >
            <FileText className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{estimate.title}</p>
              <p className="text-xs text-gray-400">{currencySymbol(estimate.currency)}{(estimate.total || estimate.subtotal || 0).toFixed(2)}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {estimate.is_locked && <Lock className="w-3 h-3 text-yellow-500" />}
              {estimate.status === "converted" && <ArrowRightLeft className="w-3 h-3 text-indigo-400" />}
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColors[estimate.status] || statusColors.draft}`}>
                {estimate.status}
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </Link>
        ) : (
          <p className="text-sm text-gray-600 italic">No estimate yet — will be created on save</p>
        )}
      </div>

      {/* Google Calendar Sync */}
      {event.id && event.date && (
        <div>
          <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Calendar</p>
          <button
            onClick={handleSyncCalendar}
            disabled={syncing}
            className={`w-full rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              synced
                ? "bg-green-950/50 border border-green-700/40 text-green-400 hover:bg-green-900/40"
                : "bg-indigo-700 hover:bg-indigo-600 text-white"
            } disabled:opacity-50`}
          >
            {syncing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Syncing...</>
            ) : synced ? (
              <><CheckCircle2 className="w-4 h-4" /> Synced to Google Calendar</>
            ) : (
              <><CalendarDays className="w-4 h-4" /> Add to Google Calendar</>
            )}
          </button>
        </div>
      )}

      {/* Invoice */}
      <div>
        <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Invoice</p>
        {invoice ? (
          <Link
            to={createPageUrl(`DocumentDetail?id=${invoice.id}`)}
            className="flex items-center gap-3 bg-gray-800 rounded-xl p-3 hover:bg-gray-700 transition-colors"
          >
            <Receipt className="w-4 h-4 text-green-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{invoice.title}</p>
              <p className="text-xs text-gray-400">{currencySymbol(invoice.currency)}{(invoice.total || invoice.subtotal || 0).toFixed(2)}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {invoice.is_locked && <Lock className="w-3 h-3 text-yellow-500" />}
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColors[invoice.status] || statusColors.draft}`}>
                {invoice.status}
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </Link>
        ) : estimate ? (
          <button
            onClick={onCreateInvoiceFromEstimate}
            disabled={creatingInvoice}
            className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {creatingInvoice ? "Creating Invoice..." : "Create Invoice from Estimate"}
          </button>
        ) : (
          <p className="text-sm text-gray-600 italic">No invoice yet</p>
        )}
      </div>
    </div>
  );
}
