const STORAGE_KEYS = {
  ACCESS: 'gmail_access_token',
  REFRESH: 'gmail_refresh_token',
  EMAIL: 'gmail_email',
  EXPIRES: 'gmail_token_expires',
};

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/gmail`
  : 'http://localhost:3001/api/gmail';

export function isGmailConnected() {
  return !!localStorage.getItem(STORAGE_KEYS.REFRESH);
}

export function getGmailEmail() {
  return localStorage.getItem(STORAGE_KEYS.EMAIL) || '';
}

export function getGmailTokens() {
  return {
    accessToken: localStorage.getItem(STORAGE_KEYS.ACCESS),
    refreshToken: localStorage.getItem(STORAGE_KEYS.REFRESH),
    email: localStorage.getItem(STORAGE_KEYS.EMAIL),
  };
}

export function saveGmailTokens({ accessToken, refreshToken, email }) {
  if (accessToken) localStorage.setItem(STORAGE_KEYS.ACCESS, accessToken);
  if (refreshToken) localStorage.setItem(STORAGE_KEYS.REFRESH, refreshToken);
  if (email) localStorage.setItem(STORAGE_KEYS.EMAIL, email);
}

export function disconnectGmail() {
  Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
}

export async function connectGmail() {
  const res = await fetch(`${API_BASE}/auth-url?origin=${encodeURIComponent(window.location.origin)}`);
  const { url } = await res.json();
  window.location.href = url;
}

// Refresh access token using refresh token
export async function refreshAccessToken() {
  const { refreshToken } = getGmailTokens();
  if (!refreshToken) throw new Error('No refresh token');
  const res = await fetch(`${API_BASE}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const data = await res.json();
  if (data.access_token) {
    localStorage.setItem(STORAGE_KEYS.ACCESS, data.access_token);
    return data.access_token;
  }
  throw new Error('Failed to refresh token');
}

// Send an email via Gmail API
export async function sendGmailEmail({ to, subject, htmlBody }) {
  let { accessToken, refreshToken, email: fromEmail } = getGmailTokens();
  if (!accessToken || !refreshToken) throw new Error('Gmail not connected');

  const res = await fetch(`${API_BASE}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, refreshToken, to, subject, htmlBody, fromEmail }),
  });

  if (!res.ok) {
    // If 401, try refreshing
    if (res.status === 401) {
      const newToken = await refreshAccessToken();
      const retry = await fetch(`${API_BASE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: newToken, refreshToken, to, subject, htmlBody, fromEmail }),
      });
      if (!retry.ok) throw new Error('Failed to send email after token refresh');
      return retry.json();
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send email');
  }
  return res.json();
}
