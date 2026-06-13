import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { flowtoneJson } from "@/lib/flowtoneApi";
import { isPreviewModeEnabled } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Sparkles, X } from "lucide-react";
import { isPast, parseISO } from "date-fns";
import { getCachedProfileSync, deriveFallbackName, DEFAULT_LANGUAGE, DEFAULT_ASSISTANT_NAME } from "@/lib/assistantProfile";

function buildNavUrl(address) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function AIDashboardBriefing({ events = [], documents = [] }) {
  const today = new Date().toISOString().slice(0, 10);
  const timeOfDay = getTimeOfDay();
  // Profile cache is warm: OnboardingGate loads it before any page mounts
  const profile = getCachedProfileSync();
  const language = profile?.language || DEFAULT_LANGUAGE;
  const cacheKey = `flowtone_briefing_${today}_${timeOfDay}_${language}`;
  const dismissKey = `flowtone_briefing_dismissed_${today}`;

  const [briefing, setBriefing] = useState(() => {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(!briefing);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(dismissKey) === "1");
  const navigate = useNavigate();
  const { user } = useAuth();

  const eventMap = useMemo(
    () => Object.fromEntries(events.map((e) => [e.id, e])),
    [events]
  );

  useEffect(() => {
    if (isPreviewModeEnabled()) {
      setLoading(false);
      return;
    }

    // Already have today's briefing for this part of the day — no refetch
    if (briefing) {
      setLoading(false);
      return;
    }

    const todayEvents = events
      .filter((e) => e.date === today && e.status !== "cancelled")
      .slice(0, 3)
      .map((e) => ({
        id: e.id,
        title: e.title,
        start_time: e.start_time,
        location_address: e.location_address,
      }));

    const invoices = documents.filter((d) => d.document_type === "invoice");
    const overdueInvoices = invoices
      .filter((i) => i.status === "sent" && i.due_date && isPast(parseISO(i.due_date)))
      .slice(0, 3)
      .map((i) => ({ id: i.id, title: i.title, client_name: i.client_name, due_date: i.due_date }));

    const invoicedEventIds = new Set(invoices.map((i) => i.work_event_id).filter(Boolean));
    const noInvoiceEvents = events
      .filter(
        (e) =>
          e.status !== "cancelled" &&
          (e.base_price > 0 || e.total_price > 0) &&
          !invoicedEventIds.has(e.id) &&
          e.date >= today
      )
      .slice(0, 3)
      .map((e) => ({ id: e.id, title: e.title, date: e.date, total_price: e.total_price || e.base_price }));

    flowtoneJson("/api/ai/briefing", {
      method: "POST",
      body: JSON.stringify({
        today,
        timeOfDay,
        name: profile?.user_name || deriveFallbackName(user),
        language,
        assistantName: profile?.assistant_name || "",
        todayEvents,
        overdueInvoices,
        noInvoiceEvents,
      }),
    })
      .then((data) => {
        setBriefing(data);
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(data));
        } catch {
          // storage full or unavailable — briefing just won't be cached
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleItemAction(item, actionType) {
    if (actionType === "navigate") {
      const event = eventMap[item.entity_id];
      if (event?.location_address) {
        window.open(buildNavUrl(event.location_address), "_blank", "noopener,noreferrer");
      }
    } else if (actionType === "create_invoice") {
      navigate(createPageUrl(`DocumentDetail?event_id=${item.entity_id}&type=invoice`));
    } else if (item.entity_type === "event") {
      navigate(createPageUrl(`WorkEventDetail?id=${item.entity_id}`));
    } else if (item.entity_type === "invoice") {
      navigate(createPageUrl(`DocumentDetail?id=${item.entity_id}`));
    }
  }

  if (dismissed) return null;
  if (isPreviewModeEnabled()) return null;

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

  if (!briefing || !briefing.items?.length) return null;

  return (
    <div className="rounded-2xl border border-gray-700/40 bg-gray-900/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/30">
        {/* Greeting lives in the Dashboard hero now — header is just the assistant's name */}
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
          <span className="text-sm font-medium text-gray-200 truncate">
            {profile?.assistant_name || DEFAULT_ASSISTANT_NAME}
          </span>
        </div>
        <button
          onClick={() => {
            setDismissed(true);
            try {
              sessionStorage.setItem(dismissKey, "1");
            } catch {
              // unavailable storage — dismissal just won't persist
            }
          }}
          className="text-gray-600 hover:text-gray-400 transition-colors ml-3 flex-shrink-0"
          aria-label="Dismiss briefing"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Items */}
      <div className="divide-y divide-gray-700/30">
        {briefing.items.map((item, i) => {
          const hasEntity = item.entity_id && item.type !== "general";
          const event = item.entity_type === "event" ? eventMap[item.entity_id] : null;
          const hasLocation = event?.location_address;

          return (
            <div key={i} className="px-4 py-3">
              <p className="text-sm text-gray-300 leading-snug mb-2">{item.text}</p>

              {hasEntity && (
                <div className="flex flex-wrap gap-2">
                  {/* View button — always shown for entity items */}
                  <button
                    onClick={() => handleItemAction(item, "view")}
                    className="text-xs bg-gray-700/60 border border-gray-600/40 text-gray-300 px-3 py-1 rounded-lg hover:bg-gray-600/60 active:bg-gray-700 transition-colors"
                  >
                    View
                  </button>

                  {/* Navigate — only for events with an address */}
                  {item.entity_type === "event" && hasLocation && (
                    <button
                      onClick={() => handleItemAction(item, "navigate")}
                      className="text-xs bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-lg hover:bg-indigo-600/40 active:bg-indigo-600/50 transition-colors"
                    >
                      Navigate
                    </button>
                  )}

                  {/* Chase — overdue invoices */}
                  {item.type === "invoice_overdue" && (
                    <button
                      onClick={() => handleItemAction(item, "view")}
                      className="text-xs bg-amber-600/20 border border-amber-500/30 text-amber-300 px-3 py-1 rounded-lg hover:bg-amber-600/30 transition-colors"
                    >
                      Chase
                    </button>
                  )}

                  {/* Create Invoice — events missing one */}
                  {item.type === "invoice_missing" && (
                    <button
                      onClick={() => handleItemAction(item, "create_invoice")}
                      className="text-xs bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-lg hover:bg-indigo-600/40 transition-colors"
                    >
                      Create Invoice
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
