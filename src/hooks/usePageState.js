import { useState, useEffect } from "react";

const PREFIX = "mos_";

/**
 * Drop-in replacement for useState that persists values in sessionStorage.
 * State survives component unmount/remount (navigation) but clears when the tab closes.
 *
 * @param {string} key   Unique key scoped to the page/field (e.g. "invoices_filterStatus")
 * @param {*}      init  Default value (used when nothing is stored yet)
 * @returns {[*, Function]}  Same API as useState
 */
export function usePageState(key, init) {
  const storageKey = PREFIX + key;

  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw !== null) return JSON.parse(raw);
    } catch {
      /* ignore corrupt data */
    }
    return init;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* sessionStorage full or unavailable */
    }
  }, [storageKey, value]);

  return [value, setValue];
}
