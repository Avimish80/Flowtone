// Run a callback when the app opens and every time it comes back to the front.
// iOS app: Capacitor's appStateChange. Web/PWA: visibilitychange (installed
// PWAs often resume without re-mounting). `throttleMs` skips calls that come
// sooner than that after the previous one.
//
//   useAppResume((reason) => { ... }, { throttleMs: 30 * 1000 });
//   reason is "open" or "resume".

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

export function useAppResume(callback, { throttleMs = 0 } = {}) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let last = 0;
    const fire = (reason) => {
      const now = Date.now();
      if (throttleMs && last && now - last < throttleMs) return;
      last = now;
      Promise.resolve()
        .then(() => callbackRef.current?.(reason))
        .catch(() => {});
    };

    fire("open");

    if (Capacitor.isNativePlatform()) {
      const listener = App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) fire("resume");
      });
      return () => { listener.then((h) => h.remove()).catch(() => {}); };
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") fire("resume");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [throttleMs]);
}

export default useAppResume;
