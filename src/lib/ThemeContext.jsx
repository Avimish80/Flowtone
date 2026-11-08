import { createContext, useContext, useEffect, useState } from "react";

// Accent themes (Pro feature). "graphite" is the default look — no data-accent
// attribute. The others recolor every indigo-* utility and the ink token
// app-wide via CSS variables (see index.css + tailwind.config.js).
// Dark/light mode is a separate, independent axis — do not couple them.
export const ACCENT_THEMES = [
  { id: "graphite", label: "Graphite", swatch: "#e4e4e7", pro: false },
  { id: "brass", label: "Brass", swatch: "#d6b474", pro: true },
  { id: "teal", label: "Teal", swatch: "#5eead4", pro: true },
  { id: "indigo", label: "Indigo", swatch: "#6366f1", pro: true },
];

// The choice used to live under "mos_accent", which the app wrote on every
// start, so nearly every device has "indigo" saved without anyone picking it.
// Read the old key once, map it to the new themes, then use the new key only.
const ACCENT_KEY = "mos_accent_v2";
const LEGACY_ACCENT = { indigo: "graphite", crimson: "graphite", jade: "teal", gold: "brass" };

function loadAccent() {
  const saved = localStorage.getItem(ACCENT_KEY);
  if (saved) return saved;
  const legacy = localStorage.getItem("mos_accent");
  return (legacy && LEGACY_ACCENT[legacy]) || "graphite";
}

const ThemeContext = createContext({
  theme: "dark",
  toggleTheme: () => {},
  accent: "graphite",
  setAccent: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("mos_theme") || "dark"; } catch { return "dark"; }
  });
  const [accent, setAccent] = useState(() => {
    try {
      const saved = loadAccent();
      return ACCENT_THEMES.some(t => t.id === saved) ? saved : "graphite";
    } catch { return "graphite"; }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try { localStorage.setItem("mos_theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (accent === "graphite") {
      delete root.dataset.accent; // default look — no attribute at all
    } else {
      root.dataset.accent = accent;
    }
    try { localStorage.setItem(ACCENT_KEY, accent); } catch {}
  }, [accent]);

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() { return useContext(ThemeContext); }
