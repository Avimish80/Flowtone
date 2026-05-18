import { API_BASE_URL } from "@/lib/apiBase";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabaseClient";

async function getAccessToken() {
  if (!isSupabaseConfigured) return null;
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export async function flowtoneFetch(path, options = {}) {
  const { accessToken, ...requestOptions } = options;
  const token = accessToken || await getAccessToken();
  const headers = new Headers(requestOptions.headers || {});

  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && requestOptions.body && !(requestOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${API_BASE_URL}${path}`, {
    ...requestOptions,
    headers,
  });
}

export async function flowtoneJson(path, options = {}) {
  const res = await flowtoneFetch(path, options);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || data.message || "Request failed");
  }

  return data;
}
