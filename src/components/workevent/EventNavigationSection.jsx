import { Navigation, Car, Bus, CircleSlash } from "lucide-react";

function buildGoogleMapsUrl(address, mode = "driving") {
  const encoded = encodeURIComponent(address);
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=${mode}`;
}

function buildWazeUrl(address) {
  const encoded = encodeURIComponent(address);
  return `https://waze.com/ul?q=${encoded}&navigate=yes`;
}

function buildUberUrl(address) {
  const encoded = encodeURIComponent(address);
  return `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${encoded}`;
}

export default function EventNavigationSection({ event }) {
  const address = event.location_address;

  if (!address) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
        <CircleSlash className="w-4 h-4" />
        Add a location address to enable navigation
      </div>
    );
  }

  const navApp = event.default_nav_app || "google_maps";
  const driveUrl = navApp === "waze" ? buildWazeUrl(address) : buildGoogleMapsUrl(address, "driving");

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 truncate">{address}</p>
      <div className="grid grid-cols-3 gap-2">
        <a
          href={driveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl p-3 flex flex-col items-center gap-1.5 text-xs font-medium transition-colors"
        >
          <Car className="w-5 h-5" />
          Drive
          <span className="text-blue-200 text-[10px]">{navApp === "waze" ? "Waze" : "Google"}</span>
        </a>

        <a
          href={buildUberUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-gray-800 hover:bg-gray-700 text-white rounded-xl p-3 flex flex-col items-center gap-1.5 text-xs font-medium transition-colors border border-gray-700"
        >
          <Navigation className="w-5 h-5" />
          Taxi
          <span className="text-gray-400 text-[10px]">Uber</span>
        </a>

        <a
          href={buildGoogleMapsUrl(address, "transit")}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-gray-800 hover:bg-gray-700 text-white rounded-xl p-3 flex flex-col items-center gap-1.5 text-xs font-medium transition-colors border border-gray-700"
        >
          <Bus className="w-5 h-5" />
          Transit
          <span className="text-gray-400 text-[10px]">Google</span>
        </a>
      </div>
    </div>
  );
}