import React from "react";

// Catches any render-time crash and shows a recoverable screen instead of a
// silent black void (the app's body background is dark, so an empty #root
// reads as "pure black, nothing there"). Without this, one thrown error
// anywhere takes down the whole app with no message and no way out.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("App crash caught by ErrorBoundary:", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = async () => {
    // Clear caches + service worker, then hard reload — recovers from a stale
    // or broken cached PWA build (the usual cause of a stuck/blank screen).
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (_e) {
      // ignore — fall through to reload regardless
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          textAlign: "center",
          background: "#030712",
          color: "#fff",
          fontFamily:
            "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        }}
      >
        <p style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong</p>
        <p style={{ fontSize: 14, color: "#9ca3af", maxWidth: 360 }}>
          Flowtone hit an unexpected error. Reloading usually fixes it.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button
            onClick={this.handleReload}
            style={{
              padding: "10px 20px",
              background: "#6366f1",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Reload
          </button>
          <button
            onClick={this.handleReset}
            style={{
              padding: "10px 20px",
              background: "rgba(255,255,255,.06)",
              color: "#c7d2fe",
              border: "1px solid rgba(255,255,255,.18)",
              borderRadius: 12,
              fontSize: 14,
            }}
          >
            Reset & reload
          </button>
        </div>
      </div>
    );
  }
}
