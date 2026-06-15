import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { X, Bell, CalendarPlus, Mail, AlertCircle, RefreshCw, CheckCheck } from "lucide-react";
import { appClient } from "@/api/appClient";
import { markRead, markAllRead } from "@/lib/appBadge";

const TYPE_ICONS = {
  gig_added: CalendarPlus,
  calendar_change: RefreshCw,
  email_received: Mail,
  ai_problem: AlertCircle,
};

const TYPE_COLOURS = {
  gig_added: "text-indigo-400",
  calendar_change: "text-blue-400",
  email_received: "text-green-400",
  ai_problem: "text-amber-400",
};

function timeAgo(isoString) {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationsPanel({ open, onClose }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await appClient.entities.Notification.list("-created_at", 50);
      setNotifications(all);
    } catch { /* graceful */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleTap = async (n) => {
    if (!n.read_at) {
      await markRead([n.id]);
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item
        )
      );
    }
    if (n.url) {
      navigate(n.url);
      onClose();
    }
  };

  const handleMarkAll = async () => {
    await markAllRead();
    setNotifications((prev) =>
      prev.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() }))
    );
  };

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-gray-900 border-l border-gray-700 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-indigo-400" />
            <span className="font-semibold text-white text-sm">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-600 text-white">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAll}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-white p-1 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <Bell className="w-8 h-8 text-gray-700 mb-3" />
              <p className="text-sm text-gray-500">Nothing here yet</p>
              <p className="text-xs text-gray-600 mt-1">New gigs, emails, and alerts will show up here</p>
            </div>
          ) : (
            <ul>
              {notifications.map((n) => {
                const Icon = TYPE_ICONS[n.type] || Bell;
                const iconColour = TYPE_COLOURS[n.type] || "text-gray-400";
                const isUnread = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => handleTap(n)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-gray-800/60 transition-colors ${
                        isUnread ? "bg-gray-800/40 hover:bg-gray-800/60" : "hover:bg-gray-800/30"
                      }`}
                    >
                      <div className={`mt-0.5 flex-shrink-0 ${iconColour}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm leading-snug ${isUnread ? "text-white font-medium" : "text-gray-300"}`}>
                            {n.title}
                          </p>
                          {isUnread && (
                            <span className="mt-1 flex-shrink-0 w-2 h-2 rounded-full bg-indigo-500" />
                          )}
                        </div>
                        {n.body ? (
                          <p className="text-xs text-gray-500 mt-0.5 leading-snug">{n.body}</p>
                        ) : null}
                        <p className="text-[10px] text-gray-600 mt-1">{timeAgo(n.created_at)}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
