import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useTheme } from "@/lib/ThemeContext";
import {
  Music2, CalendarDays, CalendarRange, Users, Receipt,
  Package, Mail, Car, Settings, LayoutDashboard, MoreHorizontal, X, Sun, Moon,
  Music, Dumbbell, FileText
} from "lucide-react";
import AIAssistantButton from "@/components/AIAssistant/AIAssistantButton";
import AIAssistantPanel from "@/components/AIAssistant/AIAssistantPanel";
import { useAIAssistant } from "@/components/AIAssistant/useAIAssistant";
import { isPushActive, schedulePushNotifications, reRegisterSubscription } from "@/lib/pushManager";
import { appClient } from "@/api/appClient";

const primaryNav = [
  { icon: LayoutDashboard, label: "Home",     page: "Dashboard" },
  { icon: CalendarDays,    label: "Calendar", page: "CalendarView" },
  { icon: CalendarRange,   label: "Events",   page: "WorkEvents" },
  { icon: Receipt,         label: "Finance",  page: "Finance" },
];

const moreItems = [
  { icon: Users,    label: "Clients",    page: "Clients" },
  { icon: Music,    label: "Library",    page: "Charts" },
  { icon: Dumbbell, label: "Practice",   page: "Practice" },
  { icon: Package,  label: "Gear",       page: "Equipment" },
  { icon: Car,      label: "Drive Mode", page: "DrivingMode" },
  { icon: Settings, label: "Settings",   page: "AppSettings" },
];

// Map sub-pages to their parent nav group
const NAV_GROUP = {
  Dashboard: "Dashboard",
  CalendarView: "CalendarView",
  WorkEvents: "WorkEvents",
  WorkEventDetail: "WorkEvents",
  Clients: "Clients",
  ClientDetail: "Clients",
  Finance: "Finance",
  Invoices: "Finance",
  Estimates: "Finance",
  DocumentDetail: "Finance",
  InvoiceDetail: "Finance",
  EstimateDetail: "Finance",
  Charts: "Charts",
  ChartDetail: "Charts",
  Practice: "Practice",
  Equipment: "Equipment",
  EmailInbox: "EmailInbox",
  DrivingMode: "DrivingMode",
  AppSettings: "AppSettings",
};

// Map page names to user-friendly section labels
const SECTION_LABELS = {
  Dashboard: null,
  CalendarView: "Calendar",
  WorkEvents: "Events",
  WorkEventDetail: "Event",
  Clients: "Clients",
  ClientDetail: "Client",
  Finance: "Finance",
  Invoices: "Finance",
  Estimates: "Finance",
  Charts: "Library",
  ChartDetail: "Library",
  Practice: "Practice",
  Equipment: "Gear",
  EmailInbox: "Inbox",
  DrivingMode: "Drive",
  AppSettings: "Settings",
};

