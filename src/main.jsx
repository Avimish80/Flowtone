import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { ThemeProvider } from '@/lib/ThemeContext'
import '@/index.css'

// Apply saved theme before first paint to avoid flash
try {
  const saved = localStorage.getItem("mos_theme") || "dark";
  if (saved === "dark") document.documentElement.classList.add("dark");
} catch {}

// Register service worker for PWA / offline support
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => { /* SW registration failed — app still works online */ });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
)
