import { NOTIF_SCHEMA } from "@/lib/notificationPrefs";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

/**
 * Full-mode notification preferences editor.
 * Shows all 5 layers with per-type toggles and timing selectors.
 *
 * Props:
 *   prefs       — current notification_prefs object (from settings)
 *   onChange    — (key, field, value) => void
 */
export default function NotificationPrefsEditor({ prefs = {}, onChange }) {
  const [openLayers, setOpenLayers] = useState(new Set([1, 2])); // layers 1+2 open by default

  const toggleLayer = (layer) => {
    setOpenLayers(prev => {
      const next = new Set(prev);
      next.has(layer) ? next.delete(layer) : next.add(layer);
      return next;
    });
  };

  const getPref = (key) => prefs[key] ?? {};
  const isEnabled = (key) => getPref(key).enabled ?? false;

  const handleToggle = (key) => {
    const current = getPref(key);
    onChange(key, "enabled", !current.enabled);
  };

  const handleTiming = (key, timingKey, value) => {
    onChange(key, timingKey, value);
  };

  return (
    <div className="space-y-2 mt-3">
      {NOTIF_SCHEMA.map(({ layer, label, emoji, types }) => (
        <div key={layer} className="rounded-xl overflow-hidden border border-gray-700/60">
          {/* Layer header */}
          <button
            onClick={() => toggleLayer(layer)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-900/60 hover:bg-gray-900 transition-colors"
          >
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
              {emoji} {label}
            </span>
            {openLayers.has(layer)
              ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
              : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
            }
          </button>

          {/* Notification types */}
          {openLayers.has(layer) && (
            <div className="divide-y divide-gray-700/40 bg-gray-800/40">
              {types.map(({ key, label: typeLabel, example, timingKey, timingOptions }) => {
                const enabled = isEnabled(key);
                const pref = getPref(key);
                return (
                  <div key={key} className="px-3 py-3">
                    {/* Toggle row */}
                    <div className="flex items-start gap-3">
                      {/* Toggle */}
                      <button
                        onClick={() => handleToggle(key)}
                        className={`mt-0.5 flex-shrink-0 w-9 h-5 rounded-full transition-colors relative ${
                          enabled ? "bg-indigo-600" : "bg-gray-600"
                        }`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${
                          enabled ? "translate-x-4" : "translate-x-0.5"
                        }`} />
                      </button>

                      {/* Label + example */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium leading-tight ${enabled ? "text-white" : "text-gray-400"}`}>
                          {typeLabel}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5 leading-snug italic">{example}</p>
                      </div>
                    </div>

                    {/* Timing selector — only shown when enabled and has options */}
                    {enabled && timingKey && timingOptions && (
                      <div className="mt-2 ml-12">
                        <div className="flex flex-wrap gap-1.5">
                          {timingOptions.map(({ value, label: optLabel }) => {
                            const isSelected = (pref[timingKey] ?? timingOptions[1]?.value ?? timingOptions[0]?.value) === value;
                            return (
                              <button
                                key={String(value)}
                                onClick={() => handleTiming(key, timingKey, value)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors border ${
                                  isSelected
                                    ? "bg-indigo-600 border-indigo-500 text-white"
                                    : "bg-gray-900 border-gray-700 text-gray-400 hover:text-gray-200"
                                }`}
                              >
                                {optLabel}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
