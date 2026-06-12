import { Sparkles } from "lucide-react";

export function AssistantBubble({ children }) {
  return (
    <div className="flex items-start gap-2.5 mb-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
      </div>
      <div className="max-w-[80%] bg-gray-800 text-gray-100 px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed shadow">
        {children}
      </div>
    </div>
  );
}

export function UserBubble({ children }) {
  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[80%] bg-indigo-600 text-white px-4 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed shadow-lg shadow-indigo-900/30">
        {children}
      </div>
    </div>
  );
}

export function TypingBubble() {
  return (
    <div className="flex items-start gap-2.5 mb-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
      </div>
      <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 shadow">
        <div className="flex gap-1.5 items-center">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}
