const rawApiUrl = import.meta.env.VITE_API_URL?.trim();

export const API_BASE_URL = rawApiUrl
  ? rawApiUrl.replace(/\/$/, "")
  : "http://localhost:3001";

