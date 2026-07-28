import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * Full-screen preview of the real printed document.
 *
 * The sheet is rendered at full A4 width and scaled to fit, so the preview
 * shows true page proportions. Letting a phone-width iframe reflow the
 * document instead just shows a layout the printed invoice never has.
 *
 * Deliberately NOT window.open: in the iOS standalone PWA a new window
 * replaces the whole app and strands the user on the document with no way
 * back — the same trap printInvoice() avoids with its hidden iframe.
 */

// A4 at the width the templates lay out to (820 × 210:297).
export const PREVIEW_W = 820;
export const PREVIEW_H = 1160;

export default function DocumentPreview({ html, title = "Preview", onClose }) {
  const [scale, setScale] = useState(1);
  const fitRef = useRef(null);

  useEffect(() => {
    if (!html) return;
    const el = fitRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / PREVIEW_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [html]);

  // Escape closes, matching every other dismissable surface in the app.
  useEffect(() => {
    if (!html) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [html, onClose]);

  if (!html) return null;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <p className="text-sm text-gray-300">{title}</p>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-1.5 -mr-1.5 transition-colors"
          aria-label="Close preview"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div
        className="flex-1 overflow-auto px-3 pb-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div ref={fitRef} className="w-full">
          <div className="mx-auto" style={{ width: PREVIEW_W * scale, height: PREVIEW_H * scale }}>
            <iframe
              title={title}
              srcDoc={html}
              sandbox=""
              scrolling="no"
              className="bg-white rounded-lg"
              style={{
                width: PREVIEW_W,
                height: PREVIEW_H,
                border: 0,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
