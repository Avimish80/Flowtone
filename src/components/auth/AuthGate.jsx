import { useMemo, useState } from "react";
import { Loader2, Mail, CreditCard, Music2, LogOut, ShieldAlert, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

function Panel({ children }) {
  return (
    <div className="w-full max-w-md rounded-3xl border border-gray-800 bg-gray-900/90 shadow-2xl shadow-black/40 backdrop-blur">
      {children}
    </div>
  );
}

function PrimaryButton({ children, className = "", ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

function ScreenFrame({ children }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_35%),linear-gradient(180deg,_#050816_0%,_#030712_100%)] px-4 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        {children}
      </div>
    </div>
  );
}

function FeatureList() {
  const items = [
    "Track gigs, lessons, rehearsals, and sessions",
    "Invoice clients and follow up on late payments",
    "Keep practice, charts, clients, and travel in one place",
  ];

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item} className="flex items-start gap-3 text-sm text-gray-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

export default function AuthGate() {
  const {
    authReady,
    authError,
    hasAccess,
    isAuthenticated,
    isLoadingAccess,
    isSendingMagicLink,
    isStartingCheckout,
    isOpeningPortal,
    accessState,
    sendMagicLink,
    logout,
    openCheckout,
    openBillingPortal,
  } = useAuth();

  const [email, setEmail] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [localError, setLocalError] = useState("");

  const trialLabel = useMemo(() => {
    if (!accessState?.trial_ends_at) return "";
    const date = new Date(accessState.trial_ends_at);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }, [accessState?.trial_ends_at]);

  const handleSendMagicLink = async (event) => {
    event.preventDefault();
    setLocalError("");
    setInfoMessage("");

    try {
      await sendMagicLink(email);
      setInfoMessage(`Magic link sent to ${email}. Open it on this device to sign in.`);
    } catch (error) {
      setLocalError(error.message || "Could not send magic link.");
    }
  };

  if (!authReady) {
    return (
      <ScreenFrame>
        <Panel>
          <div className="flex flex-col items-center gap-4 px-6 py-12">
            <Loader2 className="h-7 w-7 animate-spin text-indigo-300" />
            <p className="text-sm text-gray-400">Checking your Flowtone account…</p>
          </div>
        </Panel>
      </ScreenFrame>
    );
  }

  if (authError?.type === "config_error") {
    return (
      <ScreenFrame>
        <Panel>
          <div className="space-y-4 px-6 py-8">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <p className="text-lg font-semibold">Flowtone needs backend setup</p>
                <p className="text-sm text-gray-400">Supabase environment variables are missing.</p>
              </div>
            </div>
            <p className="text-sm text-gray-300">
              Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the frontend, then restart the app.
            </p>
          </div>
        </Panel>
      </ScreenFrame>
    );
  }

  if (!isAuthenticated) {
    return (
      <ScreenFrame>
        <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6 self-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">
              <Music2 className="h-3.5 w-3.5" />
              Flowtone
            </div>
            <div className="space-y-4">
              <h1 className="max-w-xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
                The business OS for working musicians.
              </h1>
              <p className="max-w-xl text-base leading-7 text-gray-300">
                Run gigs, lessons, invoices, travel, practice, and client follow-up from one phone-first workspace.
              </p>
            </div>
            <FeatureList />
          </div>

          <Panel>
            <div className="space-y-5 px-6 py-8">
              <div>
                <p className="text-lg font-semibold text-white">Sign in to Flowtone</p>
                <p className="mt-1 text-sm text-gray-400">
                  We’ll send you a magic link by email. No password needed.
                </p>
              </div>

              <form className="space-y-4" onSubmit={handleSendMagicLink}>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wider text-gray-500">Email</label>
                  <div className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-950/80 px-4 py-3">
                    <Mail className="h-4 w-4 text-gray-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                <PrimaryButton
                  type="submit"
                  disabled={!email.trim() || isSendingMagicLink}
                  className="bg-indigo-600 text-white hover:bg-indigo-500"
                >
                  {isSendingMagicLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Send Magic Link
                </PrimaryButton>
              </form>

              {(localError || authError?.message) && (
                <div className="rounded-2xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                  {localError || authError?.message}
                </div>
              )}

              {infoMessage && (
                <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
                  {infoMessage}
                </div>
              )}
            </div>
          </Panel>
        </div>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <Panel>
        <div className="space-y-5 px-6 py-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-white">Flowtone paid beta</p>
              <p className="mt-1 text-sm text-gray-400">
                Your account is signed in{accessState?.email ? ` as ${accessState.email}` : ""}.
              </p>
            </div>
            <button
              onClick={() => logout()}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 transition-colors hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>

          <div className="rounded-2xl border border-indigo-900/50 bg-indigo-950/30 px-4 py-4">
            <p className="text-sm font-medium text-white">
              {hasAccess ? "Your account has access to Flowtone." : "Upgrade to unlock the full product."}
            </p>
            <p className="mt-1 text-sm text-gray-300">
              {trialLabel && accessState?.subscription_status === "trialing"
                ? `Your beta trial runs until ${trialLabel}.`
                : "Billing runs through Stripe Checkout on the web for the first launch."}
            </p>
          </div>

          {authError?.message && (
            <div className="rounded-2xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {authError.message}
            </div>
          )}

          <div className="space-y-3">
            <PrimaryButton
              onClick={openCheckout}
              disabled={isStartingCheckout || isLoadingAccess}
              className="bg-indigo-600 text-white hover:bg-indigo-500"
            >
              {isStartingCheckout ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              {hasAccess ? "Change Plan" : "Start Paid Beta"}
            </PrimaryButton>

            {accessState?.billing_customer_id && (
              <PrimaryButton
                onClick={openBillingPortal}
                disabled={isOpeningPortal}
                className="border border-gray-700 bg-gray-900 text-gray-200 hover:bg-gray-800"
              >
                {isOpeningPortal ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                Manage Billing
              </PrimaryButton>
            )}
          </div>
        </div>
      </Panel>
    </ScreenFrame>
  );
}
