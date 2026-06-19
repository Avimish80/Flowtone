import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";

// Interactive "press here, then here" tour that spotlights the REAL app chrome
// (bottom nav + AI button) instead of a talk-heavy monologue. Each step points
// at an element marked with data-tour="<anchor>" (added in Layout.jsx and
// AIAssistantButton.jsx). Self-contained: auto-starts once after onboarding via
// a localStorage flag, and replays on a window "flowtone:start-tour" event
// (fired from Settings).

const STEPS = [
  { anchor: "nav-home", title: "Home base", body: "Your next gig, this week, and anything overdue — all at a glance." },
  { anchor: "nav-calendar", title: "Calendar", body: "See your whole month and tap any day to see what's on." },
  { anchor: "nav-events", title: "Events", body: "Every gig, lesson and rehearsal lives here — with fees and venues." },
  { anchor: "nav-finance", title: "Finance", body: "Invoices, estimates, and exactly what you're owed." },
  { anchor: "nav-more", title: "Everything else", body: "Clients, gear, practice and settings are tucked in here." },
  { anchor: "ai", title: "Meet Flow", body: "Tap me anytime — say \"book a wedding Friday for £400\" and it's done." },
];

const DONE_KEY = "flowtone_tour_done_v1";
const PENDING_KEY = "flowtone_tour_pending";
const PAD = 8;

const readFlag = (k) => { try { return localStorage.getItem(k) === "1"; } catch { return false; } };

export default function CoachMarks() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);

  const start = useCallback(() => { setStep(0); setActive(true); }, []);

  // Auto-start once after onboarding; always available via the replay event.
  useEffect(() => {
    let timer;
    if (readFlag(PENDING_KEY) && !readFlag(DONE_KEY)) {
      timer = setTimeout(start, 700); // let the dashboard paint first
    }
    const onReplay = () => start();
    window.addEventListener("flowtone:start-tour", onReplay);
    return () => { if (timer) clearTimeout(timer); window.removeEventListener("flowtone:start-tour", onReplay); };
  }, [start]);

  // Measure the current anchor; keep it correct on resize/scroll.
  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const s = STEPS[step];
      const el = s && document.querySelector(`[data-tour="${s.anchor}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [active, step]);

  const finish = useCallback(() => {
    setActive(false);
    try { localStorage.setItem(DONE_KEY, "1"); localStorage.removeItem(PENDING_KEY); } catch {}
  }, []);

  if (!active) return null;

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const next = () => (isLast ? finish() : setStep((i) => i + 1));

  // Spotlight hole around the target (transparent centre, dark everywhere else
  // via a huge box-shadow). pointer-events:none so it's purely visual.
  const hole = rect && {
    position: "fixed",
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
    borderRadius: 14,
    boxShadow: "0 0 0 9999px rgba(2,6,23,0.80)",
    border: "2px solid rgba(129,140,248,0.9)",
    pointerEvents: "none",
    transition: "all 180ms ease",
  };

  // Card sits above the target when the target is in the lower half (the nav and
  // AI button always are); otherwise below. Centred horizontally with margins.
  const below = rect ? rect.top < window.innerHeight / 2 : true;
  const card = rect
    ? {
        position: "fixed",
        left: 16,
        right: 16,
        ...(below ? { top: rect.top + rect.height + PAD + 12 } : { bottom: window.innerHeight - rect.top + PAD + 12 }),
      }
    : { position: "fixed", left: 16, right: 16, top: "40%" };

  return createPortal(
    <div className="fixed inset-0 z-[9999]" style={{ background: rect ? "transparent" : "rgba(2,6,23,0.80)" }}>
      {hole && <div style={hole} />}

      <div style={card} className="mx-auto max-w-sm">
        <div className="rounded-2xl border border-indigo-500/30 bg-gray-900 shadow-2xl shadow-black/50 p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <p className="text-sm font-semibold text-white">{s.title}</p>
            <span className="ml-auto text-[11px] text-gray-500">{step + 1} / {STEPS.length}</span>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">{s.body}</p>

          <div className="flex items-center gap-1.5 mt-3.5">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-indigo-400" : "w-1.5 bg-gray-700"}`} />
            ))}
            <div className="flex-1" />
            <button onClick={finish} className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 transition-colors">
              Skip
            </button>
            <button onClick={next} className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-3.5 py-1.5 transition-colors">
              {isLast ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
