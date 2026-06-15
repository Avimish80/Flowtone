import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Bell, Mail, Calendar, Check, Loader2 } from "lucide-react";
import { createPageUrl } from "@/utils";
import { useAuth } from "@/lib/AuthContext";
import { appClient } from "@/api/appClient";
import {
  saveAssistantProfile,
  deriveFallbackName,
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_LANGUAGE,
} from "@/lib/assistantProfile";
import { registerPush, isPushActive } from "@/lib/pushManager";
import { connectGmail, isGmailConnected, getGmailEmail } from "@/lib/gmailClient";
import { STEPS } from "./onboardingScript";
import { AssistantBubble, UserBubble, TypingBubble } from "./OnboardingBubbles";
import OnboardingInput from "./OnboardingInput";

let msgId = 0;
const nextId = () => ++msgId;

// A single flat row in the "Connect your tools" menu — plain UI, no chat.
function ConnectRow({ icon, label, sub, subError, done, doneLabel, actionLabel, onAction, busy, disabled }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 last:border-b-0">
      <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0 text-gray-300">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{label}</p>
        {sub ? (
          <p className={`text-xs truncate ${subError ? "text-amber-400" : "text-gray-500"}`}>{sub}</p>
        ) : null}
      </div>
      {disabled ? (
        <span className="text-xs text-gray-600 font-medium px-2">Coming soon</span>
      ) : done ? (
        <span className="flex items-center gap-1 text-xs font-semibold text-green-400 px-2">
          <Check className="w-3.5 h-3.5" /> {doneLabel}
        </span>
      ) : (
        <button
          onClick={onAction}
          disabled={busy}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default function OnboardingFlow({ onFinish }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [stepIndex, setStepIndex] = useState(0);
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [inputEnabled, setInputEnabled] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [saving, setSaving] = useState(false);

  // "Connect your tools" final-step state
  const [showConnect, setShowConnect] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  const [gmailOn, setGmailOn] = useState(isGmailConnected());
  const [gmailEmail] = useState(getGmailEmail());
  const [gmailBusy, setGmailBusy] = useState(false);

  const answersRef = useRef({});
  const scrollRef = useRef(null);

  // Reflect the live push-subscription state in the connect menu
  useEffect(() => {
    isPushActive().then(setPushOn).catch(() => {});
  }, []);

  const step = STEPS[stepIndex];

  // Scroll the messages container directly — scrollIntoView can scroll the
  // whole page on iOS with the keyboard open, hiding the latest messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing, showActions, showConnect, inputEnabled]);

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
      } else if (step.connect) {
        timers.push(setTimeout(() => setShowConnect(true), 400));
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

  const applyBusinessAnswers = async () => {
    const a = answersRef.current;

    if (a.currency) {
      const settings = await appClient.helpers.ensureSingletonEntity("AppSettings");
      await appClient.entities.AppSettings.update(settings.id, {
        currency: a.currency,
        default_currency: a.currency,
      });
    }

    const businessName = a.business_name || a.user_name;
    if (businessName) {
      const profile = await appClient.helpers.ensureSingletonEntity("BusinessProfile");
      if (!profile.business_name) {
        await appClient.entities.BusinessProfile.update(profile.id, { business_name: businessName });
      }
    }
  };

  const persistProfile = async ({ skipped = false } = {}) => {
    try {
      await saveAssistantProfile(buildProfile({ skipped }));
      await applyBusinessAnswers();
    } catch (err) {
      // Fail open — they'll see onboarding again next session
      console.warn("Onboarding: could not save profile", err);
    }
  };

  const finishWith = async ({ skipped = false, after } = {}) => {
    if (saving) return;
    setSaving(true);
    await persistProfile({ skipped });
    onFinish();
    if (after) after();
  };

  const handleEnableNotifications = async () => {
    if (pushBusy || pushOn) return;
    setPushBusy(true);
    setPushError("");
    try {
      const result = await registerPush("standard");
      if (result.success) {
        setPushOn(true);
      } else if (result.reason === "denied") {
        setPushError("Blocked — allow notifications in iOS Settings.");
      } else {
        setPushError("Not supported on this device.");
      }
    } catch {
      setPushError("Could not enable notifications.");
    }
    setPushBusy(false);
  };

  const handleConnectGmail = async () => {
    if (gmailBusy || gmailOn) return;
    setGmailBusy(true);
    // Gmail OAuth is a full-page redirect that leaves the app. Persist
    // onboarding completion first so the user isn't sent back through
    // onboarding when Google returns them to the app.
    await persistProfile({ skipped: false });
    try {
      await connectGmail();
    } catch {
      setGmailBusy(false);
    }
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
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

        {showConnect && step?.connect && (
          <div className="mt-4 pl-9">
            <div className="rounded-2xl border border-gray-700/60 bg-gray-800/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <p className="text-sm font-semibold text-white">Connect your tools</p>
                <p className="text-xs text-gray-500 mt-0.5">Set these up now, or later in Settings.</p>
              </div>
              <ConnectRow
                icon={<Bell className="w-4 h-4" />}
                label="Notifications"
                sub={pushError || "Gig & invoice reminders"}
                subError={!!pushError}
                done={pushOn}
                doneLabel="On"
                actionLabel="Enable"
                onAction={handleEnableNotifications}
                busy={pushBusy}
              />
              <ConnectRow
                icon={<Mail className="w-4 h-4" />}
                label="Gmail"
                sub={gmailOn ? (gmailEmail || "Connected") : "Send invoices from your inbox"}
                done={gmailOn}
                doneLabel="Connected"
                actionLabel="Connect"
                onAction={handleConnectGmail}
                busy={gmailBusy}
              />
              <ConnectRow
                icon={<Calendar className="w-4 h-4" />}
                label="Google Calendar"
                sub="Sync gigs to your calendar"
                disabled
              />
            </div>
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => finishWith({ skipped: false })}
                disabled={saving}
                className="text-gray-500 hover:text-gray-300 text-sm transition-colors disabled:opacity-50"
              >
                Skip for now
              </button>
              <button
                onClick={() => finishWith({ skipped: false })}
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div
        className="flex-shrink-0 border-t border-gray-800 bg-gray-950"
        style={{ padding: "12px", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        {inputEnabled && step?.input ? (
          <OnboardingInput
            input={{
              ...step.input,
              defaultValue:
                typeof step.input.defaultValue === "function"
                  ? step.input.defaultValue(answersRef.current)
                  : step.input.defaultValue,
            }}
            onSubmit={handleAnswer}
            disabled={saving}
          />
        ) : (
          <p className="text-center text-[10px] text-gray-700 py-2">Flowtone · First-time setup</p>
        )}
      </div>
    </div>
  );
}
