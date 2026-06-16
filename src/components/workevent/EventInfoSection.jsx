import { MapPin, Clock, Calendar, User, Tag, RefreshCw, Loader2, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { appClient } from "@/api/appClient";
import AddressAutocomplete from "@/components/AddressAutocomplete";

/** Parse "HH:MM" → total minutes */
function toMins(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Return "Xh Ym" label from start_time + end_time strings, or null */
function durationLabel(start, end) {
  const s = toMins(start), e = toMins(end);
  if (s == null || e == null || e <= s) return null;
  const mins = e - s;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Convert start_time + end_time → decimal hours for the calendar */
function toDurationHours(start, end) {
  const s = toMins(start), e = toMins(end);
  if (s == null || e == null || e <= s) return null;
  return (e - s) / 60;
}

const EVENT_TYPES = ["Gig", "Lesson", "Session", "Rehearsal", "Tour Day", "Residency", "Practice"];
const STATUSES = ["lead", "confirmed", "completed", "cancelled"];
const STATUS_LABELS = { lead: "Tentative", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" };
const FREQ_OPTIONS = ["daily", "weekly", "monthly", "yearly"];
const DOW_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DOW_MAP = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun mapped to JS day values

const inputCls = "w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-sm";
const labelCls = "text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5 block";

export default function EventInfoSection({ event, onChange, clients }) {
  const [creatingSeriesLoading, setCreatingSeriesLoading] = useState(false);
  const [seriesDone, setSeriesDone] = useState(false);

  const rule = event.recurrence_rule || {};
  const hasRule = !!rule.frequency;

  const updateRule = (field, value) => onChange("recurrence_rule", { ...rule, [field]: value });
  const toggleDay = (dayIdx) => {
    const days = rule.days_of_week || [];
    updateRule("days_of_week", days.includes(dayIdx) ? days.filter(d => d !== dayIdx) : [...days, dayIdx]);
  };

  const handleCreateSeries = async () => {
    if (!event.id) return;
    setCreatingSeriesLoading(true);
    const res = await appClient.functions.invoke("createRecurringEvents", { event_id: event.id });
    setCreatingSeriesLoading(false);
    if (res.data?.success) {
      setSeriesDone(true);
      onChange("is_recurring", true);
      onChange("recurrence_id", res.data.recurrence_id);
    }
  };

  return (
    <div className="space-y-4">

      {/* Title */}
      <div>
        <label className={labelCls}>Title</label>
        <input
          className={inputCls}
          placeholder="Event title"
          value={event.title || ""}
          onChange={e => onChange("title", e.target.value)}
        />
      </div>

      {/* Type + Status */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls + " flex items-center gap-1"}><Tag className="w-3 h-3" />Type</label>
          <select
            className={inputCls}
            value={event.event_type || "Gig"}
            onChange={e => onChange("event_type", e.target.value)}
          >
            {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select
            className={inputCls}
            value={event.status || "lead"}
            onChange={e => onChange("status", e.target.value)}
          >
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      </div>

      {/* Client */}
      <div>
        <label className={labelCls + " flex items-center gap-1"}><User className="w-3 h-3" />Client</label>
        <select
          className={inputCls}
          value={event.client_id || ""}
          onChange={e => onChange("client_id", e.target.value)}
        >
          <option value="">No client</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Date */}
      <div>
        <label className={labelCls + " flex items-center gap-1"}><Calendar className="w-3 h-3" />Date</label>
        <input
          type="date"
          className={inputCls}
          value={event.date || ""}
          onChange={e => onChange("date", e.target.value)}
        />
      </div>

      {/* Time */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className={labelCls + " flex items-center gap-1 mb-0"}><Clock className="w-3 h-3" />Time</label>
          {durationLabel(event.start_time, event.end_time) && (
            <span className="text-xs text-indigo-400 font-medium bg-indigo-900/30 px-2 py-0.5 rounded-full">
              {durationLabel(event.start_time, event.end_time)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-gray-500 mb-1">Start</p>
            <input
              type="time"
              className={inputCls}
              value={event.start_time || ""}
              onChange={e => {
                const start = e.target.value;
                onChange("start_time", start);
                onChange("time", start);
                const dh = toDurationHours(start, event.end_time);
                if (dh) onChange("duration_hours", dh);
              }}
            />
          </div>
          <div>
            <p className="text-[11px] text-gray-500 mb-1">End</p>
            <input
              type="time"
              className={inputCls}
              value={event.end_time || ""}
              onChange={e => {
                const end = e.target.value;
                onChange("end_time", end);
                const dh = toDurationHours(event.start_time, end);
                if (dh) onChange("duration_hours", dh);
              }}
            />
          </div>
        </div>
      </div>

      {/* Location */}
      <div>
        <label className={labelCls + " flex items-center gap-1"}><MapPin className="w-3 h-3" />Location</label>
        <AddressAutocomplete
          inputClassName={inputCls}
          placeholder="Address or venue name"
          value={event.location_address || ""}
          onChange={val => onChange("location_address", val)}
        />
      </div>

      {/* Notes */}
      <div>
        <label className={labelCls}>Notes / Dress Code</label>
        <textarea
          className={inputCls + " resize-none"}
          placeholder="Notes, dress code, parking info…"
          rows={3}
          value={event.notes || ""}
          onChange={e => onChange("notes", e.target.value)}
        />
      </div>

      {/* Recurrence */}
      <div className="border-t border-gray-700/60 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-sm font-medium text-gray-300">Recurring Event</span>
            {event.is_recurring && (
              <span className="text-xs bg-indigo-900/60 text-indigo-300 border border-indigo-700/40 px-2 py-0.5 rounded-full">Active</span>
            )}
          </div>
          <button
            onClick={() => {
              if (hasRule) onChange("recurrence_rule", null);
              else onChange("recurrence_rule", { frequency: "weekly", interval: 1, end_type: "count", count: 4 });
            }}
            className={`w-9 h-5 rounded-full transition-colors relative ${hasRule ? "bg-indigo-600" : "bg-gray-700"}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${hasRule ? "left-4" : "left-0.5"}`} />
          </button>
        </div>

        {hasRule && (
          <div className="mt-3 bg-gray-800/60 rounded-xl p-3 space-y-3 border border-gray-700/50">
            {/* Frequency */}
            <div className="grid grid-cols-4 gap-1">
              {FREQ_OPTIONS.map(f => (
                <button key={f} onClick={() => updateRule("frequency", f)}
                  className={`py-1.5 rounded-lg text-xs font-medium capitalize transition-colors
                    ${rule.frequency === f ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Interval */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Every</span>
              <input type="number" min={1} max={52}
                className="w-14 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-indigo-500"
                value={rule.interval || 1}
                onChange={e => updateRule("interval", parseInt(e.target.value) || 1)}
              />
              <span className="text-xs text-gray-400">
                {rule.frequency === "daily" ? "day(s)" : rule.frequency === "weekly" ? "week(s)" : rule.frequency === "monthly" ? "month(s)" : "year(s)"}
              </span>
            </div>

            {/* Days of week (weekly) */}
            {rule.frequency === "weekly" && (
              <div className="flex gap-1">
                {DOW_LABELS.map((label, i) => (
                  <button key={i} onClick={() => toggleDay(DOW_MAP[i])}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors
                      ${(rule.days_of_week || []).includes(DOW_MAP[i]) ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* End type */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => updateRule("end_type", "count")}
                className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${rule.end_type === "count" ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
              >After N times</button>
              <button onClick={() => updateRule("end_type", "until")}
                className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${rule.end_type === "until" ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
              >Until date</button>
            </div>
            {rule.end_type === "count" ? (
              <div className="flex items-center gap-2">
                <input type="number" min={2} max={365}
                  className="w-16 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-indigo-500"
                  value={rule.count || 4}
                  onChange={e => updateRule("count", parseInt(e.target.value) || 4)}
                />
                <span className="text-xs text-gray-400">occurrences (including this one)</span>
              </div>
            ) : (
              <input type="date"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-indigo-500"
                value={rule.until || ""}
                onChange={e => updateRule("until", e.target.value)}
              />
            )}

            {/* Create series button */}
            {event.id && !event.is_recurring && (
              <button onClick={handleCreateSeries} disabled={creatingSeriesLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                {creatingSeriesLoading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating...</>
                  : <><RefreshCw className="w-3.5 h-3.5" /> Create Recurring Series</>}
              </button>
            )}

            {seriesDone && (
              <div className="flex items-center gap-2 text-green-400 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5" /> Series created successfully
              </div>
            )}

            {event.is_recurring && (
              <p className="text-xs text-indigo-300">
                Part of a recurring series{event.recurrence_index != null ? ` (occurrence #${event.recurrence_index + 1})` : ""}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
