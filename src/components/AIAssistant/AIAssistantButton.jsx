import { Sparkles } from "lucide-react";

/**
 * Floating action button that opens the AI Assistant panel.
 *
 * Props:
 *   onClick — called when the button is clicked
 */
export default function AIAssistantButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour="ai"
      aria-label="Open Flow Assistant"
      title="Flow Assistant"
      className={[
        // Positioning — above the bottom nav bar
        "fixed right-4 z-40",
        // Mobile: bottom-20 (above 64px nav + 16px gap)
        "bottom-20",
        // Desktop: bottom-6
        "sm:bottom-6",
        // Shape & size
        "w-12 h-12 rounded-full",
        // Color
        "bg-indigo-600 text-white",
        // Glow / shadow
        "shadow-xl shadow-indigo-900/60",
        // Ring glow animation
        "ring-2 ring-indigo-500/40",
        // Hover / active
        "hover:bg-indigo-500 hover:scale-105 active:scale-95",
        // Transition
        "transition-all duration-150",
        // Focus
        "focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-gray-950",
        // Subtle pulse on the ring to draw attention
        "animate-[pulse_3s_ease-in-out_infinite]",
      ].join(" ")}
      style={{
        // Override the default pulse to affect only the box-shadow ring, not opacity
        animation: "flowtone-ai-glow 3s ease-in-out infinite",
      }}
    >
      <style>{`
        @keyframes flowtone-ai-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.5), 0 10px 30px -6px rgba(99,102,241,0.6); }
          50%       { box-shadow: 0 0 0 6px rgba(99,102,241,0), 0 10px 30px -6px rgba(99,102,241,0.4); }
        }
      `}</style>
      <span className="flex items-center justify-center w-full h-full">
        <Sparkles className="w-5 h-5" />
      </span>
    </button>
  );
}
