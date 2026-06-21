import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { ThemeProvider } from '@/lib/ThemeContext'
import { PrivacyProvider } from '@/lib/PrivacyContext'
import ErrorBoundary from '@/components/ErrorBoundary'
import '@/index.css'

// Apply saved theme before first paint to avoid flash
try {
  const saved = localStorage.getItem("mos_theme") || "dark";
  if (saved === "dark") document.documentElement.classList.add("dark");
  if (localStorage.getItem("flowtone_hide_fees") === "1") document.documentElement.classList.add("hide-fees");
} catch {}

// Register service worker for PWA / offline support
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => { /* SW registration failed — app still works online */ });
  });
}

// React is taking over — cancel the HTML boot-splash's "tap to reload" timer.
try { clearTimeout(window.__bootReload); } catch {}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <ThemeProvider>
      <PrivacyProvider>
        <App />
      </PrivacyProvider>
    </ThemeProvider>
  </ErrorBoundary>
)
