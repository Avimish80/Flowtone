import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { createPageUrl } from "@/utils";
import { MailOpen, Link2, EyeOff, Inbox, RefreshCw, Paperclip } from "lucide-react";
import { format } from "date-fns";
import { getCachedICloudMailStatus, refreshICloudMailStatus, syncICloudMailNow } from "@/lib/icloudMailClient";

const statusColors = {
  new: "bg-gray-700/50 text-gray-300 border-gray-700/60",
  reviewed: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  linked: "bg-green-500/20 text-green-400 border-green-500/30",
  ignored: "bg-gray-700/30 text-gray-600 border-gray-700/30",
};

// Messages arrive here from the server's iCloud Mail sync (email_messages);
// the page only reads them and tracks the user's review status.
export default function EmailInbox() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("new");
  const [selected, setSelected] = useState(null);
  const [mail, setMail] = useState(getCachedICloudMailStatus);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");

  const load = useCallback(async () => {
    const data = await appClient.entities.EmailMessage.list("-date", 100);
    setEmails(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
    refreshICloudMailStatus().then(setMail);
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncNote("");
    try {
      const r = await syncICloudMailNow();
      setSyncNote(r.imported ? `${r.imported} new` : "Up to date");
      await load();
      setMail(await refreshICloudMailStatus());
    } catch (err) {
      setSyncNote(err.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const updateStatus = async (email, status) => {
    await appClient.entities.EmailMessage.update(email.id, { status });
    setEmails(prev => prev.map(e => e.id === email.id ? { ...e, status } : e));
    if (selected?.id === email.id) setSelected({ ...selected, status });
  };

  const filtered = emails.filter(e => filter === "all" || e.status === filter);

  return (
    <div className="max-w-xl mx-auto">
      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-gray-800">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white">Email Inbox</h1>
          {mail.connected && (
            <p className="text-[11px] text-gray-500 truncate">{mail.email}{syncNote ? ` · ${syncNote}` : ""}</p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-gray-500">{emails.filter(e => e.status === "new").length} new</span>
          {mail.connected && (
            <button onClick={handleSync} disabled={syncing} aria-label="Sync inbox"
              className="text-gray-500 hover:text-gray-300 disabled:opacity-40 transition-colors">
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-3 border-b border-gray-800 overflow-x-auto">
        {["new", "reviewed", "linked", "ignored", "all"].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-colors ${
              filter === s ? "bg-gray-700 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {selected ? (
        /* Email Detail View */
        <div className="p-4">
          <button onClick={() => setSelected(null)} className="text-ink text-sm mb-4 flex items-center gap-1">
            ← Back to inbox
          </button>
          <div className="bg-gray-800 rounded-xl p-4 space-y-3">
            <div>
              <p className="font-semibold text-white">{selected.subject}</p>
              <p className="text-sm text-gray-400 mt-1">From: {selected.from_name ? `${selected.from_name} <${selected.from_email}>` : selected.from_email}</p>
              {selected.date && <p className="text-xs text-gray-500 mt-0.5">{format(new Date(selected.date), "d MMM yyyy, HH:mm")}</p>}
              {Array.isArray(selected.attachments) && selected.attachments.length > 0 && (
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1 truncate">
                  <Paperclip className="w-3 h-3 flex-shrink-0" />
                  {selected.attachments.map(a => a.filename || "attachment").join(", ")}
                </p>
              )}
            </div>
            <div className="border-t border-gray-700 pt-3 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed break-words">
              {selected.body || selected.snippet || "No body"}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => updateStatus(selected, "reviewed")} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg py-2 text-xs flex items-center justify-center gap-1 transition-colors">
                <MailOpen className="w-3.5 h-3.5" /> Mark Reviewed
              </button>
              <button onClick={() => updateStatus(selected, "linked")} className="flex-1 bg-green-700 hover:bg-green-600 text-white rounded-lg py-2 text-xs flex items-center justify-center gap-1 transition-colors">
                <Link2 className="w-3.5 h-3.5" /> Mark Linked
              </button>
              <button onClick={() => updateStatus(selected, "ignored")} className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-3 py-2 text-xs transition-colors">
                <EyeOff className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="p-4 space-y-3">{[1,2,3,4].map(i => <div key={i} className="bg-gray-800 rounded-xl h-20 animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500 px-6 text-center">
          <Inbox className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">No emails in this view</p>
          {mail.connected ? (
            <p className="text-xs text-gray-600 mt-1">Synced from {mail.email}</p>
          ) : (
            <Link to={createPageUrl("AppSettings")} className="text-xs text-ink mt-1">
              Connect iCloud Mail in Settings to see your inbox here
            </Link>
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-800">
          {filtered.map(email => (
            <button
              key={email.id}
              onClick={() => setSelected(email)}
              className="w-full text-left px-4 py-4 hover:bg-gray-800/50 active:bg-gray-800 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0">
                  {email.status === "new" ? (
                    <div className="w-2 h-2 rounded-full bg-gray-400 mt-1.5" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-transparent mt-1.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className={`text-sm font-medium truncate ${email.status === "new" ? "text-white" : "text-gray-400"}`}>
                      {email.from_name || email.from_email}
                    </p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {email.has_attachments && <Paperclip className="w-3 h-3 text-gray-500" />}
                      {email.date && <span className="text-[10px] text-gray-500">{format(new Date(email.date), "d MMM")}</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${statusColors[email.status] || statusColors.new}`}>{email.status}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 truncate">{email.subject}</p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{email.snippet || email.body}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
