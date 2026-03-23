import { useEffect } from "react";

const PREFIX = "mos_scroll_";

/**
 * Saves the window scroll position to sessionStorage when the component
 * unmounts, and restores it on the next mount.
 *
 * @param {string} key  Unique key per page (e.g. "work_events", "clients")
 */
export function useScrollRestore(key) {
  useEffect(() => {
    const saved = sessionStorage.getItem(PREFIX + key);
    if (saved) {
      // Wait one frame for the list to render before scrolling
      requestAnimationFrame(() => window.scrollTo(0, parseInt(saved, 10)));
    }
    return () => {
      sessionStorage.setItem(PREFIX + key, String(Math.round(window.scrollY)));
    };
  }, [key]);
}
