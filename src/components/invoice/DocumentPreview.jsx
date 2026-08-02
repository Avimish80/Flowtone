import { useEffect, useRef, useState } from "react";
import { ArrowLeft, X } from "lucide-react";

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
 *
 * Getting OUT is deliberately over-provided: a labelled Back control, a
 * thumb-reachable Done bar, a tap on the surrounding backdrop, Escape, and the
 * device's own back gesture. An icon-only X in the top corner is easy to miss
 * on a phone and out of reach on a large one, and a full-screen layer with no
 * obvious exit reads as the app having frozen.
 */

// A4 at the width the templates lay out to (820 × 210:297).
export const PREVIEW_W = 820;
export const PREVIEW_H = 1160;

export default function DocumentPreview({ html, title = "Preview", onClose }) {
  const [scale, setScale] = useState(1);
  const fitRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

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
    const onKey = (e) => { if (e.key === "Escape") closeRef.current?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [html]);

  // Own a history entry while open, so the phone's back gesture / back button
  // dismisses the preview instead of navigating out of the invoice (or out of
  // the app entirely in the standalone PWA, where there is no browser chrome to
  // fall back on).
  useEffect(() => {
    if (!html) return;
    window.history.pushState({ flowtonePreview: true }, "");
    const onPop = () => closeRef.current?.();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closing via a button leaves our entry on the stack — drop it so the
      // next back press doesn't have to be pressed twice. When the close came
      // FROM a back press the entry is already gone, hence the state check.
      if (window.history.state?.flowtonePreview) window.history.back();
    };
  }, [html]);

  if (!html) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-gray-950 flex flex-col">
      <div
        className="flex items-center justify-between gap-3 px-2 py-2 flex-shrink-0 border-b border-gray-800"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-gray-200 hover:text-white px-2 py-2 -my-0.5 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Back</span>
        </button>
        <p className="text-sm text-gray-400 truncate">{title}</p>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-2 rounded-lg transition-colors"
          aria-label="Close preview"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tapping the space around the page closes too. Clicks inside the iframe
          never reach here, so the document itself stays inert. */}
      <div
        className="flex-1 overflow-auto px-3 py-3"
        onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
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

      {/* Thumb-reachable exit — the top corners are a stretch on a large phone. */}
      <div
        className="flex-shrink-0 px-4 pt-2 border-t border-gray-800 bg-gray-950"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <button
          onClick={onClose}
          className="w-full bg-gray-800 hover:bg-gray-700 active:bg-gray-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
