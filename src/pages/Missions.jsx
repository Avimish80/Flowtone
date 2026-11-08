import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { createPageUrl } from "@/utils";
import { runMissionScan } from "@/lib/missionScanRunner";
import { isGroupItem, itemKey, missionActionLabel, missionTarget } from "@/lib/actionItemScanner";
import { isGmailConnected, sendGmailEmail } from "@/lib/gmailClient";
import {
  MapPin, FileText, AlertCircle, Send, Banknote, Download,
  Check, Target, RefreshCw, UserPlus, Mail, ChevronDown,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const ITEM_ICONS = {
  gig_missing_location: MapPin,
  gig_missing_fee: Banknote,
  gig_missing_client: UserPlus,
  gig_missing_contact: Mail,
  gig_ready_to_invoice: FileText,
  invoice_overdue: AlertCircle,
  invoice_draft_stale: FileText,
  invoice_ready_to_send: Send,
  invoice_ready_no_email: Download,
  lead_new_unanswered: UserPlus,
  lead_quote_no_reply: Send,
};

const ITEM_COLORS = {
  gig_missing_location: "text-gray-400",
  gig_missing_fee: "text-gray-400",
  gig_missing_client: "text-gray-400",
  gig_missing_contact: "text-gray-400",
  gig_ready_to_invoice: "text-green-400",
  invoice_overdue: "text-red-400",
  invoice_draft_stale: "text-gray-400",
  invoice_ready_to_send: "text-green-400",
  invoice_ready_no_email: "text-green-400",
  lead_new_unanswered: "text-amber-400",
  lead_quote_no_reply: "text-amber-400",
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
  const [resetting, setResetting] = useState(false);
  const [expanded, setExpanded] = useState({}); // group id → members shown
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
    else list = items.filter((i) => i.status !== "grouped"); // members show inside their group

    return list.sort((a, b) => {
      if (a.status === "open" && b.status !== "open") return -1;
      if (a.status !== "open" && b.status === "open") return 1;
      if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [items, tab]);

  const openCount = useMemo(() => items.filter((i) => i.status === "open").length, [items]);

  // Members folded into a group item (status "grouped"), by their stable key.
  const membersOf = useMemo(() => {
    const byKey = new Map(items.filter((i) => i.status === "grouped").map((i) => [itemKey(i), i]));
    return (group) => (group.payload?.member_keys || []).map((k) => byKey.get(k)).filter(Boolean);
  }, [items]);

  function handleAction(item) {
    const target = missionTarget(item);
    if (target) {
      navigate(createPageUrl(target));
    }
  }

  // Chase a quiet lead: send a friendly follow-up with the quote link via
  // Gmail, or fall back to a prefilled mailto draft.
  async function handleChaseLead(item) {
    const p = item.payload || {};
    if (!p.contact_email) {
      handleAction(item);
      return;
    }
    const quoteUrl = p.public_token ? `${window.location.origin}/q/${p.public_token}` : "";
    const firstName = (p.client_name || "").split(" ")[0];
    const profile = await appClient.helpers.ensureSingletonEntity("BusinessProfile").catch(() => null);
    const business = profile?.business_name || "Flowtone";
    const subject = `Following up on your quote${p.event_date ? ` — ${p.event_date}` : ""}`;
    const bodyText = `Hi ${firstName || "there"},\n\nJust checking in — did you get a chance to look at the quote I sent over${p.event_date ? ` for ${p.event_date}` : ""}?\n\n${quoteUrl ? `You can view and accept it here: ${quoteUrl}\n\n` : ""}Happy to answer any questions.\n\n${business}`;
    if (isGmailConnected()) {
      try {
        await sendGmailEmail({
          to: p.contact_email,
          subject,
          htmlBody: bodyText.replace(/\n/g, "<br>"),
        });
        await appClient.entities.Lead.update(item.entity_id, { last_activity_at: new Date().toISOString() }).catch(() => {});
        await appClient.entities.ActionItem.update(item.id, {
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: "user",
        }).catch(() => {});
        loadItems();
        return;
      } catch {
        // fall through to mailto
      }
    }
    window.location.href = `mailto:${p.contact_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
  }

  async function handleMarkSent(item) {
    if (item.entity_type !== "invoice" || !item.entity_id) return;
    const now = new Date().toISOString();
    await appClient.entities.Document.update(item.entity_id, {
      status: "sent",
      sent_date: now,
      is_locked: true,
      locked_at: now,
    }).catch(() => {});
    await appClient.entities.ActionItem.update(item.id, {
      status: "resolved",
      resolved_at: now,
      resolved_by: "user",
    }).catch(() => {});
    loadItems();
  }

  // Full rescan — clears everything except "ignore forever" choices, then
  // rebuilds the list from scratch against current data. Escape hatch for
  // any item that gets stuck or goes stale.
  async function handleReset() {
    if (resetting) return;
    setResetting(true);
    try {
      const toClear = items.filter((i) => i.status !== "dismissed");
      for (const it of toClear) {
        await appClient.entities.ActionItem.delete(it.id).catch(() => {});
      }
      try {
        localStorage.removeItem("flowtone_mission_scan_at");
        localStorage.removeItem("flowtone_mission_scan_data_at");
      } catch { /* ignore */ }
      await runMissionScan().catch(() => {});
    } finally {
      loadItems();
      setResetting(false);
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
      {/* Header — rescan escape hatch */}
      <div className="flex items-center justify-end mb-3">
        <button
          onClick={handleReset}
          disabled={resetting}
          className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${resetting ? "animate-spin" : ""}`} />
          {resetting ? "Rescanning…" : "Rescan"}
        </button>
      </div>

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
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-700/50 text-gray-300">
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
          const isGroup = isGroupItem(item);
          const typeKey = isGroup ? item.payload?.member_type : item.item_type;
          const Icon = ITEM_ICONS[typeKey] || FileText;
          const iconColor = ITEM_COLORS[typeKey] || "text-gray-400";
          const members = isGroup ? membersOf(item) : [];
          const isResolved = item.status === "resolved" || item.status === "dismissed";
          const isOpen = item.status === "open";

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
                  <button
                    onClick={() => navigate(createPageUrl("MissionDetail?id=" + item.id))}
                    className="text-left w-full block"
                  >
                    <p className={`text-sm leading-snug ${isResolved ? "text-gray-500 line-through" : "text-gray-200"}`}>
                      {item.title}
                    </p>
                    <p className="text-[10px] text-gray-600 mt-1">
                      {isResolved
                        ? `${item.status === "dismissed" ? "Ignored" : "Resolved"} ${timeAgo(item.resolved_at || item.dismissed_at || item.updated_at)}`
                        : timeAgo(item.created_at)}
                    </p>
                  </button>

                  {/* Group — one bulk action, members on demand */}
                  {isOpen && isGroup && (
                    <div className="mt-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => handleAction(item)} className="text-xs bg-gray-700/50 border border-gray-700/60 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-700/60 transition-colors">
                          {missionActionLabel(item)}
                        </button>
                        {members.length > 0 && (
                          <button
                            onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                            className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 transition-colors"
                          >
                            {expanded[item.id] ? "Hide" : `Show ${members.length}`}
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded[item.id] ? "rotate-180" : ""}`} />
                          </button>
                        )}
                      </div>
                      {expanded[item.id] && (
                        <div className="mt-2 divide-y divide-gray-700/30 border-t border-gray-700/30">
                          {members.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => handleAction(m)}
                              className="w-full text-left py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                            >
                              {m.payload?.event_title || m.payload?.invoice_title || m.title}
                              {m.payload?.event_date && <span className="text-gray-600"> · {m.payload.event_date}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* One-tap action — full controls live in the ticket */}
                  {isOpen && !isGroup && (
                    <div className="flex flex-wrap items-center gap-2 mt-2.5">
                      {item.item_type === "gig_ready_to_invoice" && item.payload?.has_email && (
                        <>
                          <button onClick={() => handleAction(item)} className="text-xs bg-green-600/20 border border-green-500/30 text-green-300 px-3 py-1 rounded-lg hover:bg-green-600/30 transition-colors">
                            Review Invoice
                          </button>
                          <button onClick={() => handleAction(item)} className="text-xs bg-gray-700/50 border border-gray-700/60 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-700/60 transition-colors">
                            Send
                          </button>
                        </>
                      )}
                      {item.item_type === "gig_ready_to_invoice" && !item.payload?.has_email && (
                        <button onClick={() => handleAction(item)} className="text-xs bg-gray-700/50 border border-gray-700/60 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-700/60 transition-colors">
                          Create Invoice
                        </button>
                      )}

                      {item.item_type === "invoice_ready_to_send" && (
                        item.entity_type === "event" ? (
                          <button onClick={() => handleAction(item)} className="text-xs bg-gray-700/50 border border-gray-700/60 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-700/60 transition-colors">
                            Send
                          </button>
                        ) : (
                          <>
                            <button onClick={() => handleAction(item)} className="text-xs bg-green-600/20 border border-green-500/30 text-green-300 px-3 py-1 rounded-lg hover:bg-green-600/30 transition-colors">
                              Review
                            </button>
                            <button onClick={() => handleAction(item)} className="text-xs bg-gray-700/50 border border-gray-700/60 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-700/60 transition-colors">
                              Send
                            </button>
                          </>
                        )
                      )}

                      {item.item_type === "invoice_ready_no_email" && (
                        item.entity_type === "event" ? (
                          <button onClick={() => handleAction(item)} className="text-xs bg-gray-700/50 border border-gray-700/60 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-700/60 transition-colors">
                            Create Invoice
                          </button>
                        ) : (
                          <>
                            <button onClick={() => handleAction(item)} className="text-xs bg-green-600/20 border border-green-500/30 text-green-300 px-3 py-1 rounded-lg hover:bg-green-600/30 transition-colors">
                              Get PDF
                            </button>
                            <button onClick={() => handleMarkSent(item)} className="text-xs bg-gray-700/50 border border-gray-700/60 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-700/60 transition-colors">
                              Mark sent
                            </button>
                          </>
                        )
                      )}

                      {item.item_type === "invoice_overdue" && (
                        <button onClick={() => handleAction(item)} className="text-xs bg-amber-600/20 border border-amber-500/30 text-amber-300 px-3 py-1 rounded-lg hover:bg-amber-600/30 transition-colors">
                          Chase
                        </button>
                      )}

                      {(item.item_type === "gig_missing_location" ||
                        item.item_type === "gig_missing_fee" ||
                        item.item_type === "gig_missing_client" ||
                        item.item_type === "gig_missing_contact" ||
                        item.item_type === "invoice_draft_stale") && (
                        <button onClick={() => handleAction(item)} className="text-xs bg-gray-700/50 border border-gray-700/60 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-700/60 transition-colors">
                          {item.item_type === "gig_missing_location" && "Add location"}
                          {item.item_type === "gig_missing_fee" && "Add fee"}
                          {item.item_type === "gig_missing_client" && "Add client"}
                          {item.item_type === "gig_missing_contact" && "Add email"}
                          {item.item_type === "invoice_draft_stale" && "Review draft"}
                        </button>
                      )}

                      {item.item_type === "lead_new_unanswered" && (
                        <button onClick={() => handleAction(item)} className="text-xs bg-gray-700/50 border border-gray-700/60 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-700/60 transition-colors">
                          Open lead
                        </button>
                      )}

                      {item.item_type === "lead_quote_no_reply" && (
                        <>
                          <button onClick={() => handleChaseLead(item)} className="text-xs bg-amber-600/20 border border-amber-500/30 text-amber-300 px-3 py-1 rounded-lg hover:bg-amber-600/30 transition-colors">
                            Chase by email
                          </button>
                          <button onClick={() => handleAction(item)} className="text-xs bg-gray-700/50 border border-gray-700/60 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-700/60 transition-colors">
                            Open lead
                          </button>
                        </>
                      )}

                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
