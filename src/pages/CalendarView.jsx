import { useState, useEffect, useMemo, useRef } from "react";
import { appClient } from "@/api/appClient";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl, currencySymbol } from "@/utils";
import { ChevronLeft, ChevronRight, Plus, List, MapPin, Clock, Users, Car, Navigation, Bus } from "lucide-react";
import { usePageState } from "@/hooks/usePageState";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, addWeeks, subWeeks, addDays, subDays,
  isSameMonth, isSameDay, isToday, parseISO, eachDayOfInterval, getHours, getMinutes
} from "date-fns";

// ── Status colours ──────────────────────────────────────────────────
const STATUS_COLORS = {
  lead:      { bg: "bg-yellow-500",  bar: "bg-yellow-500",  pill: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-300 border-yellow-500/30", dot: "bg-yellow-400" },
  confirmed: { bg: "bg-blue-500",    bar: "bg-blue-500",    pill: "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30", dot: "bg-blue-400" },
  completed: { bg: "bg-green-500",   bar: "bg-green-500",   pill: "bg-green-500/15 text-green-600 dark:text-green-300 border-green-500/30", dot: "bg-green-400" },
  cancelled: { bg: "bg-gray-400",    bar: "bg-gray-400",    pill: "bg-gray-400/15 text-gray-500 border-gray-400/30", dot: "bg-gray-500" },
};
// Practice events always render in teal regardless of status
const PRACTICE_COLOR = { bg: "bg-teal-500", bar: "bg-teal-500", pill: "bg-teal-500/15 text-teal-600 dark:text-teal-300 border-teal-500/30", dot: "bg-teal-400" };
const getEventColors = (event) => event.event_type === "Practice" ? PRACTICE_COLOR : (STATUS_COLORS[event.status] || STATUS_COLORS.lead);

const STATUS_LABELS = { lead: "Tentative", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" };
const HOUR_HEIGHT = 64; // px per hour in week/day grid
const DAY_START   = 7;  // 7 AM
const DAY_END     = 23; // 11 PM
const HOURS       = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);

// ── Helpers ─────────────────────────────────────────────────────────
function buildNavUrl(address, app = "google_maps") {
  const e = encodeURIComponent(address);
  return app === "waze"
    ? `https://waze.com/ul?q=${e}&navigate=yes`
    : `https://www.google.com/maps/dir/?api=1&destination=${e}&travelmode=driving`;
}
function buildUberUrl(addr) {
  return `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${encodeURIComponent(addr)}`;
}
function eventTopPx(event) {
  const timeStr = event.start_time || event.time;
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  return (h - DAY_START) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT;
}
function eventHeightPx(event) {
  // Use start+end times for precise height when available
  if (event.start_time && event.end_time) {
    const [sh, sm] = event.start_time.split(":").map(Number);
    const [eh, em] = event.end_time.split(":").map(Number);
    const durationHours = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
    if (durationHours > 0) return durationHours * HOUR_HEIGHT;
  }
  const durationHours = event.duration_hours || (["Lesson", "Practice"].includes(event.event_type) ? 1 : 2);
  return durationHours * HOUR_HEIGHT;
}
function nowTopPx() {
  const now = new Date();
  return (now.getHours() - DAY_START) * HOUR_HEIGHT + (now.getMinutes() / 60) * HOUR_HEIGHT;
}

// ── Sub-components ───────────────────────────────────────────────────

/** Format a "HH:MM" time string to "H:MMam/pm" display */
function fmtTime(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hh = h % 12 || 12;
  return m === 0 ? `${hh}${suffix}` : `${hh}:${String(m).padStart(2, "0")}${suffix}`;
}

/** Returns a display label: "3pm", "3–4:30pm", falling back to event.time */
function eventTimeLabel(event) {
  const s = event.start_time || event.time;
  const e = event.end_time;
  if (s && e) return `${fmtTime(s)}–${fmtTime(e)}`;
  if (s) return fmtTime(s);
  return null;
}

/** Positioned event block for week / day time grid */
function EventBlock({ event, clientName, top, height, onClick, slim = false }) {
  const c = getEventColors(event);
  const timeLabel = eventTimeLabel(event);
  return (
    <div
      onClick={onClick}
      className={`absolute left-1 right-1 rounded-lg cursor-pointer hover:brightness-110 transition-all overflow-hidden
        ${c.bar} bg-opacity-20 border-l-[3px] ${c.bar.replace("bg-", "border-")}`}
      style={{ top, height: Math.max(height, 24), zIndex: 10 }}
    >
      <div className="px-2 py-1 h-full">
        <p className={`font-semibold leading-tight ${slim ? "text-[11px]" : "text-xs"} text-white`}>{event.title}</p>
        {!slim && timeLabel && <p className="text-[10px] text-white/80">{timeLabel}</p>}
        {!slim && clientName && height > 40 && <p className="text-[10px] text-white/70 truncate">{clientName}</p>}
      </div>
    </div>
  );
}

export default function CalendarView() {
  const navigate = useNavigate();
  const [events, setEvents]     = useState([]);
  const [clients, setClients]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [view, setView]         = usePageState("calendar_view", "month");
  const [currentStr, setCurrentStr] = usePageState("calendar_current", new Date().toISOString());
  const current    = useMemo(() => new Date(currentStr), [currentStr]);
  const setCurrent = (d) => setCurrentStr(d instanceof Date ? d.toISOString() : d);
  const [selectedDay, setSelectedDay] = useState(null); // for month click → day detail
  const [settings, setSettings] = useState(null);
  const timeGridRef = useRef(null);

  const clientMap = useMemo(() => Object.fromEntries(clients.map(c => [c.id, c])), [clients]);

  useEffect(() => {
    sessionStorage.setItem("mos_events_preferCalendar", "true");
    Promise.all([
      appClient.entities.WorkEvent.list("-date", 500),
      appClient.entities.Client.list("name", 200),
      appClient.entities.AppSettings.list(),
    ]).then(([evs, cls, settingsArr]) => {
      setEvents(evs.filter(e => e.date));
      setClients(cls);
      setSettings(settingsArr[0] || null);
      setLoading(false);
    });
  }, []);

  // Scroll time grid to ~7 AM on load
  useEffect(() => {
    if (!loading && timeGridRef.current) {
      timeGridRef.current.scrollTop = 0;
    }
  }, [loading, view]);

  const navigate_cal = (dir) => {
    setSelectedDay(null);
    if (view === "month")      setCurrent(dir > 0 ? addMonths(current, 1) : subMonths(current, 1));
    else if (view === "week")  setCurrent(dir > 0 ? addWeeks(current, 1)  : subWeeks(current, 1));
    else                       setCurrent(dir > 0 ? addDays(current, 1)   : subDays(current, 1));
  };

  const goToday = () => { setCurrent(new Date()); setSelectedDay(null); };

  const headerLabel = () => {
    if (view === "month") return format(current, "MMMM yyyy");
    if (view === "week") {
      const s = startOfWeek(current, { weekStartsOn: 1 });
      const e = endOfWeek(current,   { weekStartsOn: 1 });
      return isSameMonth(s, e) ? `${format(s, "d")}–${format(e, "d MMM yyyy")}` : `${format(s, "d MMM")} – ${format(e, "d MMM yyyy")}`;
    }
    return format(current, "EEEE, d MMMM yyyy");
  };

  const weekDays = () => {
    const s = startOfWeek(current, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  };

  const monthDays = () => {
    const s = startOfWeek(startOfMonth(current), { weekStartsOn: 1 });
    const e = endOfWeek(endOfMonth(current), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: s, end: e });
  };

  const eventsOnDay = (day) => events.filter(e => isSameDay(parseISO(e.date), day));

  const navApp = settings?.default_nav_app || "google_maps";

  // ── MONTH VIEW ────────────────────────────────────────────────────
  const MonthView = () => {
    const days = monthDays();
    return (
      <div className="flex-1 overflow-auto px-2 pb-2">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 sticky top-0 bg-gray-950 dark:bg-gray-950 z-10 pt-1 pb-1">
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
            <div key={d} className="text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider py-1">{d}</div>
          ))}
        </div>
        {/* Cells */}
        <div className="grid grid-cols-7">
          {days.map(day => {
            const inMonth = isSameMonth(day, current);
            const today   = isToday(day);
            const dayEvts = eventsOnDay(day);
            const isSelected = selectedDay && isSameDay(day, selectedDay);
            const dots = dayEvts.slice(0, 3).map(ev => getEventColors(ev).dot);
            const extraCount = dayEvts.length > 3 ? dayEvts.length - 3 : 0;
            return (
              <div
                key={day.toISOString()}
                onClick={() => { setSelectedDay(isSameDay(day, selectedDay) ? null : day); }}
                className={`flex flex-col items-center justify-start py-1.5 cursor-pointer transition-colors h-12
                  ${!inMonth ? "opacity-20" : ""}`}
              >
                {/* Date number */}
                <div className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold transition-all
                  ${today ? "bg-indigo-600 text-white" : ""}
                  ${isSelected && !today ? "ring-2 ring-indigo-400 text-white" : ""}
                  ${!today && !isSelected ? "text-gray-300" : ""}`}>
                  {format(day, "d")}
                </div>
                {/* Event dots */}
                {dayEvts.length > 0 && (
                  <div className="flex items-center justify-center gap-1 mt-1">
                    {dots.map((dotColor, i) => (
                      <span key={i} className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                    ))}
                    {extraCount > 0 && (
                      <span className="text-[8px] text-gray-500 leading-none">+{extraCount}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Day detail panel when a day is selected */}
        {selectedDay && (
          <DayDetailPanel day={selectedDay} onClose={() => setSelectedDay(null)} />
        )}
      </div>
    );
  };

  // ── WEEK VIEW — proper time grid ─────────────────────────────────
  const WeekView = () => {
    const days = weekDays();
    const totalHeight = HOURS.length * HOUR_HEIGHT;
    const now = new Date();
    const nowTop = nowTopPx();
    const showNow = isSameDay(now, days.find(d => isToday(d)) ?? now);

    return (
      <div className="flex-1 overflow-auto" ref={timeGridRef}>
        {/* Day header row */}
        <div className="flex sticky top-0 z-20 bg-gray-950 border-b border-gray-800/50">
          <div className="w-12 flex-shrink-0" />
          {days.map(day => {
            const today = isToday(day);
            return (
              <div key={day.toISOString()} className="flex-1 text-center py-2 border-l border-gray-800/40">
                <p className="text-[10px] font-medium text-gray-500 uppercase">{format(day, "EEE")}</p>
                <div className={`w-7 h-7 mx-auto flex items-center justify-center rounded-full text-sm font-bold mt-0.5
                  ${today ? "bg-indigo-600 text-white" : "text-gray-200"}`}>
                  {format(day, "d")}
                </div>
              </div>
            );
          })}
        </div>

        {/* All-day events row */}
        {days.some(d => eventsOnDay(d).some(e => !e.start_time && !e.time)) && (
          <div className="flex border-b border-gray-800/50 bg-gray-900/30 min-h-[28px]">
            <div className="w-12 flex-shrink-0 flex items-center justify-center">
              <span className="text-[9px] text-gray-600 uppercase">All day</span>
            </div>
            {days.map(day => {
              const allDay = eventsOnDay(day).filter(e => !e.start_time && !e.time);
              return (
                <div key={day.toISOString()} className="flex-1 border-l border-gray-800/40 py-0.5 px-0.5 space-y-0.5">
                  {allDay.map(ev => {
                    const c = getEventColors(ev);
                    return (
                      <div
                        key={ev.id}
                        onClick={() => navigate(createPageUrl(`WorkEventDetail?id=${ev.id}`))}
                        className={`flex items-center gap-1 rounded-md px-1.5 py-px text-[10px] cursor-pointer hover:opacity-80 transition-opacity ${c.bg} bg-opacity-20`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.bar}`} />
                        <span className="truncate font-medium text-white">{ev.title}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Time grid */}
        <div className="flex relative" style={{ height: totalHeight }}>
          {/* Hour labels */}
          <div className="w-12 flex-shrink-0 relative">
            {HOURS.map(h => (
              <div key={h} style={{ position: "absolute", top: (h - DAY_START) * HOUR_HEIGHT - 8, left: 0, right: 0 }}
                className="text-[10px] text-gray-600 text-right pr-2 font-medium">
                {h === 12 ? "12pm" : h > 12 ? `${h-12}pm` : `${h}am`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(day => {
            const today = isToday(day);
            const timedEvts = eventsOnDay(day).filter(e => e.start_time || e.time);
            return (
              <div key={day.toISOString()}
                className={`flex-1 border-l border-gray-800/40 relative ${today ? "bg-indigo-950/10" : ""}`}>
                {/* Hour lines */}
                {HOURS.map(h => (
                  <div key={h} className="border-t border-gray-800/40 absolute left-0 right-0"
                    style={{ top: (h - DAY_START) * HOUR_HEIGHT }} />
                ))}
                {/* Half-hour lines */}
                {HOURS.map(h => (
                  <div key={`${h}h`} className="border-t border-gray-800/20 border-dashed absolute left-0 right-0"
                    style={{ top: (h - DAY_START) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
                ))}
                {/* Current time indicator */}
                {today && nowTop >= 0 && nowTop <= HOURS.length * HOUR_HEIGHT && (
                  <div className="absolute left-0 right-0 z-20 flex items-center"
                    style={{ top: nowTop }}>
                    <div className="w-2 h-2 bg-red-500 rounded-full -ml-1 flex-shrink-0" />
                    <div className="flex-1 h-px bg-red-500" />
                  </div>
                )}
                {/* Events */}
                {timedEvts.map(ev => {
                  const top = eventTopPx(ev);
                  const height = eventHeightPx(ev);
                  if (top === null || top < 0) return null;
                  return (
                    <EventBlock
                      key={ev.id}
                      event={ev}
                      clientName={clientMap[ev.client_id]?.name}
                      top={top}
                      height={height}
                      slim={height < 40}
                      onClick={() => navigate(createPageUrl(`WorkEventDetail?id=${ev.id}`))}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── DAY VIEW — rich timeline ─────────────────────────────────────
  const DayView = () => {
    const dayEvts   = eventsOnDay(current);
    const timedEvts = dayEvts
      .filter(e => e.start_time || e.time)
      .sort((a, b) => (a.start_time || a.time || "").localeCompare(b.start_time || b.time || ""));
    const allDay = dayEvts.filter(e => !e.start_time && !e.time);
    const totalHeight = HOURS.length * HOUR_HEIGHT;
    const now = new Date();
    const nowTop = isToday(current) ? nowTopPx() : null;

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* All-day strip */}
        {allDay.length > 0 && (
          <div className="flex-shrink-0 px-4 py-2 border-b border-gray-800/50 bg-gray-900/30">
            <p className="text-[10px] text-gray-500 uppercase mb-1">All day</p>
            <div className="space-y-1">
              {allDay.map(ev => (
                <Link key={ev.id} to={createPageUrl(`WorkEventDetail?id=${ev.id}`)}>
                  <DayEventCard event={ev} clientName={clientMap[ev.client_id]?.name} navApp={navApp} />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Time grid */}
        <div className="flex-1 overflow-auto" ref={timeGridRef}>
          <div className="flex relative" style={{ height: totalHeight }}>
            {/* Hour labels */}
            <div className="w-14 flex-shrink-0 relative flex-none">
              {HOURS.map(h => (
                <div key={h} style={{ position: "absolute", top: (h - DAY_START) * HOUR_HEIGHT - 8, left: 0, right: 0 }}
                  className="text-[10px] text-gray-500 text-right pr-3 font-medium">
                  {h === 12 ? "12pm" : h > 12 ? `${h-12}pm` : `${h}am`}
                </div>
              ))}
            </div>

            {/* Single day column */}
            <div className="flex-1 border-l border-gray-800/40 relative">
              {HOURS.map(h => (
                <div key={h} className="border-t border-gray-800/40 absolute left-0 right-0"
                  style={{ top: (h - DAY_START) * HOUR_HEIGHT }} />
              ))}
              {HOURS.map(h => (
                <div key={`${h}h`} className="border-t border-gray-800/20 border-dashed absolute left-0 right-0"
                  style={{ top: (h - DAY_START) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
              ))}
              {nowTop !== null && nowTop >= 0 && (
                <div className="absolute left-0 right-0 z-20 flex items-center" style={{ top: nowTop }}>
                  <div className="w-2.5 h-2.5 bg-red-500 rounded-full -ml-1.5 flex-shrink-0" />
                  <div className="flex-1 h-0.5 bg-red-500" />
                </div>
              )}
              {/* Expanded event blocks */}
              {timedEvts.map(ev => {
                const top = eventTopPx(ev);
                const height = eventHeightPx(ev);
                if (top === null || top < 0) return null;
                const c = getEventColors(ev);
                const clientName = clientMap[ev.client_id]?.name;
                return (
                  <div
                    key={ev.id}
                    onClick={() => navigate(createPageUrl(`WorkEventDetail?id=${ev.id}`))}
                    className={`absolute left-1 right-1 rounded-xl cursor-pointer hover:brightness-110 transition-all overflow-hidden border-l-[3px] ${c.bar.replace("bg-","border-")} ${c.bar} bg-opacity-15`}
                    style={{ top, height: Math.max(height, 48), zIndex: 10 }}
                  >
                    <div className="p-2 h-full flex flex-col gap-0.5">
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-sm font-bold text-white leading-tight flex-1">{ev.title}</p>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold border flex-shrink-0 ${c.pill}`}>
                          {STATUS_LABELS[ev.status] || ev.status}
                        </span>
                      </div>
                      {height > 40 && (
                        <div className="text-xs text-white/80 space-y-0.5">
                          {eventTimeLabel(ev) && <p className="flex items-center gap-1"><Clock className="w-3 h-3" />{eventTimeLabel(ev)}</p>}
                          {clientName && <p className="flex items-center gap-1"><Users className="w-3 h-3" />{clientName}</p>}
                          {ev.location_address && height > 80 && (
                            <p className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3 flex-shrink-0" />{ev.location_address}</p>
                          )}
                        </div>
                      )}
                      {/* Navigation buttons if location and block is big enough */}
                      {ev.location_address && height >= 140 && (
                        <div className="flex gap-1 mt-1">
                          <a href={buildNavUrl(ev.location_address, navApp)} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="flex-1 bg-white/20 hover:bg-white/30 text-white text-[10px] rounded-lg py-1 flex items-center justify-center gap-0.5 transition-colors">
                            <Car className="w-3 h-3" /> Drive
                          </a>
                          <a href={buildUberUrl(ev.location_address)} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="flex-1 bg-white/20 hover:bg-white/30 text-white text-[10px] rounded-lg py-1 flex items-center justify-center gap-0.5 transition-colors">
                            <Navigation className="w-3 h-3" /> Taxi
                          </a>
                          <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ev.location_address)}&travelmode=transit`}
                            target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="flex-1 bg-white/20 hover:bg-white/30 text-white text-[10px] rounded-lg py-1 flex items-center justify-center gap-0.5 transition-colors">
                            <Bus className="w-3 h-3" /> Transit
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Day detail panel (shown below month grid when day clicked) ───
  const DayDetailPanel = ({ day, onClose }) => {
    const dayEvts = eventsOnDay(day).sort((a, b) => (a.start_time || a.time || "").localeCompare(b.start_time || b.time || ""));
    return (
      <div className="mt-3 bg-gray-900 rounded-2xl overflow-hidden border border-gray-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">{format(day, "EEEE")}</p>
            <p className="font-bold text-white">{format(day, "d MMMM yyyy")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to={createPageUrl(`WorkEventDetail?date=${format(day, "yyyy-MM-dd")}`)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors">
              <Plus className="w-3 h-3" /> Add
            </Link>
            <button onClick={onClose} className="text-gray-500 hover:text-white text-xs px-2 py-1.5 transition-colors">✕</button>
          </div>
        </div>
        {dayEvts.length === 0 ? (
          <p className="text-center text-gray-600 text-sm py-8">Nothing scheduled</p>
        ) : (
          <div className="divide-y divide-gray-800">
            {dayEvts.map(ev => (
              <DayEventCard key={ev.id} event={ev} clientName={clientMap[ev.client_id]?.name} navApp={navApp} asRow />
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Rich event card for day/panel views ──────────────────────────
  function DayEventCard({ event, clientName, navApp, asRow = false }) {
    const c = getEventColors(event);
    if (asRow) {
      return (
        <div
          onClick={() => navigate(createPageUrl(`WorkEventDetail?id=${event.id}`))}
          className="flex items-start gap-3 px-4 py-3 hover:bg-gray-800/50 cursor-pointer transition-colors"
        >
          <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${c.bar}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="font-semibold text-white text-sm truncate">{event.title}</p>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold border flex-shrink-0 ${c.pill}`}>
                {STATUS_LABELS[event.status] || event.status}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
              {event.event_type && <span>{event.event_type}</span>}
              {eventTimeLabel(event) && <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{eventTimeLabel(event)}</span>}
              {clientName && <span className="flex items-center gap-0.5"><Users className="w-3 h-3" />{clientName}</span>}
            </div>
            {event.location_address && (
              <p className="flex items-center gap-1 text-xs text-gray-500 mt-1 truncate">
                <MapPin className="w-3 h-3 flex-shrink-0" />{event.location_address}
              </p>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0 mt-0.5" />
        </div>
      );
    }
    return (
      <Link to={createPageUrl(`WorkEventDetail?id=${event.id}`)} className="block">
        <div className={`bg-gray-800 rounded-xl p-3 border-l-[3px] ${c.bar.replace("bg-","border-")}`}>
          <div className="flex items-center gap-2 mb-1">
            <p className="font-semibold text-white text-sm">{event.title}</p>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium ${c.pill}`}>
              {STATUS_LABELS[event.status] || event.status}
            </span>
          </div>
          {eventTimeLabel(event) && <p className="text-xs text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{eventTimeLabel(event)}</p>}
          {clientName && <p className="text-xs text-gray-400 flex items-center gap-1"><Users className="w-3 h-3" />{clientName}</p>}
          {event.location_address && (
            <p className="text-xs text-gray-500 flex items-center gap-1 mt-1 truncate"><MapPin className="w-3 h-3 flex-shrink-0" />{event.location_address}</p>
          )}
          {event.location_address && (
            <div className="flex gap-2 mt-2">
              <a href={buildNavUrl(event.location_address, navApp)} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1 text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded-lg transition-colors">
                <Car className="w-3 h-3" /> Drive
              </a>
              <a href={buildUberUrl(event.location_address)} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1 text-[10px] bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded-lg transition-colors">
                <Navigation className="w-3 h-3" /> Taxi
              </a>
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(event.location_address)}&travelmode=transit`}
                target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1 text-[10px] bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded-lg transition-colors">
                <Bus className="w-3 h-3" /> Transit
              </a>
            </div>
          )}
        </div>
      </Link>
    );
  }

  // Unused import suppression
  const _unused = { currencySymbol };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-gray-950">
      {/* ── Top Controls ─────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-gray-800 bg-gray-950">
        {/* Month/period navigator */}
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => navigate_cal(-1)} className="p-2 text-gray-400 hover:text-white transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={goToday} className="text-base font-bold text-white hover:text-indigo-400 transition-colors">
            {headerLabel()}
          </button>
          <button onClick={() => navigate_cal(1)} className="p-2 text-gray-400 hover:text-white transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* View tabs + actions */}
        <div className="flex items-center gap-2">
          {/* View switcher */}
          <div className="flex gap-1 bg-gray-800 rounded-lg p-1 flex-1">
            {["month","week","day"].map(v => (
              <button key={v} onClick={() => { setView(v); setSelectedDay(null); }}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors
                  ${view === v ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}>
                {v}
              </button>
            ))}
          </div>

          {/* Actions */}
          <button onClick={() => { sessionStorage.setItem("mos_events_preferCalendar","false"); navigate(createPageUrl("WorkEvents")); }}
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors" title="List view">
            <List className="w-4 h-4" />
          </button>
          <Link to={createPageUrl(`WorkEventDetail?date=${format(selectedDay ?? current, "yyyy-MM-dd")}`)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg flex items-center gap-1 text-xs font-semibold transition-colors">
            <Plus className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {view === "month" && <MonthView />}
          {view === "week"  && <WeekView />}
          {view === "day"   && <DayView />}
        </div>
      )}
    </div>
  );
}
