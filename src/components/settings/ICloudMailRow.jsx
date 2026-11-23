import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Mail, RefreshCw, Eye, EyeOff, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Toggle } from "@/components/NotificationPrefsEditor";
import { isPreviewModeEnabled } from "@/lib/supabaseClient";
import { createPageUrl } from "@/utils";
import {
  getCachedICloudMailStatus, refreshICloudMailStatus, connectICloudMail,
  disconnectICloudMail, setICloudMailSyncEnabled, syncICloudMailNow,
} from "@/lib/icloudMailClient";

const APPLE_ACCOUNT_URL = "https://account.apple.com/account/manage";
const inputClass = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-gray-400";

// Settings -> Connections row: iCloud Mail over IMAP/SMTP through the Flowtone
// server, signed in with an Apple app-specific password that is sent once and
// kept encrypted on the server. Hidden in preview mode (no server) and on a
// server whose database has no mail tables yet (status.available === false).
export default function ICloudMailRow() {
  const [status, setStatus] = useState(getCachedICloudMailStatus);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [login, setLogin] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setStatus(await refreshICloudMailStatus());
  }, []);

  useEffect(() => {
    if (!isPreviewModeEnabled()) refresh();
  }, [refresh]);

  if (isPreviewModeEnabled() || status.available === false) return null;

  const handleConnect = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const next = await connectICloudMail({
        email: email.trim(),
        password,
        login: showLogin ? login.trim() : "",
      });
      setStatus(next);
      setPassword("");
      setShowForm(false);
      setMsg("Connected. The last month of your inbox is being imported; it appears in the Inbox, under More, within a minute or two.");
    } catch (err) {
      setError(err.message || "Could not connect");
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      setStatus(await disconnectICloudMail());
    } catch (err) {
      setError(err.message || "Could not disconnect");
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async () => {
    setError("");
    try {
      setStatus(await setICloudMailSyncEnabled(!status.sync_enabled));
    } catch (err) {
      setError(err.message || "Could not change the setting");
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setError("");
    setMsg("");
    try {
      const r = await syncICloudMailNow();
      setMsg(r.imported ? `${r.imported} new message${r.imported === 1 ? "" : "s"} imported` : "Inbox is up to date");
      await refresh();
    } catch (err) {
      setError(err.message || "Sync failed");
      // A refused password pauses the import on the server: show that state.
      refresh().catch(() => {});
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <p className="text-sm font-medium text-gray-200">iCloud Mail</p>
        </div>
        {status.connected ? (
          <button onClick={handleDisconnect} disabled={busy}
            className="text-xs text-red-400 hover:text-red-300 underline underline-offset-2 disabled:opacity-50 flex-shrink-0">
            Disconnect
          </button>
        ) : null}
      </div>

      {status.connected ? (
        <>
          <p className="text-xs text-gray-500 pl-6">{status.email}</p>

          <div className="flex items-center justify-between gap-3 pl-6">
            <p className="text-sm text-gray-300">Import inbox</p>
            <Toggle on={!!status.sync_enabled} onClick={handleToggle} />
          </div>

          <div className="pl-6">
            <div className="flex items-center gap-4">
              <button onClick={handleSyncNow} disabled={syncing || !status.sync_enabled}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Sync now"}
              </button>
              <Link to={createPageUrl("EmailInbox")}
                className="text-xs text-gray-400 hover:text-gray-200 underline underline-offset-2 transition-colors">
                Open inbox
              </Link>
            </div>
            {(msg || error || status.last_error || status.last_synced_at) && (
              <p className={`text-[11px] mt-1 ${error || (status.last_error && !msg) ? "text-red-400" : "text-gray-600"}`}>
                {error || msg || status.last_error
                  || (status.last_synced_at ? `Last synced ${formatDistanceToNow(new Date(status.last_synced_at), { addSuffix: true })}` : "")}
              </p>
            )}
          </div>
        </>
      ) : showForm ? (
        <form onSubmit={handleConnect} className="pl-6 space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">iCloud email address</label>
            <input type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@icloud.com" className={inputClass} />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">App-specific password</label>
            <div className="relative">
              <input type={showPassword ? "text" : "password"} required autoComplete="off" spellCheck={false}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx" className={`${inputClass} pr-10`} />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
              Not your Apple ID password. Create one at{" "}
              <a href={APPLE_ACCOUNT_URL} target="_blank" rel="noreferrer" className="text-gray-300 underline underline-offset-2">account.apple.com</a>
              {" "}under Sign-In and Security, App-Specific Passwords. Flowtone keeps it encrypted on its own server and never shows it again.
            </p>
          </div>
          {showLogin ? (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Signs in as (your Apple ID address)</label>
              <input type="text" autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)}
                placeholder="appleid@icloud.com" className={inputClass} />
            </div>
          ) : (
            <button type="button" onClick={() => setShowLogin(true)}
              className="text-[11px] text-gray-500 hover:text-gray-300 underline underline-offset-2">
              Using a custom domain? Sign in with a different address
            </button>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !email || !password}
              className="bg-ink hover:bg-ink/90 disabled:opacity-50 text-ink-fg px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-colors">
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</> : "Connect"}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setError(""); setPassword(""); }}
              className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-4 py-2 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="pl-6 space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Read enquiries in your Email Inbox and send invoices from your iCloud address. Signs in with an Apple app-specific password.
          </p>
          <button onClick={() => { setShowForm(true); setMsg(""); setError(""); }}
            className="flex items-center gap-2 text-sm font-medium text-ink hover:text-ink/80 transition-colors">
            <Mail className="w-4 h-4" />
            Connect iCloud Mail
          </button>
          {msg && <p className="text-xs text-gray-500">{msg}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
