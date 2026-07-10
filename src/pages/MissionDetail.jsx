import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { createPageUrl, formatMoney } from "@/utils";
import { useGoBack } from "@/hooks/useGoBack";
import { flowtoneJson } from "@/lib/flowtoneApi";
import { isPreviewModeEnabled } from "@/lib/supabaseClient";
import { getAssistantProfile, getCachedProfileSync, DEFAULT_LANGUAGE, DEFAULT_ASSISTANT_NAME } from "@/lib/assistantProfile";
import MicButton from "@/components/MicButton";
import {
  ArrowLeft, MapPin, FileText, AlertCircle, Send, Banknote, Download,
  Sparkles, Ban, Loader2, CornerDownLeft, CheckCircle2, UserPlus, Mail,
} from "lucide-react";

const ITEM_ICONS = {
  gig_missing_location: MapPin,
  gig_missing_fee: Banknote,
  gig_missing_client: UserPlus,
  gig_missing_contact: Mail,
  gig_ready_to_invoice: FileText,
  invoice_overdue: AlertCircle,
  invoice_draft_stale: FileText,
  invoice_ready_to_send: Send,
  invoice_ready_no_email: Download,
  lead_new_unanswered: UserPlus,
  lead_quote_no_reply: Send,
};

// Label for the single primary call-to-action (the one thing this ticket is about).
const CTA_LABELS = {
  gig_missing_location: "Add location",
  gig_missing_fee: "Add fee",
  gig_missing_client: "Add client",
  gig_missing_contact: "Add email",
  gig_ready_to_invoice: "Review invoice",
  invoice_overdue: "Open invoice",
  invoice_draft_stale: "Review draft",
  invoice_ready_to_send: "Open to send",
  invoice_ready_no_email: "Get PDF",
  lead_new_unanswered: "Open lead",
  lead_quote_no_reply: "Open lead",
};

