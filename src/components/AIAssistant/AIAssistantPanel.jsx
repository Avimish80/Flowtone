import { useEffect, useRef, useState } from "react";
import { X, Trash2, Send, Sparkles, ExternalLink, Mic, MicOff } from "lucide-react";
import { useSpeechInput } from "@/hooks/useSpeechInput";
import { createPageUrl, currencySymbol } from "@/utils";

// ─── CSS animations injected once ───────────────────────────────────────────
const AI_STYLES = `
  @keyframes ai-overlay-in {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes ai-overlay-out {
    from { opacity: 1; transform: translateY(0); }
    to   { opacity: 0; transform: translateY(20px); }
  }
  @keyframes ai-glow-pulse {
    0%, 100% { box-shadow: inset 0 0 0 1px rgba(99,102,241,0.35), 0 0 60px rgba(99,102,241,0.08); }
    50%       { box-shadow: inset 0 0 0 1.5px rgba(139,92,246,0.6), 0 0 80px rgba(99,102,241,0.18); }
  }
  @keyframes ai-dot-bounce {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.7); }
    40%            { opacity: 1;   transform: scale(1); }
  }
  @keyframes ai-msg-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes ai-orb-float {
    0%, 100% { transform: translateY(0) scale(1); }
    50%       { transform: translateY(-6px) scale(1.02); }
  }
  @keyframes ai-orb-glow {
    from { opacity: 0.4; transform: scale(1); }
    to   { opacity: 0.9; transform: scale(1.12); }
  }
  @keyframes ai-orb-speak {
    0%, 100% { transform: scale(1); }
    50%       { transform: scale(1.06); }
  }
  .ai-overlay-open  { animation: ai-overlay-in  0.3s ease forwards; }
  .ai-overlay-close { animation: ai-overlay-out 0.25s ease forwards; }
  .ai-thinking      { animation: ai-glow-pulse 2s ease-in-out infinite; }
  .ai-msg-in        { animation: ai-msg-in 0.3s ease forwards; }
  .ai-orb-idle      { animation: ai-orb-float 3s ease-in-out infinite; }
  .ai-orb-speaking  { animation: ai-orb-speak 0.4s ease-in-out infinite; }
  .ai-orb-glow      { animation: ai-orb-glow 2s ease-in-out infinite alternate; }
  .ai-dot-1 { animation: ai-dot-bounce 1.4s ease-in-out infinite; }
  .ai-dot-2 { animation: ai-dot-bounce 1.4s ease-in-out 0.2s infinite; }
  .ai-dot-3 { animation: ai-dot-bounce 1.4s ease-in-out 0.4s infinite; }
`;

