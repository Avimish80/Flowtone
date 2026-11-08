import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

export default function OnboardingInput({ input, onSubmit, disabled }) {
  const [value, setValue] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    setValue("");
    if (!disabled && input?.kind === "text") {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, disabled]);

  if (!input) return null;

  const submit = (text) => {
    const trimmed = (text ?? value).trim();
    const finalValue = trimmed || input.defaultValue || "";
    if (!finalValue) return;
    setValue("");
    onSubmit(finalValue);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="space-y-3">
      {input.kind === "chips" && (
        <div className="flex flex-wrap gap-2">
          {input.options.map((option) => (
            <button
              key={option}
              onClick={() => submit(option)}
              disabled={disabled}
              className="bg-gray-800 border border-gray-700 hover:border-gray-500 text-gray-200 rounded-full px-4 py-2 text-sm transition-colors disabled:opacity-50"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {(input.kind === "text" || input.allowFreeText) && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={input.placeholder || ""}
            disabled={disabled}
            className="bg-gray-900 border border-gray-700 text-white placeholder-gray-500"
            style={{
              flex: "1 1 0%",
              minWidth: 0,
              borderRadius: "16px",
              padding: "10px 14px",
              fontSize: "16px",
              outline: "none",
            }}
          />
          <button
            onClick={() => submit()}
            disabled={disabled || (!value.trim() && !input.defaultValue)}
            aria-label="Send"
            className={disabled || (!value.trim() && !input.defaultValue) ? "bg-gray-800 text-gray-600" : "bg-ink text-ink-fg"}
            style={{
              flexShrink: 0,
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <Send size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
