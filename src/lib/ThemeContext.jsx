import { createContext, useContext, useEffect, useState } from "react";

// Accent themes (Pro feature). "indigo" is the stock look — no data-accent
// attribute, zero visual change. The others recolor every indigo-* utility
// app-wide via CSS variables (see index.css + tailwind.config.js).
// Dark/light mode is a separate, independent axis — do not couple them.
export const ACCENT_THEMES = [
  { id: "indigo", label: "Indigo", swatch: "#6366f1", pro: false },
  { id: "jade", label: "Jade", swatch: "#10b981", pro: true },
  { id: "gold", label: "Gold", swatch: "#f59e0b", pro: true },
  { id: "crimson", label: "Crimson", swatch: "#f43f5e", pro: true },
];

const ThemeContext = createContext({
  theme: "dark",
  toggleTheme: () => {},
  accent: "indigo",
  setAccent: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("mos_theme") || "dark"; } catch { return "dark"; }
  });
  const [accent, setAccent] = useState(() => {
    try {
      const saved = localStorage.getItem("mos_accent") || "indigo";
      return ACCENT_THEMES.some(t => t.id === saved) ? saved : "indigo";
    } catch { return "indigo"; }
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
    if (accent === "indigo") {
      delete root.dataset.accent; // stock look — no attribute at all
    } else {
      root.dataset.accent = accent;
    }
    try { localStorage.setItem("mos_accent", accent); } catch {}
  }, [accent]);

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() { return useContext(ThemeContext); }
