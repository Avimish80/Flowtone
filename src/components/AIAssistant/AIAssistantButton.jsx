import { Sparkles } from "lucide-react";

/**
 * Floating action button that opens the AI Assistant panel.
 *
 * Props:
 *   onClick       — called when the button is clicked
 *   hasSuggestion — true when the assistant has something new to say; shows a
 *                   steady amber dot (no glow: glow is reserved for urgency)
 */
export default function AIAssistantButton({ onClick, hasSuggestion = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour="ai"
      aria-label={hasSuggestion ? "Open Flowtone Assistant, suggestion waiting" : "Open Flowtone Assistant"}
      title="Flowtone Assistant"
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
        "bg-ink text-ink-fg",
        // Plain lift off the page
        "shadow-lg shadow-black/40",
        // Hover / active
        "hover:bg-ink/90 hover:scale-105 active:scale-95",
        // Transition
        "transition-all duration-150",
        // Focus
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950",
      ].join(" ")}
    >
      <span className="flex items-center justify-center w-full h-full">
        <Sparkles className="w-5 h-5" />
      </span>
      {hasSuggestion && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 ring-2 ring-white dark:ring-gray-950"
        />
      )}
    </button>
  );
}
