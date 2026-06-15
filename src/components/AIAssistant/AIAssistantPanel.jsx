import { useEffect, useRef, useState } from "react";
import { X, Trash2, Send, Sparkles, ExternalLink, Mic, AlertCircle, MapPin, BookUser } from "lucide-react";
import { useSpeechInput } from "@/hooks/useSpeechInput";
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

function ActionCard({ message, navigate, onClose }) {
  const action = message.action || {};
  const isError = action.type === "ERROR";
  const page = action.navigate?.page || action.page;

  const handleView = () => {
    if (!page) return;
    const params = action.navigate?.params || {};
    const query = Object.keys(params).length
      ? "?" + new URLSearchParams(params).toString()
      : "";
    onClose();
    navigate(createPageUrl(page) + query);
  };

  return (
    <div className="mb-3">
      <div
        className={`flex items-center justify-between border rounded-xl px-4 py-2.5 shadow ${
          isError
            ? "bg-amber-900/30 border-amber-700/50"
            : "bg-teal-900/40 border-teal-700/50"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isError ? (
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          ) : (
            <span className="text-teal-400 text-base leading-none flex-shrink-0">✓</span>
          )}
          <span className={`text-sm truncate ${isError ? "text-amber-100" : "text-teal-100"}`}>
            {message.content}
          </span>
        </div>
        {page && !isError && (
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

function LocationCard({ message, onPick }) {
  const locations = message.locations || [];
  if (!locations.length) return null;
  return (
    <div className="flex items-start gap-2.5 mb-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
      </div>
      <div className="max-w-[85%] w-full space-y-1.5">
        <p className="text-[11px] text-gray-500 px-1">{message.content || "Tap the right place:"}</p>
        {locations.map((loc, i) => (
          <button
            key={i}
            onClick={() => onPick(loc.address)}
            className="w-full text-left flex items-start gap-2 bg-gray-800/70 hover:bg-gray-700 border border-gray-700/60 rounded-xl px-3 py-2 transition-colors"
          >
            <MapPin className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
            <span className="min-w-0">
              <span className="block text-sm text-white truncate">{loc.label}</span>
              <span className="block text-[11px] text-gray-400 truncate">{loc.address}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ContactPickerCard({ message, onPick }) {
  const [picking, setPicking] = useState(false);

  const handlePick = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const contacts = await navigator.contacts.select(["name", "email", "tel"], { multiple: false });
      if (contacts && contacts.length > 0) {
        const c = contacts[0];
        const name = (c.name || [])[0] || message.clientName || "";
        const email = (c.email || [])[0] || "";
        const phone = (c.tel || [])[0] || "";
        onPick({ name, email, phone, clientId: message.clientId });
      }
    } catch {
      // User cancelled or API unavailable — just dismiss silently
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="flex items-start gap-2.5 mb-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
      </div>
      <div className="max-w-[85%] w-full space-y-2">
        <p className="text-sm text-gray-100 bg-gray-800 px-4 py-2.5 rounded-2xl rounded-tl-sm shadow">
          {message.content}
        </p>
        <button
          onClick={handlePick}
          disabled={picking}
          className="flex items-center gap-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-600/40 text-indigo-300 text-sm font-medium rounded-xl px-4 py-2 transition-colors disabled:opacity-50"
        >
          <BookUser className="w-4 h-4" />
          {picking ? "Opening contacts…" : "Pick from contacts"}
        </button>
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
  const { listening, start: startListening, stop: stopListening, supported: micSupported } = useSpeechInput();

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

  // Stop recording when panel closes
  useEffect(() => {
    if (!open && listening) {
      stopListening();
    }
  }, [open, listening, stopListening]);

  // Execute pending navigation from AI actions — close panel first
  useEffect(() => {
    if (pendingNavigate) {
      const { page, params = {} } = pendingNavigate;
      const query = Object.keys(params).length
        ? "?" + new URLSearchParams(params).toString()
        : "";
      onClose();
      navigate(createPageUrl(page) + query);
      clearPendingNavigate();
    }
  }, [pendingNavigate, navigate, clearPendingNavigate, onClose]);

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

  const handleMicClick = () => {
    if (listening) {
      stopListening();
    } else {
      startListening(handleVoiceResult);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop — touch-none prevents scroll passthrough to page */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm touch-none"
        onClick={onClose}
        onWheel={e => e.stopPropagation()}
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
                Flow Assistant
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
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {messages.map((msg) => {
            if (msg.role === "user")
              return <UserBubble key={msg.id} message={msg} />;
            if (msg.role === "assistant")
              return <AssistantBubble key={msg.id} message={msg} />;
            if (msg.role === "action")
              return (
                <ActionCard key={msg.id} message={msg} navigate={navigate} onClose={onClose} />
              );
            if (msg.role === "locations")
              return (
                <LocationCard
                  key={msg.id}
                  message={msg}
                  onPick={(addr) => sendMessage(`Use this location for the event: ${addr}`)}
                />
              );
            if (msg.role === "contact_picker")
              return (
                <ContactPickerCard
                  key={msg.id}
                  message={msg}
                  onPick={({ name, email, phone, clientId }) => {
                    const parts = [];
                    if (email) parts.push(`email ${email}`);
                    if (phone) parts.push(`phone ${phone}`);
                    if (parts.length === 0) return;
                    const target = clientId ? `client id ${clientId}` : (name || "that client");
                    sendMessage(`Add to ${target}: ${parts.join(", ")}`);
                  }}
                />
              );
            return null;
          })}
          {loading && <LoadingBubble />}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Input area ── */}
        <div
          className="flex-shrink-0 border-t border-gray-800 bg-gray-950 rounded-b-2xl"
          style={{ padding: "12px", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
        >
          {/* Big recording UI — shown while mic is active */}
          {listening ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="relative flex items-center justify-center">
                <span className="absolute w-24 h-24 rounded-full bg-red-500/20 animate-ping" />
                <span className="absolute w-20 h-20 rounded-full bg-red-500/30 animate-pulse" />
                <button
                  onClick={handleMicClick}
                  className="relative w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center shadow-2xl shadow-red-900/60 transition-colors z-10"
                  aria-label="Stop recording"
                >
                  <Mic className="w-7 h-7 text-white" />
                </button>
              </div>
              <p className="text-red-400 text-sm font-semibold tracking-wide animate-pulse">● Listening — tap to stop</p>
            </div>
          ) : (
          /* Normal row: input + mic + send */
          <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything…"
              disabled={loading}
              style={{
                flex: "1 1 0%",
                minWidth: 0,
                background: "#111827",
                border: "1px solid #374151",
                borderRadius: "16px",
                padding: "10px 14px",
                color: "white",
                fontSize: "16px",
                outline: "none",
              }}
            />
            {micSupported && (
              <button
                type="button"
                onClick={handleMicClick}
                aria-label="Start voice input"
                style={{
                  flexShrink: 0, width: "36px", height: "36px", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "#1f2937", border: "1px solid #374151", color: "#9ca3af", cursor: "pointer",
                }}
              >
                <Mic size={16} />
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              aria-label="Send"
              style={{
                flexShrink: 0,
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: loading || !input.trim() ? "#1f2937" : "#4f46e5",
                color: loading || !input.trim() ? "#4b5563" : "white",
                border: "none",
                cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              }}
            >
              <Send size={14} />
            </button>
          </div>
          )}
          {!listening && (
            <p className="text-center text-[10px] text-gray-700 mt-1.5">
              Flow AI · Your live account data
            </p>
          )}
        </div>
      </div>
    </>
  );
}
