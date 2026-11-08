import { useState, useEffect, useCallback } from "react";
import { CalendarDays, ListChecks, Smartphone } from "lucide-react";
import {
  isNativeApp, getDeviceAccess, requestCalendarAccess, requestRemindersAccess,
  listDeviceEvents, listDeviceReminders,
} from "@/lib/nativeDevice";
import { getCalendarLink, unlinkCalendars } from "@/lib/deviceCalendarSync";
import { format, parseISO } from "date-fns";
import DeviceCalendarLink from "@/components/settings/DeviceCalendarLink";

// Settings → Connections row for the iOS app only: grants Calendar/Reminders
// access and shows a live count so the user can see it actually reads.
export default function DeviceAccessRow() {
  const [access, setAccess] = useState(null);
  const [counts, setCounts] = useState({ events: null, reminders: null });
  const [error, setError] = useState("");
  const [link, setLink] = useState(getCalendarLink);
  const [showLink, setShowLink] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const a = await getDeviceAccess();
      setAccess(a);
      const next = { events: null, reminders: null };
      if (a.calendar === "granted") {
        const from = new Date();
        const to = new Date(Date.now() + 30 * 86400000);
        next.events = (await listDeviceEvents(from, to)).length;
      }
      if (a.reminders === "granted") next.reminders = (await listDeviceReminders()).length;
      setCounts(next);
      setError("");
    } catch (e) {
      setError(e?.message || "Could not read device access");
    }
  }, []);

  useEffect(() => { if (isNativeApp()) refresh(); }, [refresh]);

  if (!isNativeApp()) return null;

  const rows = [
    {
      key: "calendar", icon: CalendarDays, label: "iPhone Calendar",
      detail: counts.events != null ? `${counts.events} events in the next 30 days` : "All your calendars — iCloud, Google, Outlook",
      request: requestCalendarAccess,
    },
    {
      key: "reminders", icon: ListChecks, label: "Reminders",
      detail: counts.reminders != null ? `${counts.reminders} open reminders` : "Read and add reminders",
      request: requestRemindersAccess,
    },
  ];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <p className="text-sm font-medium text-gray-200">On this iPhone</p>
      </div>
      {rows.map(({ key, icon: Icon, label, detail, request }) => {
        const state = access?.[key];
        return (
          <div key={key} className="flex items-center justify-between gap-3 pl-6">
            <div className="min-w-0">
              <p className="text-sm text-gray-300 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5 text-gray-500" />{label}</p>
              <p className="text-[11px] text-gray-500 truncate">{state === "denied" ? "Turned off — enable in iOS Settings → Flowtone" : detail}</p>
            </div>
            {state === "granted" ? (
              <span className="text-xs text-green-400 flex-shrink-0">On</span>
            ) : state === "denied" ? (
              <span className="text-xs text-gray-500 flex-shrink-0">Off</span>
            ) : (
              <button onClick={async () => { await request(); refresh(); }}
                className="text-sm font-medium text-ink hover:text-ink/80 flex-shrink-0">
                Allow
              </button>
            )}
          </div>
        );
      })}
      {access?.calendar === "granted" && (
        <div className="pl-6 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-500 min-w-0 truncate">
            {link
              ? `Linked ${link.calendarIds.length} calendar${link.calendarIds.length > 1 ? "s" : ""} · since ${format(parseISO(link.fromDate), "d MMM yyyy")}`
              : "Turn calendar events into gigs"}
          </p>
          <div className="flex items-center gap-3 flex-shrink-0">
            {link && (
              <button onClick={() => { unlinkCalendars(); setLink(null); }}
                className="text-xs text-gray-500 hover:text-gray-300">Unlink</button>
            )}
            <button onClick={() => setShowLink(true)} className="text-sm font-medium text-ink hover:text-ink/80">
              {link ? "Edit" : "Link calendar"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-400 pl-6">{error}</p>}
      {showLink && (
        <DeviceCalendarLink onClose={() => { setShowLink(false); setLink(getCalendarLink()); refresh(); }} />
      )}
    </div>
  );
}
