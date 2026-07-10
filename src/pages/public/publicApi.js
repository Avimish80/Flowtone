// Fetch helpers for the public (unauthenticated) prospect pages.
// These pages must stay self-contained: no appClient, no supabase-js,
// no Layout imports — everything goes through the Express server.
import { API_BASE_URL } from "@/lib/apiBase";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}/api/public${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON error body
  }
  if (!res.ok || data === null) {
    const message = data?.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function fetchEnquiryPage(slug) {
  return request(`/enquiry/${encodeURIComponent(slug)}`);
}

export function submitEnquiry(slug, form) {
  return request(`/enquiry/${encodeURIComponent(slug)}`, {
    method: "POST",
    body: JSON.stringify(form),
  });
}

export function fetchQuote(token) {
  return request(`/quote/${encodeURIComponent(token)}`);
}

export function acceptQuote(token) {
  return request(`/quote/${encodeURIComponent(token)}/accept`, { method: "POST" });
}

export function declineQuote(token) {
  return request(`/quote/${encodeURIComponent(token)}/decline`, { method: "POST" });
}

export const CURRENCY_SYMBOLS = { GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$" };

export function money(amount, currency) {
  const symbol = CURRENCY_SYMBOLS[currency] || "";
  const num = Number(amount) || 0;
  return `${symbol}${num.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
