import { Mail, Calendar, User } from "lucide-react";

export default function EventEmailSection({ event }) {
  if (!event.email_subject && !event.email_body) {
    return (
      <p className="text-gray-500 text-sm">No email linked to this event.</p>
    );
  }

  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Mail className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-200 text-sm truncate">{event.email_subject}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            {event.email_from && (
              <span className="flex items-center gap-1"><User className="w-3 h-3" />{event.email_from}</span>
            )}
            {event.email_date && (
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{event.email_date}</span>
            )}
          </div>
        </div>
      </div>
      {event.email_body && (
        <div className="border-t border-gray-700 pt-3">
          <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{event.email_body}</p>
        </div>
      )}
    </div>
  );
}