import { createContext, useContext, useEffect, useState } from "react";

// Privacy mode — "hide fees". When on, a `hide-fees` class is set on <html> and
// CSS blurs every element tagged `.sensitive` (money, totals). Class-on-root +
// CSS cascade means it also covers portaled dialogs/popovers, and toggling is
// instant without every component re-rendering.
const PrivacyContext = createContext({ hideFees: false, toggleHideFees: () => {} });

export function PrivacyProvider({ children }) {
  const [hideFees, setHideFees] = useState(() => {
    try { return localStorage.getItem("flowtone_hide_fees") === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem("flowtone_hide_fees", hideFees ? "1" : "0"); } catch { /* ignore */ }
    document.documentElement.classList.toggle("hide-fees", hideFees);
  }, [hideFees]);

  const toggleHideFees = () => setHideFees((v) => !v);

  return (
    <PrivacyContext.Provider value={{ hideFees, toggleHideFees }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() { return useContext(PrivacyContext); }
