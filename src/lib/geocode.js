import { appClient } from "@/api/appClient";

// Shared geocoding helper. Both the type-and-pick address field
// (AddressAutocomplete) and the AI's venue lookup (LOCATION_SEARCH) go through
// here so results are biased to where the musician actually works. Without a
// country bias, the free OpenStreetMap / Nominatim service ranks results
// globally — which skews heavily American — so a London user searching
// "Blue Note" gets the New York club first. Free-typing any address still
// works; the bias only affects which suggestions rank highest.

const DEFAULT_COUNTRY = "gb";

// undefined = not loaded yet; object once loaded. Cached so hot paths (typing in
// the address field, AI venue lookups) don't re-fetch the profile every call.
let cachedRegion;

// Read the user's country from their BusinessProfile (read-only — never creates
// the singleton). Falls back to GB when unset.
export async function getUserRegion({ fresh = false } = {}) {
  if (cachedRegion !== undefined && !fresh) return cachedRegion;
  let countryCode = DEFAULT_COUNTRY;
  try {
    const profile = (await appClient.entities.BusinessProfile.list())[0];
    const cc = (profile?.country || "").trim().toLowerCase();
    if (cc) countryCode = cc;
  } catch {
    // network/preview hiccup — keep the default
  }
  cachedRegion = { countryCode };
  return cachedRegion;
}

export function getCachedRegionSync() {
  return cachedRegion ?? { countryCode: DEFAULT_COUNTRY };
}

// Build a short, human label for a place from a Nominatim result.
export function shortPlaceLabel(r) {
  const a = r.address || {};
  const name =
    a.amenity || a.building || a.shop || a.tourism || a.leisure ||
    (r.display_name || "").split(",")[0];
  const area = a.city || a.town || a.village || a.suburb || a.county || "";
  return [name, area].filter(Boolean).join(", ") || (r.display_name || "Location");
}

// Search places, biased to the user's region. Returns [{ label, address }].
// Pass an AbortSignal to cancel in-flight requests (debounced typing).
export async function searchPlaces(query, { limit = 5, signal } = {}) {
  const q = (query || "").trim();
  if (!q) return [];

  const { countryCode } = await getUserRegion();
  const lang =
    (typeof navigator !== "undefined" && navigator.language) || "en-GB";

  const params = new URLSearchParams({
    format: "json",
    addressdetails: "1",
    limit: String(limit),
    q,
  });
  if (countryCode) params.set("countrycodes", countryCode);
  // Nominatim's accept-language query param overrides the request header, which
  // browsers may strip on cross-origin fetches — so set it explicitly.
  params.set("accept-language", lang);

  const resp = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    { headers: { "User-Agent": "Flowtone/1.0" }, signal }
  );
  const data = await resp.json();
  if (!Array.isArray(data)) return [];
  return data
    .slice(0, limit)
    .map((r) => ({ label: shortPlaceLabel(r), address: r.display_name }));
}
