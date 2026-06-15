import { useState } from "react";
import { RefreshCw, Loader2, CheckCircle2 } from "lucide-react";
import { appClient } from "@/api/appClient";

const FREQ_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function RecurrenceSection({ event, onChange }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState(null);

  const rule = event.recurrence_rule || {};
  const isRecurring = event.is_recurring;

  const updateRule = (field, value) => {
    onChange("recurrence_rule", { ...rule, [field]: value });
  };

  const toggleDay = (dayIdx) => {
    const days = rule.days_of_week || [];
    const updated = days.includes(dayIdx) ? days.filter(d => d !== dayIdx) : [...days, dayIdx];
    updateRule("days_of_week", updated);
  };

  const handleCreateSeries = async () => {
    if (!event.id) return;
    setLoading(true);
    setDone(false);
    // Route through the shared engine so this matches the AI path exactly,
    // including open-ended ("No end") series that auto-extend over time. The
    // existing event is adopted as occurrence #0 (not duplicated).
    const res = await appClient.helpers.createRecurringSeries({
      template: event,
      rule,
      startDate: event.date,
      anchorEventId: event.id,
    });
    setLoading(false);
    if (res?.success) {
      setDone(true);
      setResult({ created_count: res.created, open_ended: res.open_ended });
      onChange("is_recurring", true);
      onChange("recurrence_id", res.recurrence_id);
    }
  };

  const hasRule = rule.frequency;

  return (
    <div className="space-y-4">
      {/* Enable recurrence */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-200 font-medium">Recurring Event</p>
          <p className="text-xs text-gray-500">Generate a series of events automatically</p>
        </div>
        <button
          onClick={() => {
            if (hasRule) {
              onChange("recurrence_rule", null);
            } else {
              onChange("recurrence_rule", { frequency: "weekly", interval: 1, end_type: "count", count: 4 });
            }
          }}
          className={`w-10 h-6 rounded-full transition-colors ${hasRule ? "bg-indigo-600" : "bg-gray-700"}`}
        >
          <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${hasRule ? "translate-x-4" : "translate-x-0"}`} />
        </button>
      </div>

      {hasRule && (
        <>
          {/* Frequency */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Frequency</label>
            <div className="grid grid-cols-4 gap-1">
              {FREQ_OPTIONS.map(f => (
                <button
                  key={f.value}
                  onClick={() => updateRule("frequency", f.value)}
                  className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    rule.frequency === f.value
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Interval */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Every
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={52}
                className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                value={rule.interval || 1}
                onChange={e => updateRule("interval", parseInt(e.target.value) || 1)}
              />
              <span className="text-sm text-gray-400">
                {rule.frequency === "daily" ? "day(s)" :
                 rule.frequency === "weekly" ? "week(s)" :
                 rule.frequency === "monthly" ? "month(s)" : "year(s)"}
              </span>
            </div>
          </div>

          {/* Days of week (weekly only) */}
          {rule.frequency === "weekly" && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">On days</label>
              <div className="flex gap-1">
                {DOW_LABELS.map((label, idx) => (
                  <button
                    key={idx}
                    onClick={() => toggleDay(idx)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      (rule.days_of_week || []).includes(idx)
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* End type */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">End</label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <button
                onClick={() => updateRule("end_type", "never")}
                className={`py-2 rounded-lg text-sm font-medium transition-colors ${rule.end_type === "never" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
              >
                No end
              </button>
              <button
                onClick={() => updateRule("end_type", "count")}
                className={`py-2 rounded-lg text-sm font-medium transition-colors ${rule.end_type === "count" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
              >
                After N times
              </button>
              <button
                onClick={() => updateRule("end_type", "until")}
                className={`py-2 rounded-lg text-sm font-medium transition-colors ${rule.end_type === "until" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
              >
                Until date
              </button>
            </div>
            {rule.end_type === "never" ? (
              <p className="text-xs text-gray-500">Ongoing — Flowtone keeps about six months of lessons in your calendar and adds more automatically.</p>
            ) : rule.end_type === "count" ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={2}
                  max={365}
                  className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                  value={rule.count || 4}
                  onChange={e => updateRule("count", parseInt(e.target.value) || 4)}
                />
                <span className="text-sm text-gray-400">occurrences</span>
              </div>
            ) : (
              <input
                type="date"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                value={rule.until || ""}
                onChange={e => updateRule("until", e.target.value)}
              />
            )}
          </div>

          {/* Create series button */}
          {event.id && !isRecurring && (
            <button
              onClick={handleCreateSeries}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating series...</>
              ) : (
                <><RefreshCw className="w-4 h-4" /> Create Recurring Series</>
              )}
            </button>
          )}

          {done && result && (
            <div className="bg-green-950/50 border border-green-700/40 rounded-xl p-3 flex items-center gap-2 text-green-400 text-sm">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              Created {result.created_count} more event{result.created_count === 1 ? "" : "s"} in the series
              {result.open_ended ? " — it'll keep extending automatically." : "."}
            </div>
          )}

          {isRecurring && (
            <div className="bg-indigo-950/50 border border-indigo-700/40 rounded-xl p-3 text-indigo-300 text-sm">
              ✓ This event is part of a recurring series
              {event.recurrence_index != null && ` (occurrence #${event.recurrence_index + 1})`}
            </div>
          )}
        </>
      )}
    </div>
  );
}