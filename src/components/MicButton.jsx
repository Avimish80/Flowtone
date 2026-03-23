import { Mic } from "lucide-react";
import { useSpeechInput } from "@/hooks/useSpeechInput";

/**
 * A small circular mic button that uses the Web Speech API.
 *
 * Props:
 *   onResult(text) — called with the spoken transcript when recognition ends
 *   className      — extra Tailwind classes for the button wrapper
 */
export default function MicButton({ onResult, className = "" }) {
  const { listening, start, stop, supported } = useSpeechInput();

  // Hide entirely when the browser does not support the API
  if (!supported) return null;

  const handleClick = () => {
    if (listening) {
      stop();
    } else {
      start(onResult);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={listening ? "Stop recording" : "Speak to fill title"}
      className={[
        "flex items-center justify-center w-8 h-8 rounded-full transition-all focus:outline-none",
        listening
          ? "bg-red-600 text-white animate-pulse shadow-lg shadow-red-900/50"
          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 border border-gray-700",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={listening ? "Stop recording" : "Start voice input"}
      aria-pressed={listening}
    >
      <Mic className="w-4 h-4" />
    </button>
  );
}
