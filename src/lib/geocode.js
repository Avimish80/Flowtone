import { appClient } from "@/api/appClient";

// Shared place search. Both the type-and-pick address field
// (AddressAutocomplete) and the AI's venue lookup (LOCATION_SEARCH) go through
// here so results are biased to where the musician actually works.
//
// Two free services, no keys:
//  1. Photon (komoot) — fuzzy, name-first search over OpenStreetMap. This is
//     what makes "raffles owo" find "Raffles London at The OWO". Biased by a
//     lat/lon for the user's country.
//  2. Nominatim — the strict address geocoder. Used only when Photon errors or
//     finds nothing, so a plain street address still resolves.

const DEFAULT_COUNTRY = "gb";

// Where to centre Photon's bias for a country: its main city for a musician.
const COUNTRY_BIAS = {
  gb: [51.5074, -0.1278],
  ie: [53.3498, -6.2603],
  us: [40.7128, -74.006],
  ca: [43.6532, -79.3832],
  au: [-33.8688, 151.2093],
  nz: [-36.8485, 174.7633],
  fr: [48.8566, 2.3522],
  de: [52.52, 13.405],
  nl: [52.3676, 4.9041],
  be: [50.8503, 4.3517],
  es: [40.4168, -3.7038],
  pt: [38.7223, -9.1393],
  it: [41.9028, 12.4964],
  ch: [47.3769, 8.5417],
  at: [48.2082, 16.3738],
  se: [59.3293, 18.0686],
  no: [59.9139, 10.7522],
  dk: [55.6761, 12.5683],
  il: [32.0853, 34.7818],
};

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

function dedupeJoin(parts) {
  const seen = new Set();
  return parts
    .map((p) => (p || "").trim())
    .filter((p) => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()))
    .join(", ");
}

// Photon feature → { label, address }
function fromPhoton(f) {
  const p = f.properties || {};
  const name = p.name || p.street || "";
  const streetLine = [p.housenumber, p.street].filter(Boolean).join(" ");
  const area = p.city || p.town || p.village || p.district || p.county || "";
  const label = dedupeJoin([name, area]) || "Location";
  const address = dedupeJoin([name, streetLine, p.district, area, p.postcode, p.country]);
  return { label, address: address || label };
}

async function searchPhoton(q, { limit, signal, countryCode, lang }) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  // Photon only speaks a few languages; anything else falls back to local names.
  const short = (lang || "en").slice(0, 2).toLowerCase();
  params.set("lang", ["en", "de", "fr"].includes(short) ? short : "en");
  const bias = COUNTRY_BIAS[countryCode];
  if (bias) {
    params.set("lat", String(bias[0]));
    params.set("lon", String(bias[1]));
  }
  const resp = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, { signal });
  if (!resp.ok) throw new Error(`photon ${resp.status}`);
  const data = await resp.json();
  const feats = Array.isArray(data?.features) ? data.features : [];
  return feats
    .filter((f) => {
      // With a bias set, keep results in the user's country so a London user
      // isn't offered the Raffles in Singapore first.
      const cc = (f.properties?.countrycode || "").toLowerCase();
      return !bias || !cc || cc === countryCode;
    })
    .slice(0, limit)
    .map(fromPhoton);
}

async function searchNominatim(q, { limit, signal, countryCode, lang }) {
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
    { signal }
  );
  const data = await resp.json();
  if (!Array.isArray(data)) return [];
  return data
    .slice(0, limit)
    .map((r) => ({ label: shortPlaceLabel(r), address: r.display_name }));
}

// Search places, biased to the user's region. Returns [{ label, address }].
// Pass an AbortSignal to cancel in-flight requests (debounced typing).
export async function searchPlaces(query, { limit = 5, signal } = {}) {
  const q = (query || "").trim();
  if (!q) return [];

  const { countryCode } = await getUserRegion();
  const lang =
    (typeof navigator !== "undefined" && navigator.language) || "en-GB";
  const opts = { limit, signal, countryCode, lang };

  try {
    const hits = await searchPhoton(q, opts);
    if (hits.length > 0) return hits;
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    // Photon down or blocked — fall through to Nominatim
  }
  return searchNominatim(q, opts);
}
