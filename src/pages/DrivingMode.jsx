import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Navigation, Car, Bus, Clock, MapPin, Calendar, Music2 } from "lucide-react";
import { format, parseISO, isToday, isTomorrow, addDays } from "date-fns";

function buildNavUrl(address, app = "google_maps") {
  const encoded = encodeURIComponent(address);
  if (app === "waze") return `https://waze.com/ul?q=${encoded}&navigate=yes`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;
}

function buildUberUrl(address) {
  return `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${encodeURIComponent(address)}`;
}

export default function DrivingMode() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [navApp, setNavApp] = useState("google_maps"); // from AppSettings.default_nav_app

  useEffect(() => {
    // Fetch next 7 days of confirmed events with locations
    appClient.entities.WorkEvent.filter({ status: "confirmed" }, "date", 50).then(data => {
      const now = new Date();
      const week = addDays(now, 7);
      const upcoming = data.filter(e => {
        if (!e.date || !e.location_address) return false;
        const d = parseISO(e.date);
        return d >= now && d <= week;
      });
      setEvents(upcoming);
      setLoading(false);
    });
    // Preferred nav app lives on AppSettings (per-user), not on the event.
    appClient.entities.AppSettings.list().then(rows => {
      const s = rows?.[0];
      if (s?.default_nav_app) setNavApp(s.default_nav_app);
    }).catch(() => {});
  }, []);

  const dayLabel = (dateStr) => {
    const d = parseISO(dateStr);
    if (isToday(d)) return "Today";
    if (isTomorrow(d)) return "Tomorrow";
    return format(d, "EEE d MMM");
  };

  return (
    <div className="p-4 max-w-xl mx-auto">

      {loading ? (
        <div className="space-y-4">{[1,2].map(i => <div key={i} className="bg-gray-800 rounded-2xl h-36 animate-pulse" />)}</div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Navigation className="w-12 h-12 mb-4 opacity-20" />
          <p className="text-center text-sm">No confirmed events with locations<br />in the next 7 days</p>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map(event => (
            <div key={event.id} className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Music2 className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    <p className="font-semibold text-white truncate">{event.title}</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {dayLabel(event.date)}
                    </span>
                    {event.start_time && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {event.start_time}{event.end_time ? "–" + event.end_time : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{event.location_address}</span>
                  </div>
                </div>
              </div>

              {/* Navigation buttons */}
              <div className="grid grid-cols-3 gap-2">
                <a
                  href={buildNavUrl(event.location_address, navApp)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl py-3 flex flex-col items-center gap-1 text-xs font-medium transition-colors"
                >
                  <Car className="w-5 h-5" />
                  Drive
                  <span className="text-blue-200 text-[10px]">{navApp === "waze" ? "Waze" : "Google"}</span>
                </a>
                <a
                  href={buildUberUrl(event.location_address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-gray-700 hover:bg-gray-600 text-white rounded-xl py-3 flex flex-col items-center gap-1 text-xs font-medium transition-colors border border-gray-600"
                >
                  <Navigation className="w-5 h-5" />
                  Taxi
                  <span className="text-gray-400 text-[10px]">Uber</span>
                </a>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(event.location_address)}&travelmode=transit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-gray-700 hover:bg-gray-600 text-white rounded-xl py-3 flex flex-col items-center gap-1 text-xs font-medium transition-colors border border-gray-600"
                >
                  <Bus className="w-5 h-5" />
                  Transit
                  <span className="text-gray-400 text-[10px]">Google</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}