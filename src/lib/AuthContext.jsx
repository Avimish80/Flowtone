import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createCheckoutSession, createPortalSession, fetchAccessState } from "@/lib/billingClient";
import { PREVIEW_ACCESS_STATE, PREVIEW_USER } from "@/lib/previewMode";
import { getSupabaseClient, isPreviewModeEnabled, isSupabaseConfigured } from "@/lib/supabaseClient";

const AuthContext = createContext(null);

async function ensureProfile(session) {
  const supabase = getSupabaseClient();
  if (!supabase || !session?.user) return null;

  const metadata = session.user.user_metadata || {};
  const profileInput = {
    id: session.user.id,
    email: session.user.email || "",
    full_name: metadata.full_name || metadata.name || "",
  };

  const { error } = await supabase
    .from("profiles")
    .upsert(profileInput, { onConflict: "id" });

  if (error) throw error;
  return profileInput;
}

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [isLoadingAccess, setIsLoadingAccess] = useState(false);
  const [accessState, setAccessState] = useState(null);
  const [authError, setAuthError] = useState(null);

  const refreshAccess = useCallback(async (activeSession) => {
    if (!activeSession?.access_token) {
      setAccessState(null);
      return null;
    }

    setIsLoadingAccess(true);

    try {
      await ensureProfile(activeSession);
      const access = await fetchAccessState(activeSession.access_token);
      setAccessState(access);
      setAuthError(null);
      return access;
    } catch (_error) {
      // Server unreachable or route missing — grant access to authenticated users
      // rather than locking them out due to a server-side issue.
      const fallback = {
        user_id: activeSession.user?.id || "",
        email: activeSession.user?.email || "",
        has_access: true,
        subscription_status: "trialing",
        plan_name: null,
        trial_ends_at: null,
        billing_customer_id: null,
      };
      setAccessState(fallback);
      setAuthError(null);
      return fallback;
    } finally {
      setIsLoadingAccess(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      if (isPreviewModeEnabled()) {
        setSession({ access_token: "preview-mode", user: PREVIEW_USER });
        setUser(PREVIEW_USER);
        setAccessState(PREVIEW_ACCESS_STATE);
        setAuthError(null);
        setAuthReady(true);
        return undefined;
      }

      setAuthError({
        type: "config_error",
        message: "Supabase configuration is missing.",
      });
      setAuthReady(true);
      return undefined;
    }

    const supabase = getSupabaseClient();

    let mounted = true;

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted) return;

      if (error) {
        setAuthError({ type: "auth_error", message: error.message });
      }

      const nextSession = data.session || null;
      setSession(nextSession);
      setUser(nextSession?.user || null);

      if (nextSession) {
        await refreshAccess(nextSession);
      } else {
        setAccessState(null);
      }

      if (mounted) setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;

      setSession(nextSession || null);
      setUser(nextSession?.user || null);
      setAuthReady(true);

      if (!nextSession) {
        setAccessState(null);
        setAuthError(null);
        return;
      }

      // Re-check billing access only on a genuine sign-in, not on every silent
      // TOKEN_REFRESHED tick (the initial load is handled by getSession above).
      // And never await a Supabase call inside this callback: it runs while
      // GoTrue holds its auth lock, so awaiting here deadlocks the lock and
      // hangs every data call — the iOS PWA "stuck loading after a couple of
      // minutes" bug. Defer the work outside the lock with setTimeout(0).
      if (event === "SIGNED_IN") {
        setTimeout(() => {
          if (mounted) void refreshAccess(nextSession);
        }, 0);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [refreshAccess]);

  const sendMagicLink = useCallback(async (email, { allowSignup = false } = {}) => {
    if (isPreviewModeEnabled()) return;

    const trimmedEmail = String(email || "").trim().toLowerCase();
    if (!trimmedEmail) throw new Error("Enter your email first.");

    const supabase = getSupabaseClient();
    setIsSendingMagicLink(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        // No emailRedirectTo — sends a code-only email, no magic link.
        // Magic links open Safari instead of the PWA on iOS, breaking the login loop.
        // shouldCreateUser: false makes sign-in reject unknown emails instead of
        // silently registering them; the signup flow passes allowSignup: true.
        options: { shouldCreateUser: allowSignup },
      });

      if (error) {
        if (/signups not allowed/i.test(error.message || "")) {
          throw new Error("No account found for this email. Tap 'Create account' below to register.");
        }
        throw error;
      }
      setAuthError(null);
    } catch (error) {
      setAuthError({ type: "auth_error", message: error.message || "Could not send code." });
      throw error;
    } finally {
      setIsSendingMagicLink(false);
    }
  }, []);

  const verifyOtp = useCallback(async (email, token) => {
    if (isPreviewModeEnabled()) return;

    const trimmedEmail = String(email || "").trim().toLowerCase();
    const trimmedToken = String(token || "").replace(/\s/g, "");
    if (!trimmedEmail || !trimmedToken) throw new Error("Email and code are required.");

    const supabase = getSupabaseClient();

    try {
      const { error } = await supabase.auth.verifyOtp({
        email: trimmedEmail,
        token: trimmedToken,
        type: "email",
      });
      if (error) throw error;
      setAuthError(null);
    } catch (error) {
      const message = error.message || "Invalid or expired code.";
      setAuthError({ type: "auth_error", message });
      throw new Error(message);
    }
  }, []);

  const logout = useCallback(async (redirectTo = "/") => {
    if (isPreviewModeEnabled()) {
      if (redirectTo) window.location.assign(redirectTo);
      return;
    }

    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    setAccessState(null);
    setAuthError(null);
    if (redirectTo) window.location.assign(redirectTo);
  }, []);

  const navigateToLogin = useCallback((redirectTo = "/") => {
    window.location.assign(redirectTo);
  }, []);

  const openCheckout = useCallback(async () => {
    if (isPreviewModeEnabled()) return;

    setIsStartingCheckout(true);
    try {
      const result = await createCheckoutSession();
      if (result?.url) window.location.assign(result.url);
    } catch (error) {
      setAuthError({ type: "billing_error", message: error.message || "Could not start checkout." });
    } finally {
      setIsStartingCheckout(false);
    }
  }, []);

  const openBillingPortal = useCallback(async () => {
    if (isPreviewModeEnabled()) return;

    setIsOpeningPortal(true);
    try {
      const result = await createPortalSession();
      if (result?.url) window.location.assign(result.url);
    } catch (error) {
      setAuthError({ type: "billing_error", message: error.message || "Could not open billing portal." });
    } finally {
      setIsOpeningPortal(false);
    }
  }, []);

  const hasAccess = useMemo(() => Boolean(accessState?.has_access), [accessState?.has_access]);
  const isAuthenticated = Boolean(session?.user);

  const contextValue = useMemo(() => ({
    user,
    session,
    accessState,
    authReady,
    hasAccess,
    isAuthenticated,
    isLoadingAuth: !authReady,
    isLoadingPublicSettings: false,
    isLoadingAccess,
    isSendingMagicLink,
    isStartingCheckout,
    isOpeningPortal,
    authError,
    appPublicSettings: {},
    isPreviewMode: isPreviewModeEnabled(),
    sendMagicLink,
    verifyOtp,
    refreshAccess,
    logout,
    navigateToLogin,
    openCheckout,
    openBillingPortal,
    checkAppState: refreshAccess,
  }), [
    accessState,
    authError,
    authReady,
    hasAccess,
    isAuthenticated,
    isLoadingAccess,
    isOpeningPortal,
    isSendingMagicLink,
    isStartingCheckout,
    logout,
    navigateToLogin,
    openBillingPortal,
    openCheckout,
    refreshAccess,
    session,
    sendMagicLink,
    verifyOtp,
    user,
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
