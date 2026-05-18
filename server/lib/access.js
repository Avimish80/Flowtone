import { getSupabaseAdmin } from "./supabaseAdmin.js";

function toIsoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function profileHasAccess(profile) {
  const status = profile?.subscription_status || "trialing";
  if (status === "active") return true;
  if (status !== "trialing") return false;
  if (!profile?.trial_ends_at) return true;

  const trialEndsAt = new Date(profile.trial_ends_at);
  if (Number.isNaN(trialEndsAt.getTime())) return false;
  return trialEndsAt.getTime() > Date.now();
}

export async function ensureProfileForUser(user) {
  const supabaseAdmin = getSupabaseAdmin();
  const fullName = user.user_metadata?.full_name || user.user_metadata?.name || "";

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .upsert({
      id: user.id,
      email: user.email || "",
      full_name: fullName,
    }, { onConflict: "id" })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export function serializeAccessState(user, profile) {
  return {
    user_id: user.id,
    email: user.email || profile?.email || "",
    has_access: profileHasAccess(profile),
    subscription_status: profile?.subscription_status || "trialing",
    plan_name: profile?.plan_name || null,
    trial_ends_at: profile?.trial_ends_at || null,
    billing_customer_id: profile?.billing_customer_id || null,
  };
}

export async function getAccessStateForUser(user) {
  const profile = await ensureProfileForUser(user);
  return serializeAccessState(user, profile);
}

export async function updateProfileById(userId, changes) {
  const supabaseAdmin = getSupabaseAdmin();
  const payload = {
    ...changes,
    updated_at: new Date().toISOString(),
  };

  if ("trial_ends_at" in payload) {
    payload.trial_ends_at = toIsoOrNull(payload.trial_ends_at);
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update(payload)
    .eq("id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateProfileByCustomerId(customerId, changes) {
  const supabaseAdmin = getSupabaseAdmin();
  const payload = {
    ...changes,
    updated_at: new Date().toISOString(),
  };

  if ("trial_ends_at" in payload) {
    payload.trial_ends_at = toIsoOrNull(payload.trial_ends_at);
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update(payload)
    .eq("billing_customer_id", customerId)
    .select("*");

  if (error) throw error;
  return data || [];
}