export default function MissionDetail() {
  const [params] = useSearchParams();
  const id = params.get("id");
  const navigate = useNavigate();
  const goBack = useGoBack("Missions");

  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState("");

  useEffect(() => {
    let active = true;
    if (!id) { setLoading(false); return; }
    appClient.entities.ActionItem.filter({ id })
      .then((rows) => {
        if (!active) return;
        const t = Array.isArray(rows) ? rows[0] : null;
        setTask(t || null);
        setReply(t?.payload?.last_reply || "");
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  const assistantName = getCachedProfileSync()?.assistant_name || DEFAULT_ASSISTANT_NAME;

  function handleCta() {
    if (task?.action_target) navigate(createPageUrl(task.action_target));
  }

  // Apply the assistant's decision to the ticket. The follow-up date is stored on
  // snoozed_until (AI-internal) and never shown.
  async function applyOutcome(outcome, directive) {
    if (!task) return;
    const payload = { ...(task.payload || {}) };
    if (outcome.reply) payload.last_reply = outcome.reply;
    const updates = { user_directive: directive, payload };

    if (outcome.decision === "skipped") {
      updates.status = "dismissed";
      updates.dismissed_at = new Date().toISOString();
      updates.decision = "skipped";
    } else if (outcome.decision === "done") {
      updates.status = "resolved";
      updates.resolved_at = new Date().toISOString();
      updates.resolved_by = "user";
      updates.decision = "done";
    } else if (outcome.decision === "deferred" && outcome.follow_up_at) {
      updates.status = "snoozed";
      updates.snoozed_until = outcome.follow_up_at;
      updates.decision = "deferred";
    }

    await appClient.entities.ActionItem.update(task.id, updates).catch(() => {});
    setTask((prev) => ({ ...prev, ...updates }));
    setReply(outcome.reply || "");

    // "Just do it" → take them to the action surface.
    if (outcome.action && task.action_target) {
      navigate(createPageUrl(task.action_target));
      return;
    }
    // Once deferred/skipped/done the task leaves the active list — step back to it.
    if (["deferred", "skipped", "done"].includes(outcome.decision)) {
      setTimeout(() => goBack(), 800);
    }
  }

  async function handleSend() {
    const text = message.trim();
    if (!text || sending || !task) return;
    setSending(true);
    setMessage("");
    try {
      if (isPreviewModeEnabled()) {
        await applyOutcome({ reply: "Saved your note.", decision: "" }, text);
      } else {
        const profile = getCachedProfileSync() || await getAssistantProfile();
        const today = new Date().toISOString().slice(0, 10);
        const outcome = await flowtoneJson("/api/ai/task-reply", {
          method: "POST",
          body: JSON.stringify({
            task: {
              item_type: task.item_type,
              title: task.title,
              payload: task.payload,
              decision: task.decision,
            },
            message: text,
            today,
            name: profile?.user_name || "",
            language: profile?.language || DEFAULT_LANGUAGE,
            assistantName: profile?.assistant_name || "",
          }),
        });
        await applyOutcome(outcome || {}, text);
      }
    } catch {
      await appClient.entities.ActionItem.update(task.id, { user_directive: text }).catch(() => {});
      setTask((prev) => ({ ...prev, user_directive: text }));
      setReply("I couldn't reach the assistant just now, but I saved your note.");
    }
    setSending(false);
  }

  async function handleSkip() {
    if (!task) return;
    await applyOutcome({ decision: "skipped", reply: "Okay — I'll leave this one and won't raise it again." }, task.user_directive || "Not needed");
  }

  async function handleReopen() {
    if (!task) return;
    const updates = { status: "open", decision: "", dismissed_at: null, snoozed_until: null, resolved_at: null };
    await appClient.entities.ActionItem.update(task.id, updates).catch(() => {});
    setTask((prev) => ({ ...prev, ...updates }));
    setReply("");
  }

  if (loading) {
    return (
      <div className="p-4 max-w-xl mx-auto">
        <div className="rounded-2xl border border-gray-700/40 bg-gray-800/30 p-5 animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-2/3 mb-3" />
          <div className="h-3 bg-gray-700/60 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="p-4 max-w-xl mx-auto text-center py-16">
        <p className="text-sm text-gray-500 mb-4">This task no longer exists.</p>
        <button onClick={goBack} className="text-indigo-400 hover:text-indigo-300 text-sm">Back to tasks</button>
      </div>
    );
  }

  const Icon = ITEM_ICONS[task.item_type] || FileText;
  const p = task.payload || {};
  const ctaLabel = CTA_LABELS[task.item_type] || "Open";
  const isClosed = task.status === "dismissed" || task.status === "resolved" || task.status === "snoozed";
  const amount = p.total ?? p.fee;

  return (
    <div className="p-4 max-w-xl mx-auto">
      {/* Back */}
      <button
        onClick={goBack}
        className="flex items-center gap-1.5 text-gray-400 hover:text-gray-200 text-sm mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Tasks
      </button>

      {/* Hero — the issue */}
      <div className={`rounded-2xl border p-5 ${task.priority >= 2 ? "border-red-700/40 bg-red-950/20" : "border-gray-700/50 bg-gray-800/30"}`}>
        <div className="flex items-start gap-3">
          <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${task.priority >= 2 ? "text-red-400" : "text-indigo-400"}`} />
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-white leading-snug">{task.title}</h1>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {p.client_name && <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-300">{p.client_name}</span>}
              {amount != null && <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-300 sensitive">{formatMoney(amount, p.currency)}</span>}
              {p.event_date && <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-300">{p.event_date}</span>}
              {p.due_date && <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-300">Due {p.due_date}</span>}
            </div>
          </div>
        </div>

        {/* Single primary call-to-action */}
        {task.action_target && !isClosed && (
          <button
            onClick={handleCta}
            className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
          >
            {ctaLabel}
          </button>
        )}
      </div>

      {/* Assistant reply + your last note */}
      {(reply || task.user_directive) && (
        <div className="mt-3 space-y-2">
          {reply && (
            <div className="flex items-start gap-2 rounded-xl border border-indigo-700/30 bg-indigo-950/30 px-3 py-2.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-indigo-100/90 leading-snug">{reply}</p>
            </div>
          )}
          {task.user_directive && (
            <p className="text-xs text-gray-500 px-1">You said: "{task.user_directive}"</p>
          )}
        </div>
      )}

      {/* Closed state */}
      {isClosed && (
        <div className="mt-3 rounded-xl border border-gray-700/40 bg-gray-800/30 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
            <p className="text-sm text-gray-400">
              {task.status === "dismissed" ? "Ignored — I won't raise this again." :
               task.status === "resolved" ? "Done." :
               "Got it — I'll bring this back when the time comes."}
            </p>
          </div>
          <button onClick={handleReopen} className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
            Reopen this task
          </button>
        </div>
      )}

      {/* Talk to the assistant about this task */}
      {!isClosed && (
        <div className="mt-4">
          <div className="flex items-center gap-2 rounded-xl border border-gray-700/50 bg-gray-900/60 px-2 py-1.5 focus-within:border-indigo-500/50 transition-colors">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
              disabled={sending}
              placeholder={`Tell ${assistantName}: "remind me next week", "send it", "not needed"…`}
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 px-2 py-1.5 focus:outline-none min-w-0"
            />
            <MicButton onResult={(t) => setMessage((m) => (m ? m + " " : "") + t)} />
            <button
              onClick={handleSend}
              disabled={sending || !message.trim()}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors flex-shrink-0"
              aria-label="Send"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CornerDownLeft className="w-4 h-4" />}
            </button>
          </div>

          <button
            onClick={handleSkip}
            disabled={sending}
            className="mt-3 flex items-center gap-1.5 text-gray-600 hover:text-red-400 text-xs transition-colors disabled:opacity-50"
          >
            <Ban className="w-3.5 h-3.5" /> I don't need this
          </button>
        </div>
      )}
    </div>
  );
}
