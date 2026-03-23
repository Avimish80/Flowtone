import { useEffect, useRef, useState } from "react";
import { X, Trash2, Send, Sparkles, ExternalLink } from "lucide-react";
import MicButton from "@/components/MicButton";
import { createPageUrl } from "@/utils";

// ─── Message bubble ──────────────────────────────────────────────────────────

function UserBubble({ message }) {
  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[80%] bg-indigo-600 text-white px-4 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed shadow-lg shadow-indigo-900/30">
        {message.content}
      </div>
    </div>
  );
}

function AssistantBubble({ message }) {
  return (
    <div className="flex items-start gap-2.5 mb-3">
      {/* Avatar */}
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
      </div>
      <div className="max-w-[80%] bg-gray-800 text-gray-100 px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed shadow">
        {message.content}
      </div>
    </div>
  );
}

function ActionCard({ message, navigate }) {
  const action = message.action || {};
  const page = action.navigate?.page || action.page;

  const handleView = () => {
    if (!page) return;
    const params = action.navigate?.params || {};
    const query = Object.keys(params).length
      ? "?" + new URLSearchParams(params).toString()
      : "";
    navigate(createPageUrl(page) + query);
  };

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between bg-teal-900/40 border border-teal-700/50 rounded-xl px-4 py-2.5 shadow">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-teal-400 text-base leading-none flex-shrink-0">✓</span>
          <span className="text-teal-100 text-sm truncate">{message.content}</span>
        </div>
        {page && action.type !== "ERROR" && (
          <button
            onClick={handleView}
            className="flex-shrink-0 ml-3 flex items-center gap-1 text-xs text-teal-400 hover:text-teal-200 transition-colors font-medium"
          >
            View
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function LoadingBubble() {
  return (
    <div className="flex items-start gap-2.5 mb-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
      </div>
      <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 shadow">
        <div className="flex gap-1.5 items-center">
          <span
            className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

/**
 * Props:
 *   open           — boolean
 *   onClose        — () => void
 *   navigate       — react-router navigate function
 *   messages       — message array from useAIAssistant
 *   loading        — boolean
 *   sendMessage    — (text: string) => void
 *   clearHistory   — () => void
 *   pendingNavigate — { page, params } | null
 *   clearPendingNavigate — () => void
 */
export default function AIAssistantPanel({
  open,
  onClose,
  navigate,
  messages,
  loading,
  sendMessage,
  clearHistory,
  pendingNavigate,
  clearPendingNavigate,
}) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll to bottom on new messages or loading state change
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    }
  }, [messages, open, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // Execute pending navigation from AI actions
  useEffect(() => {
    if (pendingNavigate) {
      const { page, params = {} } = pendingNavigate;
      const query = Object.keys(params).length
        ? "?" + new URLSearchParams(params).toString()
        : "";
      navigate(createPageUrl(page) + query);
      clearPendingNavigate();
    }
  }, [pendingNavigate, navigate, clearPendingNavigate]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    sendMessage(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Voice result — auto-send immediately without filling input
  const handleVoiceResult = (transcript) => {
    if (transcript.trim()) {
      sendMessage(transcript.trim());
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={[
          "fixed z-50 flex flex-col",
          // Full-width slide-up on mobile
          "bottom-0 left-0 right-0",
          // Centered floating card on desktop
          "sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto sm:w-full sm:max-w-lg",
          // Styling
          "bg-gray-950 border border-gray-800",
          "rounded-t-2xl sm:rounded-2xl",
          "shadow-2xl shadow-black/60",
          // Height
          "h-[80vh] sm:h-[600px]",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-900/50">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">
                GigFlow Assistant
              </p>
              <p className="text-[10px] text-indigo-400 leading-tight">
                AI-powered musician OS
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={clearHistory}
              title="Clear history"
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              title="Close"
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.map((msg) => {
            if (msg.role === "user")
              return <UserBubble key={msg.id} message={msg} />;
            if (msg.role === "assistant")
              return <AssistantBubble key={msg.id} message={msg} />;
            if (msg.role === "action")
              return (
                <ActionCard key={msg.id} message={msg} navigate={navigate} />
              );
            return null;
          })}
          {loading && <LoadingBubble />}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Input area ── */}
        <div className="flex-shrink-0 px-3 py-3 border-t border-gray-800 bg-gray-950 rounded-b-2xl">
          <div className="flex items-center gap-2 bg-gray-900 rounded-2xl px-3 py-2 border border-gray-800 focus-within:border-indigo-700/60 transition-colors">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your gigs…"
              disabled={loading}
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none min-w-0 disabled:opacity-50"
            />
            <MicButton
              onResult={handleVoiceResult}
              className="flex-shrink-0"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className={[
                "flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all",
                loading || !input.trim()
                  ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                  : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/50 active:scale-95",
              ].join(" ")}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-center text-[10px] text-gray-700 mt-1.5">
            GigFlow AI · Local app data only
          </p>
        </div>
      </div>
    </>
  );
}
