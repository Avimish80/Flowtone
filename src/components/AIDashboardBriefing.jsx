import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { appClient } from "@/api/appClient";
import { Sparkles, X, ChevronRight, MapPin, Mail, Phone, FileText, AlertCircle, Send, Banknote } from "lucide-react";
import { getCachedProfileSync, DEFAULT_ASSISTANT_NAME } from "@/lib/assistantProfile";
import { hasLocation, hasFee, hasInvoice } from "@/lib/missingInfo";

const ITEM_ICONS = {
  client_missing_email: Mail,
  client_missing_phone: Phone,
  gig_missing_location: MapPin,
  gig_missing_fee: Banknote,
  gig_ready_to_invoice: FileText,
  invoice_overdue: AlertCircle,
  invoice_draft_stale: FileText,
  invoice_ready_to_send: Send,
};

const MAX_VISIBLE = 4;

export function AIDashboardBriefing({ events = [], documents = [] }) {
  const today = new Date().toISOString().slice(0, 10);
  const dismissKey = `flowtone_missions_dismissed_${today}`;
  const profile = getCachedProfileSync();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(dismissKey) === "1"; } catch { return false; }
  });
  const navigate = useNavigate();

  const eventMap = useMemo(
    () => Object.fromEntries(events.map((e) => [e.id, e])),
    [events]
  );
  const invoices = useMemo(
    () => documents.filter((d) => d.document_type === "invoice"),
    [documents]
  );
  const invoicedEventIds = useMemo(
    () => new Set(invoices.map((i) => i.work_event_id).filter(Boolean)),
    [invoices]
  );
  const invoiceMap = useMemo(
    () => Object.fromEntries(invoices.map((i) => [i.id, i])),
    [invoices]
  );

  useEffect(() => {
    appClient.entities.ActionItem.filter({ status: "open" })
      .then((result) => {
        result.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        setItems(result);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Live reconciliation — if the user fixed an issue since the scan,
  // hide it immediately without waiting for the next scan run.
  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (item.entity_type === "event" && item.entity_id) {
        const event = eventMap[item.entity_id];
        if (!event) return false;
        if (item.item_type === "gig_missing_location") return !hasLocation(event);
        if (item.item_type === "gig_missing_fee") return !hasFee(event) && !hasInvoice(event, invoices);
        if (item.item_type === "gig_ready_to_invoice") return !invoicedEventIds.has(event.id);
      }
      if (item.entity_type === "invoice" && item.entity_id) {
        const inv = invoiceMap[item.entity_id];
        if (!inv) return false;
        if (item.item_type === "invoice_overdue") return inv.status === "sent";
        if (item.item_type === "invoice_ready_to_send") return inv.status === "draft";
        if (item.item_type === "invoice_draft_stale") return inv.status === "draft";
      }
      return true;
    });
  }, [items, eventMap, invoices, invoiceMap, invoicedEventIds]);

  const shown = visibleItems.slice(0, MAX_VISIBLE);
  const extraCount = visibleItems.length - shown.length;

  function handleAction(item) {
    if (item.action_target) {
      navigate(createPageUrl(item.action_target));
    }
  }

  function handleSend(item) {
    if (item.entity_type === "invoice" && item.entity_id) {
      navigate(createPageUrl(`DocumentDetail?id=${item.entity_id}`));
    }
  }

  if (dismissed) return null;

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-700/40 bg-gray-900/60 p-4 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-4 h-4 rounded bg-gray-700" />
          <div className="h-3.5 bg-gray-700 rounded w-44" />
        </div>
        <div className="space-y-2 pl-6">
          <div className="h-3 bg-gray-700/70 rounded w-full" />
          <div className="h-3 bg-gray-700/70 rounded w-4/5" />
        </div>
      </div>
    );
  }

  if (shown.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-700/40 bg-gray-900/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/30">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
          <span className="text-sm font-medium text-gray-200 truncate">
            {profile?.assistant_name || DEFAULT_ASSISTANT_NAME}
          </span>
          {visibleItems.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-600/30 text-indigo-300 border border-indigo-500/20">
              {visibleItems.length}
            </span>
          )}
        </div>
        <button
          onClick={() => {
            setDismissed(true);
            try { sessionStorage.setItem(dismissKey, "1"); } catch { /* ignore */ }
          }}
          className="text-gray-600 hover:text-gray-400 transition-colors ml-3 flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Items */}
      <div className="divide-y divide-gray-700/30">
        {shown.map((item) => {
          const Icon = ITEM_ICONS[item.item_type] || FileText;
          const isOpportunity = item.item_type === "gig_ready_to_invoice" || item.item_type === "invoice_ready_to_send";
          const isUrgent = item.item_type === "invoice_overdue";

          return (
            <div key={item.id} className="px-4 py-3">
              <div className="flex items-start gap-2.5 mb-2">
                <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                  isUrgent ? "text-red-400" : isOpportunity ? "text-green-400" : "text-gray-500"
                }`} />
                <p className="text-sm text-gray-300 leading-snug">{item.title}</p>
              </div>

              <div className="flex flex-wrap gap-2 pl-6">
                {/* Primary CTA */}
                {item.item_type === "gig_ready_to_invoice" && (
                  <>
                    <button
                      onClick={() => handleAction(item)}
                      className="text-xs bg-green-600/20 border border-green-500/30 text-green-300 px-3 py-1 rounded-lg hover:bg-green-600/30 transition-colors"
                    >
                      Review Invoice
                    </button>
                    <button
                      onClick={() => handleAction(item)}
                      className="text-xs bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-lg hover:bg-indigo-600/40 transition-colors"
                    >
                      Send
                    </button>
                  </>
                )}

                {item.item_type === "invoice_ready_to_send" && (
                  <>
                    <button
                      onClick={() => handleSend(item)}
                      className="text-xs bg-green-600/20 border border-green-500/30 text-green-300 px-3 py-1 rounded-lg hover:bg-green-600/30 transition-colors"
                    >
                      Review
                    </button>
                    <button
                      onClick={() => handleSend(item)}
                      className="text-xs bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-lg hover:bg-indigo-600/40 transition-colors"
                    >
                      Send
                    </button>
                  </>
                )}

                {item.item_type === "invoice_overdue" && (
                  <button
                    onClick={() => handleAction(item)}
                    className="text-xs bg-amber-600/20 border border-amber-500/30 text-amber-300 px-3 py-1 rounded-lg hover:bg-amber-600/30 transition-colors"
                  >
                    Chase
                  </button>
                )}

                {item.item_type === "gig_missing_location" && (
                  <button
                    onClick={() => handleAction(item)}
                    className="text-xs bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-lg hover:bg-indigo-600/40 transition-colors"
                  >
                    Add location
                  </button>
                )}

                {item.item_type === "gig_missing_fee" && (
                  <button
                    onClick={() => handleAction(item)}
                    className="text-xs bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-lg hover:bg-indigo-600/40 transition-colors"
                  >
                    Add fee
                  </button>
                )}

                {item.item_type === "client_missing_email" && (
                  <button
                    onClick={() => handleAction(item)}
                    className="text-xs bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-lg hover:bg-indigo-600/40 transition-colors"
                  >
                    Add email
                  </button>
                )}

                {item.item_type === "client_missing_phone" && (
                  <button
                    onClick={() => handleAction(item)}
                    className="text-xs bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-lg hover:bg-indigo-600/40 transition-colors"
                  >
                    Add phone
                  </button>
                )}

                {item.item_type === "invoice_draft_stale" && (
                  <button
                    onClick={() => handleAction(item)}
                    className="text-xs bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-lg hover:bg-indigo-600/40 transition-colors"
                  >
                    Review draft
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* View all footer */}
      {(extraCount > 0 || visibleItems.length > 0) && (
        <Link
          to={createPageUrl("Missions")}
          className="flex items-center justify-between px-4 py-2.5 border-t border-gray-700/30 hover:bg-gray-800/40 transition-colors"
        >
          <span className="text-xs text-gray-500">
            {extraCount > 0 ? `+${extraCount} more` : "View all missions"}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
        </Link>
      )}
    </div>
  );
}
