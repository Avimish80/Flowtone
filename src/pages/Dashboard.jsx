import { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { Link } from "react-router-dom";
import { createPageUrl, formatMoney } from "@/utils";
import {
  CalendarDays, ChevronRight, MapPin, Clock, Navigation, Car, AlertCircle, Plus, Mic2, Users
} from "lucide-react";
import { format, isToday, isTomorrow, parseISO, isPast, startOfDay, addDays, differenceInDays, differenceInHours, differenceInMinutes } from "date-fns";
import { AIDashboardBriefing } from "@/components/AIDashboardBriefing";
import { useAuth } from "@/lib/AuthContext";
import { isPreviewModeEnabled } from "@/lib/supabaseClient";
import { getCachedProfileSync, deriveFallbackName } from "@/lib/assistantProfile";

function buildNavUrl(address, app = "google_maps") {
  const encoded = encodeURIComponent(address);
  if (app === "waze") return `https://waze.com/ul?q=${encoded}&navigate=yes`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;
}

/** Parse a YYYY-MM-DD string as LOCAL midnight (avoids UTC-shift in BST) */
function parseLocalDate(dateStr) {
  return new Date(dateStr + "T00:00:00");
}

function isEventDone(event, now) {
  if (event.status === "completed") return true;
  const time = event.end_time || event.start_time;
  if (!time) return false;
  const [h, m] = time.split(":").map(Number);
  const end = parseLocalDate(event.date);
  end.setHours(h || 0, m || 0, 0, 0);
  return end < now;
}

function getCountdown(dateStr, timeStr) {
  const now = new Date();
  let target = parseLocalDate(dateStr);
  if (timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    target.setHours(h || 0, m || 0, 0, 0);
  }
  const days = differenceInDays(target, now);
  const hours = differenceInHours(target, now) % 24;
  const mins = differenceInMinutes(target, now) % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return "Now";
}

function getDayLabel(dateStr) {
  const d = parseLocalDate(dateStr);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEE d MMM");
}

export default function Dashboard() {
  const [events, setEvents] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const profile = getCachedProfileSync();

  const clientMap = useMemo(() => Object.fromEntries(clients.map(c => [c.id, c])), [clients]);

  useEffect(() => {
    Promise.all([
      appClient.entities.WorkEvent.list("date"),
      appClient.entities.Document.list("-created_at"),
      appClient.entities.Client.list(),
      appClient.entities.AppSettings.list(),
    ]).then(([evts, docs, cls, settingsArr]) => {
      setEvents(evts);
      setDocuments(docs);
      setClients(cls);
      setSettings(settingsArr[0] || null);
      setLoading(false);
    });
  }, []);

  const now = new Date();
  const todayStart = startOfDay(now);
  const upcoming = events
    .filter(e => e.status !== "cancelled" && e.date && startOfDay(parseLocalDate(e.date)) >= todayStart)
    .sort((a, b) => {
      const da = parseLocalDate(a.date).getTime();
      const db = parseLocalDate(b.date).getTime();
      if (da !== db) return da - db;
      return (a.start_time || "").localeCompare(b.start_time || "");
    });

  // First event that isn't already done — finished events shouldn't sit in "Next Up"
  const nextGig = upcoming.find(e => !isEventDone(e, now)) || null;
  const weekEvents = upcoming.filter(e => {
    const d = parseLocalDate(e.date);
    return d <= addDays(now, 7) && e.id !== nextGig?.id;
  });

  const todayStr = format(now, "yyyy-MM-dd");
  const todayEvents = events.filter(e => e.date === todayStr && e.status !== "cancelled");
  const doneTodayCount = todayEvents.filter(e => isEventDone(e, now)).length;
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // Preview mode's stub user would derive "Flowtone" — show no name instead
  const fallbackName = isPreviewModeEnabled() ? "" : deriveFallbackName(user);
  const firstName = (profile?.user_name || fallbackName || "").trim();
  const nextGigFee = nextGig ? Number(nextGig.total_price ?? nextGig.base_price) || 0 : 0;
  const showDrive = Boolean(nextGig && nextGig.date === todayStr && nextGig.location_address);

  const invoices = documents.filter(d => d.document_type === "invoice");
  const overdueInvoices = invoices.filter(i =>
    i.status === "sent" && i.due_date && isPast(parseISO(i.due_date))
  );
  const overdueCount = overdueInvoices.length;
  const unpaidCount = invoices.filter(i => i.status === "sent").length;

  const navApp = settings?.default_nav_app || "google_maps";

  if (loading) {
    return (
      <div className="p-4 max-w-xl mx-auto space-y-4">
        <div className="bg-gray-800 rounded-2xl h-48 animate-pulse" />
        <div className="bg-gray-800 rounded-2xl h-32 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-xl mx-auto space-y-5">

      {/* ── Hero: greeting + Next Up in one card ── */}
      <div className="bg-gradient-to-br from-indigo-900/80 to-gray-900 rounded-2xl border border-indigo-700/30 overflow-hidden">
        <div className="px-5 pt-4 pb-3.5">
          <h1 className="text-lg font-semibold text-white">
            {greeting}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="text-xs text-indigo-200/70 mt-0.5">
            {todayEvents.length > 0
              ? `${doneTodayCount} of ${todayEvents.length} complete today`
              : format(now, "EEEE d MMMM")}
          </p>
        </div>

        {nextGig ? (
          <div className="border-t border-indigo-700/30 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Next Up</span>
              <span className="text-xs bg-indigo-600/40 text-indigo-200 px-2.5 py-0.5 rounded-full font-medium">
                {getCountdown(nextGig.date, nextGig.start_time)}
              </span>
            </div>

            <Link to={createPageUrl(`WorkEventDetail?id=${nextGig.id}`)} className="block mb-4">
              <h2 className="text-xl font-bold text-white mb-1">{nextGig.title || "Untitled Gig"}</h2>
              <div className="flex items-center gap-3 text-sm text-gray-300 flex-wrap">
                <span className="flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5 text-indigo-400" />
                  {getDayLabel(nextGig.date)}
                </span>
                {nextGig.start_time && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    {nextGig.start_time}{nextGig.end_time ? "–" + nextGig.end_time : ""}
                  </span>
                )}
                {clientMap[nextGig.client_id] && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                    {clientMap[nextGig.client_id].name}
                  </span>
                )}
                {nextGigFee > 0 && (
                  <span className="font-medium text-gray-200">
                    {formatMoney(nextGigFee, nextGig.currency || settings?.currency).replace(/\.00$/, "")}
                  </span>
                )}
              </div>
              {nextGig.location_address && (
                <p className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{nextGig.location_address}</span>
                </p>
              )}
            </Link>

            {/* Directions always when there's an address; Drive Mode only for today's gig */}
            {nextGig.location_address && (
              <div className={`grid gap-2 ${showDrive ? "grid-cols-2" : "grid-cols-1"}`}>
                <a
                  href={buildNavUrl(nextGig.location_address, navApp)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors"
                >
                  <Navigation className="w-4 h-4" />
                  Directions
                </a>
                {showDrive && (
                  <Link
                    to={createPageUrl("DrivingMode")}
                    className="bg-gray-700/60 hover:bg-gray-600 text-white rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors border border-gray-600/50"
                  >
                    <Car className="w-4 h-4" />
                    Drive
                  </Link>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="border-t border-indigo-700/30 p-6 text-center">
            <Mic2 className="w-8 h-8 text-gray-500 mx-auto mb-2" />
            <p className="text-gray-400 text-sm mb-3">No upcoming gigs</p>
            <Link
              to={createPageUrl("WorkEventDetail")}
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Event
            </Link>
          </div>
        )}
      </div>

      {/* ── New event (minimal) ── */}
      {nextGig && (
        <div className="flex justify-end -mt-2">
          <Link
            to={createPageUrl("WorkEventDetail")}
            className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 transition-colors"
          >
            <Plus className="w-3 h-3" /> New event
          </Link>
        </div>
      )}

      {/* ── AI Briefing ── */}
      <AIDashboardBriefing events={events} documents={documents} />

      {/* ── Overdue Alert ── */}
      {overdueCount > 0 && (
        <Link
          to={overdueCount === 1
            ? createPageUrl(`DocumentDetail?id=${overdueInvoices[0].id}`)
            : createPageUrl("Finance?filter=overdue")}
          className="flex items-center gap-3 bg-red-950/40 border border-red-800/30 rounded-xl px-4 py-3 transition-colors hover:bg-red-950/60"
        >
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-300 font-medium">
              {overdueCount} overdue invoice{overdueCount > 1 ? "s" : ""}
            </p>
            {overdueCount === 1 && overdueInvoices[0].client_name && (
              <p className="text-xs text-red-400/70 truncate">{overdueInvoices[0].client_name}</p>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-red-500" />
        </Link>
      )}

      {/* ── This Week ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-200 text-sm uppercase tracking-wider">This Week</h2>
          <Link to={createPageUrl("WorkEvents")} className="text-xs text-indigo-400">See all</Link>
        </div>
        {weekEvents.length === 0 ? (
          <div className="bg-gray-800/50 rounded-xl p-5 text-center text-gray-500 text-sm">
            No more events this week
          </div>
        ) : (
          <div className="space-y-2">
            {weekEvents.map(event => {
              const clientName = clientMap[event.client_id]?.name;
              return (
                <Link key={event.id} to={createPageUrl(`WorkEventDetail?id=${event.id}`)} className="block">
                  <div className="bg-gray-800 rounded-xl px-4 py-3 flex items-center gap-3 active:bg-gray-700 transition-colors">
                    <div className="flex-shrink-0 w-10 text-center">
                      <p className="text-xs text-gray-500">{format(parseLocalDate(event.date), "EEE")}</p>
                      <p className="text-lg font-bold text-white leading-tight">{format(parseLocalDate(event.date), "d")}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate text-sm">{event.title}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {event.start_time ? event.start_time + (event.end_time ? "–" + event.end_time : "") : ""}{event.start_time && clientName ? " · " : ""}{clientName || ""}
                        {event.location_address ? ` · ${event.location_address}` : ""}
                      </p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${
                      event.status === "confirmed" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                      event.status === "completed" ? "bg-green-500/20 text-green-400 border-green-500/30" :
                      "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                    }`}>
                      {{ lead: "Tentative", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" }[event.status] || event.status}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ── At a Glance (compact, not dominating) ── */}
      <div className="grid grid-cols-3 gap-3">
        <Link to={createPageUrl("WorkEvents?filter=confirmed")} className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-3 text-center transition-colors">
          <p className="text-xl font-bold text-white">{events.filter(e => e.status === "confirmed").length}</p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Confirmed</p>
        </Link>
        <Link to={createPageUrl("WorkEvents?filter=lead")} className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-3 text-center transition-colors">
          <p className="text-xl font-bold text-white">{events.filter(e => e.status === "lead").length}</p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Tentative</p>
        </Link>
        <Link to={createPageUrl("Finance?filter=sent")} className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-3 text-center transition-colors">
          <p className={`text-xl font-bold ${unpaidCount > 0 ? "text-yellow-400" : "text-green-400"}`}>{unpaidCount}</p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Unpaid</p>
        </Link>
      </div>
    </div>
  );
}