// ─── Rich card: Proactive brief ──────────────────────────────────────────────
function BriefCard({ data, onChip }) {
  const sym = currencySymbol("GBP");
  return (
    <div className="ai-msg-in space-y-3">
      {/* Greeting */}
      <div>
        <p className="text-lg font-bold text-white">{data.greeting}</p>
        <p className="text-xs text-gray-500">{data.date}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-gray-800/60 border border-gray-700/40 rounded-xl p-2.5 text-center">
          <p className="text-lg font-bold text-white">{data.stats.todayCount}</p>
          <p className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">Today</p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/40 rounded-xl p-2.5 text-center">
          <p className="text-lg font-bold text-white">{data.stats.weekCount}</p>
          <p className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">This Week</p>
        </div>
        <div className={`rounded-xl p-2.5 text-center border ${data.stats.overdueCount > 0 ? "bg-red-950/40 border-red-700/30" : "bg-gray-800/60 border-gray-700/40"}`}>
          <p className={`text-lg font-bold ${data.stats.overdueCount > 0 ? "text-red-400" : "text-white"}`}>{data.stats.overdueCount}</p>
          <p className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">Overdue</p>
        </div>
        <div className="bg-gray-800/60 border border-gray-700/40 rounded-xl p-2.5 text-center">
          <p className="text-sm font-bold text-amber-400">{sym}{Math.round(data.stats.outstanding).toLocaleString()}</p>
          <p className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">Owed</p>
        </div>
      </div>

      {/* Today's events */}
      {data.todayEvents.length > 0 && (
        <div className="bg-gray-800/40 border border-gray-700/30 rounded-xl overflow-hidden">
          {data.todayEvents.map((e, i) => (
            <div key={e.id} className={`flex items-center gap-3 px-3 py-2.5 ${i > 0 ? "border-t border-gray-700/30" : ""}`}>
              <span className="text-xs font-semibold text-gray-500 w-10 flex-shrink-0">{e.start_time || "—"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{e.title}</p>
                {e.location_address && <p className="text-xs text-gray-500 truncate">{e.location_address}</p>}
              </div>
              {e.total_price > 0 && (
                <span className="text-xs font-semibold text-green-400 flex-shrink-0">{currencySymbol(e.currency)}{e.total_price.toLocaleString()}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {data.todayEvents.length === 0 && (
        <p className="text-sm text-gray-500">Nothing scheduled for today.</p>
      )}

      {/* Overdue alert */}
      {data.overdueInvoices.length > 0 && (
        <div className="bg-red-950/30 border border-red-700/30 rounded-xl px-3 py-2.5">
          <p className="text-xs font-semibold text-red-400 mb-1.5">Overdue invoices</p>
          {data.overdueInvoices.map(inv => (
            <div key={inv.id} className="flex items-center justify-between py-0.5">
              <div>
                <p className="text-xs text-gray-300">{inv.client_name || inv.title}</p>
                <p className="text-[10px] text-red-500">{inv.days_overdue}d overdue</p>
              </div>
              <span className="text-xs font-semibold text-red-400">{currencySymbol("GBP")}{(inv.total || 0).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Suggestion chips */}
      <div className="flex flex-wrap gap-2">
        {data.chips.map(chip => (
          <button
            key={chip}
            onClick={() => onChip(chip)}
            className="bg-indigo-950/60 border border-indigo-700/30 rounded-full px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-900/60 hover:border-indigo-600/50 transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── User bubble ─────────────────────────────────────────────────────────────
function UserBubble({ message }) {
  return (
    <div className="flex justify-end ai-msg-in">
      <div className="max-w-[80%] bg-indigo-600/20 border border-indigo-700/30 text-indigo-100 px-4 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed">
        {message.content}
      </div>
    </div>
  );
}

// ─── Assistant bubble ─────────────────────────────────────────────────────────
function AssistantBubble({ message }) {
  return (
    <div className="flex items-start gap-2.5 ai-msg-in">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center mt-0.5">
        <Sparkles className="w-3 h-3 text-indigo-400" />
      </div>
      <div className="max-w-[85%] bg-gray-800/60 border border-gray-700/40 text-gray-100 px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed">
        {message.content}
      </div>
    </div>
  );
}

// ─── Action card ─────────────────────────────────────────────────────────────
function ActionCard({ message, navigate, onClose }) {
  const action = message.action || {};
  const page = action.navigate?.page || action.page;
  const handleView = () => {
    if (!page) return;
    const params = action.navigate?.params || {};
    const query = Object.keys(params).length ? "?" + new URLSearchParams(params).toString() : "";
    onClose();
    navigate(createPageUrl(page) + query);
  };
  return (
    <div className="ai-msg-in">
      <div className="flex items-center justify-between bg-teal-900/30 border border-teal-700/40 rounded-xl px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-teal-400 text-sm flex-shrink-0">✓</span>
          <span className="text-teal-100 text-sm truncate">{message.content}</span>
        </div>
        {page && action.type !== "ERROR" && (
          <button onClick={handleView} className="flex-shrink-0 ml-3 flex items-center gap-1 text-xs text-teal-400 hover:text-teal-200 transition-colors font-medium">
            View <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Thinking dots ───────────────────────────────────────────────────────────
function ThinkingDots() {
  return (
    <div className="flex items-start gap-2.5 ai-msg-in">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center mt-0.5">
        <Sparkles className="w-3 h-3 text-indigo-400" />
      </div>
      <div className="bg-gray-800/60 border border-gray-700/40 rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="flex gap-1.5 items-center">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 ai-dot-1" />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 ai-dot-2" />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 ai-dot-3" />
        </div>
      </div>
    </div>
  );
}

// ─── Brief loading skeleton ───────────────────────────────────────────────────
function BriefSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-5 w-40 bg-gray-800 rounded-lg" />
      <div className="h-3 w-24 bg-gray-800/60 rounded" />
      <div className="grid grid-cols-4 gap-2">
        {[0,1,2,3].map(i => <div key={i} className="h-14 bg-gray-800/60 rounded-xl" />)}
      </div>
      <div className="h-24 bg-gray-800/40 rounded-xl" />
    </div>
  );
}

// ─── Voice orb ───────────────────────────────────────────────────────────────
function VoiceOrb({ onCancel }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-950/98">
      <div className="relative flex items-center justify-center mb-8">
        {/* Outer glow */}
        <div className="absolute w-48 h-48 rounded-full bg-indigo-500/10 ai-orb-glow" />
        <div className="absolute w-40 h-40 rounded-full bg-indigo-500/15 ai-orb-glow" style={{ animationDelay: "0.5s" }} />
        {/* Orb */}
        <div
          className="relative w-32 h-32 rounded-full ai-orb-speaking"
          style={{ background: "radial-gradient(circle at 38% 38%, #a5b4fc, #6366f1, #4338ca)" }}
        >
          <div className="absolute inset-0 rounded-full flex items-center justify-center">
            <Mic className="w-10 h-10 text-white/80" />
          </div>
        </div>
      </div>
      <p className="text-sm text-indigo-300 font-medium animate-pulse">Listening…</p>
      <p className="text-xs text-gray-600 mt-1">Speak now, tap to cancel</p>
      <button
        onClick={onCancel}
        className="mt-10 w-12 h-12 rounded-full bg-gray-800 border border-gray-700 text-gray-400 hover:text-white flex items-center justify-center transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export default function AIAssistantPanel({
  open,
  onClose,
  navigate,
  messages,
  loading,
  briefLoading,
  sendMessage,
  clearHistory,
  pendingNavigate,
  clearPendingNavigate,
}) {
  const [input, setInput] = useState("");
  const [closing, setClosing] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const { listening, start: startListening, stop: stopListening, supported: micSupported } = useSpeechInput();

  // Scroll to bottom on new messages
  useEffect(() => {
    if (open) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [messages, open, loading, briefLoading]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300);
  }, [open]);

  // Stop recording when panel closes
  useEffect(() => {
    if (!open && listening) stopListening();
  }, [open, listening, stopListening]);

  // Execute pending navigation
  useEffect(() => {
    if (pendingNavigate) {
      const { page, params = {} } = pendingNavigate;
      const query = Object.keys(params).length ? "?" + new URLSearchParams(params).toString() : "";
      handleClose();
      navigate(createPageUrl(page) + query);
      clearPendingNavigate();
    }
  }, [pendingNavigate]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 240);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    sendMessage(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleVoiceResult = (transcript) => {
    if (transcript.trim()) sendMessage(transcript.trim());
  };

  const handleMicClick = () => {
    if (listening) stopListening();
    else startListening(handleVoiceResult);
  };

  const handleChip = (text) => sendMessage(text);

  if (!open && !closing) return null;

  const isThinking = loading || briefLoading;

  return (
    <>
      <style>{AI_STYLES}</style>

      {/* Full-screen overlay */}
      <div className={`fixed inset-0 z-50 flex flex-col ${closing ? "ai-overlay-close" : "ai-overlay-open"}`}>

        {/* Glass background */}
        <div className="absolute inset-0 bg-gray-950" style={{ backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)" }} />

        {/* Glow border when thinking */}
        <div className={`absolute inset-0 pointer-events-none transition-all duration-500 ${isThinking ? "ai-thinking" : ""}`} />

        {/* Content */}
        <div className="relative flex flex-col h-full max-w-xl mx-auto w-full">

          {/* ── Top bar ── */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-900/60">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white leading-tight">Flowtone AI</p>
                <p className="text-[10px] text-indigo-400 leading-tight">Your music business assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={clearHistory}
                title="Clear"
                className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800/60 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800/60 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Thin separator */}
          <div className="h-px bg-gray-800/60 mx-4 flex-shrink-0" />

          {/* ── Messages ── */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">

            {/* Brief skeleton */}
            {briefLoading && <BriefSkeleton />}

            {messages.map(msg => {
              if (msg.role === "brief")
                return <BriefCard key={msg.id} data={msg.richData} onChip={handleChip} />;
              if (msg.role === "user")
                return <UserBubble key={msg.id} message={msg} />;
              if (msg.role === "assistant")
                return <AssistantBubble key={msg.id} message={msg} />;
              if (msg.role === "action")
                return <ActionCard key={msg.id} message={msg} navigate={navigate} onClose={handleClose} />;
              return null;
            })}

            {loading && <ThinkingDots />}
            <div ref={messagesEndRef} />
          </div>

          {/* ── Input area ── */}
          <div
            className="flex-shrink-0 px-4 pt-3"
            style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
          >
            <div className={`flex items-center gap-2 bg-gray-800/60 border rounded-2xl px-3 py-2 transition-all duration-200 ${isThinking ? "border-indigo-500/40" : "border-gray-700/50"}`}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything…"
                disabled={loading}
                className="flex-1 min-w-0 bg-transparent text-white text-sm placeholder-gray-600 outline-none"
                style={{ fontSize: "16px" }}
              />
              {micSupported && (
                <button
                  type="button"
                  onClick={handleMicClick}
                  className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                    listening ? "bg-red-600/20 text-red-400" : "bg-gray-700/60 text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                  !loading && input.trim()
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                    : "bg-gray-700/40 text-gray-600 cursor-not-allowed"
                }`}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-center text-[10px] text-gray-700 mt-1.5">Flowtone AI · your data stays on your device</p>
          </div>
        </div>

        {/* Voice orb — shown over everything when listening */}
        {listening && <VoiceOrb onCancel={handleMicClick} />}
      </div>
    </>
  );
}
