import { NOTIF_SCHEMA } from "@/lib/notificationPrefs";

/** Small iOS-style switch. Knob is anchored left and slides within the track. */
export function Toggle({ on, onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-indigo-600" : "bg-gray-700"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
          on ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

/**
 * Full-mode notification preferences editor.
 * Flat list grouped by plain labels — one toggle per type, timing as a dropdown.
 *
 * Props:
 *   prefs       — current notification_prefs object (from settings)
 *   onChange    — (key, field, value) => void
 */
export default function NotificationPrefsEditor({ prefs = {}, onChange }) {
  const getPref = (key) => prefs[key] ?? {};

  return (
    <div className="space-y-5">
      {NOTIF_SCHEMA.map(({ layer, label, types }) => (
        <div key={layer}>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
          <div className="divide-y divide-gray-700/40">
            {types.map(({ key, label: typeLabel, example, timingKey, timingOptions }) => {
              const pref = getPref(key);
              const enabled = pref.enabled ?? false;
              const hasTiming = Boolean(timingKey && timingOptions);
              const timingValue = hasTiming
                ? (pref[timingKey] ?? timingOptions[1]?.value ?? timingOptions[0]?.value)
                : null;
              return (
                <div key={key} className="py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-tight ${enabled ? "text-gray-200" : "text-gray-500"}`}>
                      {typeLabel}
                    </p>
                    {enabled && hasTiming ? (
                      <select
                        value={String(timingValue)}
                        onChange={(e) => {
                          // option values can be numbers (days_before) — restore the original type
                          const opt = timingOptions.find(o => String(o.value) === e.target.value);
                          onChange(key, timingKey, opt ? opt.value : e.target.value);
                        }}
                        className="mt-0.5 max-w-full bg-transparent text-xs text-indigo-400 focus:outline-none cursor-pointer"
                      >
                        {timingOptions.map(o => (
                          <option key={String(o.value)} value={String(o.value)} className="bg-gray-900 text-gray-200">
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-[11px] text-gray-600 truncate">{example}</p>
                    )}
                  </div>
                  <Toggle on={enabled} onClick={() => onChange(key, "enabled", !enabled)} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
