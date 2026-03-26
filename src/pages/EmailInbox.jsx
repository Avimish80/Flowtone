import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { MailOpen, Link2, EyeOff, Inbox } from "lucide-react";
import { format } from "date-fns";

const statusColors = {
  new: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  reviewed: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  linked: "bg-green-500/20 text-green-400 border-green-500/30",
  ignored: "bg-gray-700/30 text-gray-600 border-gray-700/30",
};

export default function EmailInbox() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("new");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    appClient.entities.EmailMessage.list("-date", 100).then(data => {
      setEmails(data);
      setLoading(false);
    });
  }, []);

  const updateStatus = async (email, status) => {
    await appClient.entities.EmailMessage.update(email.id, { status });
    setEmails(prev => prev.map(e => e.id === email.id ? { ...e, status } : e));
    if (selected?.id === email.id) setSelected({ ...selected, status });
  };

  const filtered = emails.filter(e => filter === "all" || e.status === filter);

  return (
    <div className="max-w-xl mx-auto">
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-800">
        <h1 className="text-xl font-bold text-white">Email Inbox</h1>
        <span className="text-xs text-gray-500">{emails.filter(e => e.status === "new").length} new</span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-3 border-b border-gray-800 overflow-x-auto">
        {["new", "reviewed", "linked", "ignored", "all"].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-colors ${
              filter === s ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {selected ? (
        /* Email Detail View */
        <div className="p-4">
          <button onClick={() => setSelected(null)} className="text-indigo-400 text-sm mb-4 flex items-center gap-1">
            ← Back to inbox
          </button>
          <div className="bg-gray-800 rounded-xl p-4 space-y-3">
            <div>
              <p className="font-semibold text-white">{selected.subject}</p>
              <p className="text-sm text-gray-400 mt-1">From: {selected.from_name ? `${selected.from_name} <${selected.from_email}>` : selected.from_email}</p>
              {selected.date && <p className="text-xs text-gray-500 mt-0.5">{format(new Date(selected.date), "d MMM yyyy, HH:mm")}</p>}
            </div>
            <div className="border-t border-gray-700 pt-3 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
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
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Inbox className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">No emails in this view</p>
          <p className="text-xs text-gray-600 mt-1">Emails are synced via Gmail integration</p>
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
                    <div className="w-2 h-2 rounded-full bg-indigo-400 mt-1.5" />
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
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${statusColors[email.status]}`}>{email.status}</span>
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