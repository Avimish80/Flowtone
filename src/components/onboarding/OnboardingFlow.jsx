import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { createPageUrl } from "@/utils";
import { useAuth } from "@/lib/AuthContext";
import {
  saveAssistantProfile,
  deriveFallbackName,
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_LANGUAGE,
} from "@/lib/assistantProfile";
import { STEPS } from "./onboardingScript";
import { AssistantBubble, UserBubble, TypingBubble } from "./OnboardingBubbles";
import OnboardingInput from "./OnboardingInput";

let msgId = 0;
const nextId = () => ++msgId;

export default function OnboardingFlow({ onFinish }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [stepIndex, setStepIndex] = useState(0);
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [inputEnabled, setInputEnabled] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [saving, setSaving] = useState(false);

  const answersRef = useRef({});
  const messagesEndRef = useRef(null);

  const step = STEPS[stepIndex];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing, showActions]);

  // Step engine: type, reveal the bubble, then advance or wait for input
  useEffect(() => {
    if (!step) return undefined;

    const answers = answersRef.current;
    const text = step.type === "say" ? step.text(answers) : step.prompt(answers);

    setTyping(true);
    setInputEnabled(false);

    const typingDelay = Math.min(1500, Math.max(600, text.length * 25));
    const timers = [];

    timers.push(setTimeout(() => {
      setTyping(false);
      setMessages((prev) => [...prev, { id: nextId(), role: "assistant", content: text }]);

      if (step.type === "ask") {
        setInputEnabled(true);
      } else if (step.actions) {
        timers.push(setTimeout(() => setShowActions(true), 400));
      } else {
        timers.push(setTimeout(() => setStepIndex((i) => i + 1), 700));
      }
    }, typingDelay));

    return () => timers.forEach(clearTimeout);
  }, [stepIndex]);

  const handleAnswer = (value) => {
    if (!step || step.type !== "ask") return;
    answersRef.current = { ...answersRef.current, [step.field]: value };
    setMessages((prev) => [...prev, { id: nextId(), role: "user", content: value }]);
    setInputEnabled(false);
    setStepIndex((i) => i + 1);
  };

  const buildProfile = ({ skipped }) => {
    const a = answersRef.current;
    return {
      user_name: a.user_name || deriveFallbackName(user),
      assistant_name: a.assistant_name || DEFAULT_ASSISTANT_NAME,
      language: a.language || DEFAULT_LANGUAGE,
      profession: a.profession || "",
      completed_at: skipped ? null : new Date().toISOString(),
      skipped,
    };
  };

  const finishWith = async ({ skipped = false, after } = {}) => {
    if (saving) return;
    setSaving(true);
    try {
      await saveAssistantProfile(buildProfile({ skipped }));
    } catch (err) {
      // Fail open — they'll see onboarding again next session
      console.warn("Onboarding: could not save profile", err);
    }
    onFinish();
    if (after) after();
  };

  const handleAction = (action) => {
    if (action.kind === "navigate") {
      finishWith({ after: () => navigate(createPageUrl(action.page)) });
    } else if (action.kind === "ai_prefill") {
      try {
        sessionStorage.setItem("flowtone_onboarding_prefill", action.message);
      } catch {
        // storage unavailable — they land on the dashboard instead
      }
      finishWith();
    } else {
      finishWith();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-900/50">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <p className="text-sm font-semibold text-white">Flowtone</p>
        </div>
        <button
          onClick={() => finishWith({ skipped: true })}
          disabled={saving}
          className="text-gray-500 hover:text-gray-300 text-sm transition-colors disabled:opacity-50"
        >
          Skip
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {messages.map((msg) =>
          msg.role === "user" ? (
            <UserBubble key={msg.id}>{msg.content}</UserBubble>
          ) : (
            <AssistantBubble key={msg.id}>{msg.content}</AssistantBubble>
          )
        )}
        {typing && <TypingBubble />}

        {showActions && step?.actions && (
          <div className="flex flex-col gap-2 mt-4 pl-9">
            {step.actions.map((action) => (
              <button
                key={action.label}
                onClick={() => handleAction(action)}
                disabled={saving}
                className="text-left bg-indigo-600/25 border border-indigo-500/30 text-indigo-200 px-4 py-3 rounded-xl text-sm hover:bg-indigo-600/40 active:bg-indigo-600/50 transition-colors disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className="flex-shrink-0 border-t border-gray-800 bg-gray-950"
        style={{ padding: "12px", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        {inputEnabled && step?.input ? (
          <OnboardingInput input={step.input} onSubmit={handleAnswer} disabled={saving} />
        ) : (
          <p className="text-center text-[10px] text-gray-700 py-2">Flowtone · First-time setup</p>
        )}
      </div>
    </div>
  );
}
