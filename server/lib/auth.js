import { getSupabaseAdmin, isSupabaseServerConfigured } from "./supabaseAdmin.js";

function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

export async function getAuthenticatedUser(req) {
  if (!isSupabaseServerConfigured()) {
    throw new Error("Supabase server configuration is missing.");
  }

  const token = extractBearerToken(req);
  if (!token) return null;

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) throw error;
  return data.user || null;
}

export async function requireAuthenticatedUser(req, res, next) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    req.flowtoneUser = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: error.message || "Invalid auth token" });
  }
}

