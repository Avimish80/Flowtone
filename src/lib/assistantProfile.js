import { appClient } from "@/api/appClient";

export const DEFAULT_ASSISTANT_NAME = "Flow";
export const DEFAULT_LANGUAGE = "English";

// undefined = not loaded yet; null = loaded, no profile saved
let cachedProfile;

export function deriveFallbackName(user) {
  const meta = user?.user_metadata;
  const full = meta?.full_name || meta?.name || "";
  if (full) return full.split(" ")[0];
  const email = user?.email || "";
  const prefix = email.split("@")[0].split(".")[0];
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

export async function getAssistantProfile({ fresh = false } = {}) {
  if (cachedProfile !== undefined && !fresh) return cachedProfile;
  // Read-only: never creates the singleton, so hot paths (AI chat, briefing)
  // can't race the get-or-create. Creation happens once in saveAssistantProfile.
  const settings = (await appClient.entities.AppSettings.list("created_at"))[0];
  cachedProfile = settings?.assistant_profile || null;
  return cachedProfile;
}

export function getCachedProfileSync() {
  return cachedProfile ?? null;
}

export async function saveAssistantProfile(partial) {
  const settings = await appClient.helpers.ensureSingletonEntity("AppSettings");
  const merged = { version: 1, ...(settings.assistant_profile || {}), ...partial };
  await appClient.entities.AppSettings.update(settings.id, { assistant_profile: merged });
  cachedProfile = merged;
  return merged;
}

export function isOnboarded(profile) {
  return Boolean(profile && (profile.completed_at || profile.skipped));
}
