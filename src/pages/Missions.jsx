import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { createPageUrl } from "@/utils";
import {
  MapPin, Mail, Phone, FileText, AlertCircle, Send, Banknote,
  Check, X, Target,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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

const ITEM_COLORS = {
  client_missing_email: "text-gray-400",
  client_missing_phone: "text-gray-400",
  gig_missing_location: "text-indigo-400",
  gig_missing_fee: "text-indigo-400",
  gig_ready_to_invoice: "text-green-400",
  invoice_overdue: "text-red-400",
  invoice_draft_stale: "text-gray-400",
  invoice_ready_to_send: "text-green-400",
};

const TABS = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

export default function Missions() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("open");
  const navigate = useNavigate();

  const loadItems = () => {
    setLoading(true);
    appClient.entities.ActionItem.list("-created_at")
      .then((data) => setItems(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadItems(); }, []);

  const filtered = useMemo(() => {
    let list = items;
    if (tab === "open") list = items.filter((i) => i.status === "open");
    else if (tab === "resolved") list = items.filter((i) => i.status === "resolved" || i.status === "dismissed");

    return list.sort((a, b) => {
      if (a.status === "open" && b.status !== "open") return -1;
      if (a.status !== "open" && b.status === "open") return 1;
      if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [items, tab]);

  const openCount = useMemo(() => items.filter((i) => i.status === "open").length, [items]);

  async function handleDismiss(item) {
    await appClient.entities.ActionItem.update(item.id, {
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
    });
    loadItems();
  }

  function handleAction(item) {
    if (item.action_target) {
      navigate(createPageUrl(item.action_target));
    }
  }

  function timeAgo(dateStr) {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return "";
    }
  }

  if (loading) {
    return (
      <div className="p-4 max-w-xl mx-auto space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-gray-700/40 bg-gray-800/30 p-4 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-700/50 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 max-w-xl mx-auto">
      {/* Tab bar */}
      <div className="flex gap-1 mb-4 bg-gray-800/40 rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 text-xs font-medium py-2 rounded-lg transition-colors ${
              tab === t.key
                ? "bg-gray-700/80 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
            {t.key === "open" && openCount > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-600/30 text-indigo-300">
                {openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-16">
          <Target className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            {tab === "open" ? "All clear — nothing needs your attention" : "No missions yet"}
          </p>
        </div>
      )}

      {/* Items list */}
      <div className="space-y-2">
        {filtered.map((item) => {
          const Icon = ITEM_ICONS[item.item_type] || FileText;
          const iconColor = ITEM_COLORS[item.item_type] || "text-gray-400";
          const isResolved = item.status === "resolved" || item.status === "dismissed";
          const isOpportunity = item.item_type === "gig_ready_to_invoice" || item.item_type === "invoice_ready_to_send";

          return (
            <div
              key={item.id}
              className={`rounded-2xl border bg-gray-800/30 p-4 transition-colors ${
                isResolved
                  ? "border-gray-700/20 opacity-60"
                  : item.priority >= 2
                    ? "border-red-700/30"
                    : "border-gray-700/40"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 ${isResolved ? "text-green-500" : iconColor}`}>
                  {isResolved ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug ${isResolved ? "text-gray-500 line-through" : "text-gray-200"}`}>
                    {item.title}
                  </p>
                  <p className="text-[10px] text-gray-600 mt-1">
                    {isResolved
                      ? `Resolved ${timeAgo(item.resolved_at || item.dismissed_at || item.updated_at)}`
                      : timeAgo(item.created_at)
                    }
                  </p>

                  {/* Actions — only for open items */}
                  {!isResolved && (
                    <div className="flex flex-wrap gap-2 mt-2.5">
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
                            onClick={() => handleAction(item)}
                            className="text-xs bg-green-600/20 border border-green-500/30 text-green-300 px-3 py-1 rounded-lg hover:bg-green-600/30 transition-colors"
                          >
                            Review
                          </button>
                          <button
                            onClick={() => handleAction(item)}
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

                      {(item.item_type === "gig_missing_location" ||
                        item.item_type === "gig_missing_fee" ||
                        item.item_type === "client_missing_email" ||
                        item.item_type === "client_missing_phone" ||
                        item.item_type === "invoice_draft_stale") && (
                        <button
                          onClick={() => handleAction(item)}
                          className="text-xs bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-lg hover:bg-indigo-600/40 transition-colors"
                        >
                          {item.item_type === "gig_missing_location" && "Add location"}
                          {item.item_type === "gig_missing_fee" && "Add fee"}
                          {item.item_type === "client_missing_email" && "Add email"}
                          {item.item_type === "client_missing_phone" && "Add phone"}
                          {item.item_type === "invoice_draft_stale" && "Review draft"}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Dismiss button — only for open items */}
                {!isResolved && (
                  <button
                    onClick={() => handleDismiss(item)}
                    className="text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0 mt-0.5"
                    aria-label="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
