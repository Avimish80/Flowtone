import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";

// Type-and-pick address field. No AI, no API key, no billing: it uses the free
// OpenStreetMap / Nominatim search (the same service the AI venue lookup uses in
// useAIAssistant.js). The user can still free-type any address and ignore the
// suggestions — picking one just fills in the full, real address.

// Short, human label for a Nominatim result (mirrors shortPlaceLabel in
// useAIAssistant.js so the AI picker and this field read the same way).
function shortPlaceLabel(r) {
  const a = r.address || {};
  const name =
    a.amenity || a.building || a.shop || a.tourism || a.leisure ||
    (r.display_name || "").split(",")[0];
  const area = a.city || a.town || a.village || a.suburb || a.county || "";
  return [name, area].filter(Boolean).join(", ") || (r.display_name || "Location");
}

export default function AddressAutocomplete({
  value = "",
  onChange,
  placeholder = "Address or venue name",
  inputClassName = "",
}) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Only search after the user actually types. Without this, loading an event
  // with a saved address would re-trigger the search and pop the dropdown open
  // every single time the ticket is opened — even though the value is already
  // committed. Programmatic value changes (initial load, picking a suggestion)
  // leave this false, so they never search.
  const interactedRef = useRef(false);
  const boxRef = useRef(null);

  // Debounced lookup. Nominatim asks for <=1 req/sec, so wait for a pause in
  // typing, only search 3+ chars, and abort the previous request.
  useEffect(() => {
    if (!interactedRef.current) return;
    const q = value.trim();
    if (q.length < 3) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`,
          { headers: { "User-Agent": "Flowtone/1.0" }, signal: controller.signal }
        );
        const data = await resp.json();
        const list = Array.isArray(data)
          ? data.slice(0, 5).map((r) => ({ label: shortPlaceLabel(r), address: r.display_name }))
          : [];
        setResults(list);
        setOpen(list.length > 0);
      } catch {
        // network/abort — just don't show suggestions; free-typing still works
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [value]);

  // Close the dropdown when tapping outside the field.
  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(address) {
    interactedRef.current = false; // committed value — don't re-search it
    onChange(address);
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        className={inputClassName}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { interactedRef.current = true; onChange(e.target.value); }}
        onFocus={() => results.length > 0 && setOpen(true)}
        autoComplete="off"
      />
      {loading && (
        <Loader2 className="w-4 h-4 text-gray-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden shadow-xl max-h-64 overflow-y-auto">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r.address)}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-800 active:bg-gray-700 transition-colors flex items-start gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm text-white truncate">{r.label}</span>
                  <span className="block text-xs text-gray-500 truncate">{r.address}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
