import { appClient } from "@/api/appClient";

// The musician's app-wide preferred currency, chosen at onboarding and
// editable in Settings. Individual events/invoices can still carry their own
// currency, which always takes precedence — this is only the default used
// wherever a record doesn't specify one.

const FALLBACK = "GBP";

// undefined = not loaded yet; a string once loaded
let cached;

/** Read the preferred currency from AppSettings and cache it. */
export async function loadPreferredCurrency({ fresh = false } = {}) {
  if (cached !== undefined && !fresh) return cached;
  try {
    const settings = (await appClient.entities.AppSettings.list("created_at"))[0];
    cached = settings?.currency || settings?.default_currency || FALLBACK;
  } catch {
    cached = FALLBACK;
  }
  return cached;
}

/** Synchronous getter — returns the cached currency, or GBP until loaded. */
export function getPreferredCurrency() {
  return cached ?? FALLBACK;
}

/** Update the cache immediately (e.g. when the user changes it in Settings). */
export function setPreferredCurrency(code) {
  if (code) cached = code;
}
