import { useState, useRef, useEffect } from "react";
import { ArrowUpDown } from "lucide-react";

const DIR_LABELS = {
  asc:  { date: "Oldest first", text: "A → Z", number: "Low → High" },
  desc: { date: "Newest first", text: "Z → A", number: "High → Low" },
};

/**
 * Compact sort dropdown reused across all list pages.
 *
 * @param {Array}    options       [{ key, label, type: "date"|"text"|"number" }]
 * @param {Object}   activeSort    { key, direction: "asc"|"desc" }
 * @param {Function} onSortChange  (newSort) => void
 */
export default function SortDropdown({ options, activeSort, onSortChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = options.find(o => o.key === activeSort.key);
  const dirLabel = active ? DIR_LABELS[activeSort.direction]?.[active.type] || "" : "";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium transition-colors"
        title={dirLabel}
      >
        <ArrowUpDown className="w-4 h-4" />
        <span className="max-w-[5rem] truncate">{active?.label || "Sort"}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[11rem] max-h-72 overflow-y-auto">
            {options.map(opt => {
              const isActive = activeSort.key === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => {
                    if (isActive) {
                      onSortChange({ key: opt.key, direction: activeSort.direction === "desc" ? "asc" : "desc" });
                    } else {
                      onSortChange({ key: opt.key, direction: opt.type === "text" ? "asc" : "desc" });
                    }
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                    isActive ? "bg-indigo-600/20 text-indigo-300" : "text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  <span>{opt.label}</span>
                  {isActive && (
                    <span className="text-[10px] text-gray-400 flex-shrink-0">
                      {DIR_LABELS[activeSort.direction]?.[opt.type] || activeSort.direction}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
