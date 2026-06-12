import { API_BASE_URL } from "@/lib/apiBase";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabaseClient";

async function getAccessToken() {
  if (!isSupabaseConfigured) return null;
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export async function flowtoneFetch(path, options = {}) {
  const { accessToken, timeoutMs = 15000, ...requestOptions } = options;
  const token = accessToken || await getAccessToken();
  const headers = new Headers(requestOptions.headers || {});

  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && requestOptions.body && !(requestOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...requestOptions,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function flowtoneJson(path, options = {}) {
  const res = await flowtoneFetch(path, options);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || data.message || "Request failed");
  }

  return data;
}