// Icon shown alongside the section label in the header
const SECTION_ICONS = {
  CalendarView: CalendarDays,
  WorkEvents: CalendarRange,
  WorkEventDetail: CalendarRange,
  Clients: Users,
  ClientDetail: Users,
  Finance: Receipt,
  Invoices: Receipt,
  Charts: Music,
  ChartDetail: Music,
  Practice: Dumbbell,
  Equipment: Package,
  EmailInbox: Mail,
  DrivingMode: Car,
  AppSettings: Settings,
  DocumentDetail: FileText,
};

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [showMore, setShowMore] = useState(false);
  const { theme, toggleTheme } = useTheme();

  // Schedule push notifications on app open (if user has push enabled)
  useEffect(() => {
    isPushActive().then(active => {
      if (!active) return;
      Promise.all([
        appClient.entities.WorkEvent.list().catch(() => []),
        appClient.entities.Client.list().catch(() => []),
        appClient.entities.AppSettings.list().catch(() => []),
      ]).then(([events, clients, settingsList]) => {
        const appSettings = settingsList[0] || {};
        const level = appSettings.notification_level || 'standard';
        // Re-register subscription with server (fixes Railway restarts wiping store.json)
        reRegisterSubscription(level).catch(() => {});
        // Load documents for finance-layer notifications
        appClient.entities.Document.list().catch(() => []).then(documents => {
          schedulePushNotifications(events, clients, documents, appSettings).catch(() => {});
        });
      });
    });
  }, []);

  const {
    messages,
    loading: aiLoading,
    open: aiOpen,
    openPanel,
    closePanel,
    sendMessage,
    clearHistory,
    pendingNavigate,
    clearPendingNavigate,
  } = useAIAssistant();

  // Onboarding "Ask the assistant" handoff — open the panel and send the prefilled message once
  useEffect(() => {
    let prefill = null;
    try {
      prefill = sessionStorage.getItem("flowtone_onboarding_prefill");
      if (prefill) sessionStorage.removeItem("flowtone_onboarding_prefill");
    } catch {
      return;
    }
    if (prefill) {
      openPanel();
      sendMessage(prefill);
    }
  }, []);

  let sectionLabel = currentPageName in SECTION_LABELS ? SECTION_LABELS[currentPageName] : currentPageName;
  if (currentPageName === "DocumentDetail") {
    const params = new URLSearchParams(location.search);
    const type = params.get("type");
    sectionLabel = type === "estimate" ? "Quote" : "Invoice";
  }
  const SectionIcon = SECTION_ICONS[currentPageName] || null;

  const activeGroup = NAV_GROUP[currentPageName] || currentPageName;
  const isMoreActive = ["Charts", "ChartDetail", "Practice", "Equipment", "EmailInbox", "DrivingMode", "AppSettings"].includes(activeGroup);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Top bar — pt-safe pushes content below iPhone notch/Dynamic Island */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-950 sticky top-0 z-30" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2.5">
          <Music2 className="w-5 h-5 text-indigo-400" />
          <span className="font-bold text-white tracking-tight">Flowtone</span>
          {sectionLabel && (
            <>
              <span className="text-gray-600 text-sm">/</span>
              <span className="text-xs font-medium text-indigo-300 bg-indigo-500/15 px-2 py-0.5 rounded-md flex items-center gap-1">
                {SectionIcon && <SectionIcon className="w-3 h-3" />}
                {sectionLabel}
              </span>
            </>
          )}
        </div>
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto pb-20">
        {children}
      </main>

      {/* More Menu Overlay */}
      {showMore && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowMore(false)} />
          <div className="fixed bottom-16 left-0 right-0 bg-gray-900 border-t border-gray-700 z-50 px-4 py-3 rounded-t-2xl shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">More</span>
              <button onClick={() => setShowMore(false)} className="text-gray-500 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {moreItems.map(({ icon: Icon, label, page }) => (
                <Link
                  key={page}
                  to={createPageUrl(page)}
                  onClick={() => setShowMore(false)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-xl transition-colors ${
                    activeGroup === page
                      ? "bg-indigo-600/20 text-indigo-400"
                      : "text-gray-400 hover:text-white hover:bg-gray-800"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[11px] font-medium">{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      {/* AI Assistant */}
      <AIAssistantButton onClick={openPanel} />
      <AIAssistantPanel
        open={aiOpen}
        onClose={closePanel}
        navigate={navigate}
        messages={messages}
        loading={aiLoading}
        sendMessage={sendMessage}
        clearHistory={clearHistory}
        pendingNavigate={pendingNavigate}
        clearPendingNavigate={clearPendingNavigate}
      />

      {/* Bottom Nav — 5 items */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 z-30 flex justify-around items-center px-2 py-2" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
        {primaryNav.map(({ icon: Icon, label, page }) => {
          const active = activeGroup === page;
          return (
            <Link
              key={page}
              to={createPageUrl(page)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${
                active ? "text-indigo-400" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setShowMore(v => !v)}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${
            isMoreActive || showMore ? "text-indigo-400" : "text-gray-500 hover:text-gray-300"
          }`}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </div>
  );
}
