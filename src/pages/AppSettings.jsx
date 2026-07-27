import { useState, useEffect, useRef, useCallback } from "react";
import { appClient } from "@/api/appClient";
import { useAuth } from "@/lib/AuthContext";
import {
  Check, Mail, Bell, Banknote, Building2, CalendarDays, RefreshCw,
  ChevronDown, ChevronUp, Upload, X, Download, Upload as UploadIcon,
  LogOut, Sparkles, Link2, Palette
} from "lucide-react";
import { useTheme, ACCENT_THEMES } from "@/lib/ThemeContext";
import { formatDistanceToNow } from "date-fns";
import { getAssistantProfile, DEFAULT_ASSISTANT_NAME, DEFAULT_LANGUAGE } from "@/lib/assistantProfile";
import { LANGUAGE_OPTIONS } from "@/components/onboarding/onboardingScript";
import {
  TEMPLATE_DEFS, DEFAULT_TEMPLATE_ID, generateInvoiceHTML, resolveTemplateId,
  getTemplateCustom, setTemplateCustom, DEFAULT_FOOTER_TEXT,
  ACCENT_PRESETS, ACCENT_LABELS, HEADER_STYLES, HEADER_LABELS,
  FONT_CHOICES, FONT_LABELS, FONT_STACKS,
  ITEMS_STYLES, ITEMS_LABELS, TOTALS_STYLES, TOTALS_LABELS, DENSITIES, DENSITY_LABELS,
} from "@/lib/invoiceTemplates";
import TemplateThumb from "@/components/invoice/TemplateThumb";
import { registerPush, unregisterPush, isPushActive, schedulePushNotifications, sendTestPush } from "@/lib/pushManager";
import { DEFAULT_PREFS } from "@/lib/notificationPrefs";
import { isGmailConnected, getGmailEmail, connectGmail, disconnectGmail } from "@/lib/gmailClient";
import { connectCalendar, getCalendarStatus, syncNow as calendarSyncNow, setSyncEnabled as setCalendarSyncEnabled, disconnectCalendar } from "@/lib/calendarClient";
import SmartCSVImport from "@/components/SmartCSVImport";
import { exportFullApp, downloadCSV } from "@/lib/csvExport";
import NotificationPrefsEditor, { Toggle } from "@/components/NotificationPrefsEditor";

// A4 at the width the templates lay out to (820 × 210:297).
const PREVIEW_W = 820;
const PREVIEW_H = 1160;

export default function AppSettings() {
  const { logout, user, isPreviewMode } = useAuth();
  const { accent, setAccent } = useTheme();
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // 'idle' | 'saving' | 'saved'
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState(new Set());
  const logoInputRef = useRef(null);

  // Refs for debounced save
  const settingsRef = useRef(null);
  const profileRef = useRef(null);
  const saveTimerRef = useRef(null);

  // ── Push Notification state ────────────────────────────────────────
  const [pushActive, setPushActive] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState("");
  const [testResult, setTestResult] = useState("");
  const [diagOpen, setDiagOpen] = useState(false);

  // ── Gmail state ───────────────────────────────────────────────────
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState("");

  // ── Calendar state ────────────────────────────────────────────────
  const [calStatus, setCalStatus] = useState({ connected: false });
  const [calBusy, setCalBusy] = useState(false);
  const [calSyncing, setCalSyncing] = useState(false);
  const [calMsg, setCalMsg] = useState("");

  // ── CSV Import state ──────────────────────────────────────────────
  const [showCSVImport, setShowCSVImport] = useState(false);

  // ── Invoice template preview overlay ──────────────────────────────
  // The sheet is rendered at full A4 width and scaled to fit, so the preview
  // shows real page proportions. Letting a phone-width iframe reflow the
  // document instead just shows a layout the printed invoice never has.
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewScale, setPreviewScale] = useState(1);
  const previewFitRef = useRef(null);

  useEffect(() => {
    if (!previewHtml) return;
    const el = previewFitRef.current;
    if (!el) return;
    const fit = () => setPreviewScale(Math.min(1, el.clientWidth / PREVIEW_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewHtml]);

  useEffect(() => {
    Promise.all([
      appClient.entities.AppSettings.list(),
      appClient.entities.BusinessProfile.list(),
    ]).then(([settingsData, profileData]) => {
      const s = settingsData[0] || {
        invoice_template: DEFAULT_TEMPLATE_ID,
        default_currency: "GBP",
        default_nav_app: "google_maps",
        gmail_connected: false,
        email_auto_action: "suggest_only",
        reminder_channel: "in_app",
        default_payment_terms_days: 30,
        tax_year_start_month: 4,
        invoice_number_prefix: "INV-",
        invoice_number_next: 1,
        default_tax_rate: 0,
      };
      const p = profileData[0] || {
        business_name: "", contact_name: "", email: "", phone: "",
        address_line_1: "", address_line_2: "", city: "", postcode: "",
        country: "GB", tax_id: "", bank_name: "", bank_account_name: "",
        bank_sort_code: "", bank_account_number: "", bank_iban: "",
        payment_instructions: "",
      };
      setSettings(s);
      setProfile(p);
      settingsRef.current = s;
      profileRef.current = p;
      setLoading(false);
    }).catch(() => setLoading(false));

    isPushActive().then(setPushActive).catch(() => {});
    setGmailConnected(isGmailConnected());
    setGmailEmail(getGmailEmail());

    const hash = window.location.hash;
    if (hash.includes("calendar=connected") || hash.includes("calendar=error")) {
      setOpenSections(new Set(["connections"]));
      setCalMsg(hash.includes("calendar=connected")
        ? "Google Calendar connected."
        : "Couldn't connect Google Calendar. Please try again.");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    getCalendarStatus().then(setCalStatus).catch(() => {});
  }, []);

  // Keep refs in sync with state
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  // ── Debounced auto-save ────────────────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const s = settingsRef.current;
      const p = profileRef.current;
      if (!s || !p) return;
      setSaveState("saving");
      try {
        if (s.id) {
          await appClient.entities.AppSettings.update(s.id, s);
        } else {
          const created = await appClient.entities.AppSettings.create(s);
          setSettings(created);
          settingsRef.current = created;
        }
        if (p.id) {
          await appClient.entities.BusinessProfile.update(p.id, p);
        } else {
          const created = await appClient.entities.BusinessProfile.create(p);
          setProfile(created);
          profileRef.current = created;
        }
        getAssistantProfile({ fresh: true }).catch(() => {});
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      } catch (err) {
        console.error("Auto-save error:", err);
        setSaveState("idle");
      }
    }, 1500);
  }, []);

  const onChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    scheduleSave();
  };
  const onProfileChange = (field, value) => {
    setProfile(prev => ({ ...prev, [field]: value }));
    scheduleSave();
  };

  // ── Calendar helpers ───────────────────────────────────────────────
  const handleConnectCalendar = async () => {
    setCalBusy(true); setCalMsg("");
    try { await connectCalendar(); }
    catch { setCalMsg("Couldn't start Google sign-in."); setCalBusy(false); }
  };

  const handleDisconnectCalendar = async () => {
    setCalBusy(true);
    try { await disconnectCalendar(); setCalStatus({ connected: false }); setCalMsg(""); }
    catch { setCalMsg("Couldn't disconnect."); }
    setCalBusy(false);
  };

  const handleCalendarSyncNow = async () => {
    setCalSyncing(true); setCalMsg("");
    try {
      const r = await calendarSyncNow();
      if (r.skipped) { setCalMsg("Sync is turned off."); }
      else { setCalStatus(s => ({ ...s, last_synced_at: r.last_synced_at })); setCalMsg(`Synced — ${r.pushed} sent, ${r.pulled} received.`); }
    } catch { setCalMsg("Sync failed. Please try again."); }
    setCalSyncing(false);
  };

  const handleCalendarToggle = async () => {
    const next = !calStatus.sync_enabled;
    setCalStatus(s => ({ ...s, sync_enabled: next }));
    try { await setCalendarSyncEnabled(next); }
    catch { setCalStatus(s => ({ ...s, sync_enabled: !next })); }
  };

  // ── Push helpers ───────────────────────────────────────────────────
  const reschedule = useCallback(async (currentSettings) => {
    try {
      const [events, clients, documents] = await Promise.all([
        appClient.entities.WorkEvent.list(),
        appClient.entities.Client.list(),
        appClient.entities.Document.list().catch(() => []),
      ]);
      await schedulePushNotifications(events, clients, documents, currentSettings);
    } catch (err) { console.warn("Push reschedule failed:", err); }
  }, []);

  const handleEnablePush = async () => {
    setPushLoading(true); setPushError("");
    const level = settings?.notification_level || "standard";
    try {
      const result = await registerPush(level);
      if (result.success) { setPushActive(true); await reschedule(settings); }
      else if (result.reason === "denied") setPushError("Notification permission was denied. Please allow notifications in your browser settings.");
      else setPushError("Push notifications are not supported on this device or browser.");
    } catch { setPushError("Something went wrong enabling notifications."); }
    setPushLoading(false);
  };

  const handleDisablePush = async () => {
    setPushLoading(true); setPushError("");
    try { await unregisterPush(); setPushActive(false); }
    catch { setPushError("Something went wrong disabling notifications."); }
    setPushLoading(false);
  };

  const handleLevelChange = async (level) => {
    const updatedSettings = { ...settings, notification_level: level };
    if (level === "full" && !settings?.notification_prefs) updatedSettings.notification_prefs = DEFAULT_PREFS.full;
    setSettings(updatedSettings);
    scheduleSave();
    if (pushActive) await reschedule(updatedSettings);
  };

  const handlePrefChange = async (key, field, value) => {
    const currentPrefs = settings?.notification_prefs || DEFAULT_PREFS.full;
    const updatedPrefs = { ...currentPrefs, [key]: { ...(currentPrefs[key] || {}), [field]: value } };
    const updatedSettings = { ...settings, notification_prefs: updatedPrefs };
    setSettings(updatedSettings);
    scheduleSave();
    if (pushActive) await reschedule(updatedSettings);
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { onProfileChange("logo", ev.target.result); };
    reader.readAsDataURL(file);
  };

  const toggleSection = (key) => {
    setOpenSections(prev => {
      if (prev.has(key)) return new Set();
      return new Set([key]);
    });
  };

  // Preview renders into an in-app overlay rather than window.open: in the iOS
  // standalone PWA a new window replaces the whole app and strands the user on
  // the document with no way back. Same trap printInvoice() avoids.
  const openTemplatePreview = (templateId) => {
    const sampleDoc = {
      document_type: "invoice", document_number: "INV-0042", title: "Sample Invoice",
      status: "sent", currency: settings?.default_currency || "GBP",
      created_at: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      client_name: "Chiltern House Events",
      client_email: "bookings@chilternhouse.co.uk",
      line_items: [
        { description: "Solo performance — drinks reception & dinner (3 hrs)", quantity: 1, unit_price: 850 },
        { description: "Additional set — after-dinner (45 min)", quantity: 1, unit_price: 200 },
        { description: "Travel", quantity: 2, unit_price: 45 },
      ],
      subtotal: 1140, discount_amount: 0, tax_rate: 0, tax_amount: 0, total: 1140,
      notes: "Thank you for booking. Please transfer within 14 days.",
    };
    // Fall back to plausible sample values so the preview shows a full document
    // rather than a half-empty one when the profile has not been filled in yet.
    const sampleProfile = {
      business_name: profile?.business_name || "Your Name",
      contact_name: profile?.contact_name || profile?.business_name || "Your Name",
      logo: profile?.logo || "",
      address_line_1: profile?.address_line_1 || "48 Example Street",
      address_line_2: profile?.address_line_2 || "",
      city: profile?.city || "London",
      postcode: profile?.postcode || "NW6 3SJ",
      email: profile?.email || "you@example.com",
      phone: profile?.phone || "",
      tax_id: profile?.tax_id || "",
      bank_name: profile?.bank_name || "Your Bank",
      bank_account_name: profile?.bank_account_name || "Your Name",
      bank_sort_code: profile?.bank_sort_code || "00-00-00",
      bank_account_number: profile?.bank_account_number || "12345678",
      bank_iban: profile?.bank_iban || "",
      payment_instructions: profile?.payment_instructions || "Bank transfer preferred. Please use the invoice number as the reference.",
    };
    setPreviewHtml(generateInvoiceHTML(sampleDoc, sampleProfile, settings, templateId));
  };

  const handleTestPush = async () => {
    setTestResult("Sending…");
    const result = await sendTestPush();
    if (result.success) setTestResult("Sent — it should arrive in a few seconds.");
    else if (result.reason === "not_subscribed") setTestResult("Not subscribed — turn notifications off and on again.");
    else setTestResult("Failed: " + (result.reason || "unknown error"));
  };

  if (loading || !settings) return <div className="p-4 text-gray-400">Loading...</div>;

  const SectionHeader = ({ icon: Icon, label, sectionKey }) => (
    <button onClick={() => toggleSection(sectionKey)} className="w-full flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-indigo-400" />
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide flex-1 text-left">{label}</h2>
      {openSections.has(sectionKey)
        ? <ChevronUp className="w-4 h-4 text-gray-500" />
        : <ChevronDown className="w-4 h-4 text-gray-500" />}
    </button>
  );

  const inputCls = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 placeholder-gray-500";
  const labelCls = "text-xs text-gray-400 mb-1 block";

  return (
    <div className="p-4 max-w-xl mx-auto">
      {/* Subtle save indicator */}
      <div className="flex justify-end h-5 mb-1">
        <span className={`text-[11px] text-gray-500 flex items-center gap-1 transition-opacity duration-500 ${saveState === "saved" ? "opacity-100" : "opacity-0"}`}>
          <Check className="w-3 h-3" /> Saved
        </span>
      </div>

      <div className="space-y-6">

        {/* Replay the guided coach-mark tour */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("flowtone:start-tour"))}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          <RefreshCw className="w-4 h-4 text-indigo-400" /> Replay app tour
        </button>

        {/* ── Appearance ───────────────────────────────────────────── */}
        {/* Accent themes only. Dark/light mode stays on the header toggle —
            the two axes are independent and must not be coupled here. */}
        <section>
          <SectionHeader icon={Palette} label="Appearance" sectionKey="appearance" />
          {openSections.has("appearance") && (
            <div className="bg-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-3">Color theme — recolors the whole app. Themes beyond Indigo are a Pro feature.</p>
              <div className="grid grid-cols-4 gap-2">
                {ACCENT_THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setAccent(t.id)}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all ${
                      accent === t.id
                        ? "border-indigo-500 ring-2 ring-indigo-500 bg-gray-900"
                        : "border-gray-700/60 hover:border-gray-600"
                    }`}
                  >
                    <span
                      className="w-7 h-7 rounded-full border border-white/10"
                      style={{ background: t.swatch }}
                    />
                    <span className={`text-[11px] font-medium ${accent === t.id ? "text-white" : "text-gray-400"}`}>
                      {t.label}
                    </span>
                    {t.pro && (
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-indigo-400 bg-indigo-600/20 px-1.5 py-0.5 rounded-full">
                        Pro
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── Business Profile ─────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Building2} label="Business Profile" sectionKey="profile" />
          {openSections.has("profile") && profile && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-xs text-gray-500 mb-2">Your details — appears on invoices.</p>

              <div>
                <label className={labelCls}>Logo</label>
                <div className="flex items-center gap-3">
                  {profile?.logo ? (
                    <div className="relative">
                      <img src={profile.logo} alt="logo" className="h-12 w-auto object-contain rounded border border-gray-700" />
                      <button onClick={() => onProfileChange("logo", "")} className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="h-12 w-24 bg-gray-900 border-2 border-dashed border-gray-600 rounded flex items-center justify-center text-gray-500">
                      <Upload className="w-4 h-4" />
                    </div>
                  )}
                  <div>
                    <button onClick={() => logoInputRef.current?.click()} className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
                      {profile?.logo ? "Change logo" : "Upload logo"}
                    </button>
                    <p className="text-[10px] text-gray-500 mt-0.5">PNG or SVG recommended · max 1 MB</p>
                  </div>
                  <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>Business Name</label>
                  <input className={inputCls} placeholder="Jane Smith Music" value={profile.business_name || ""} onChange={e => onProfileChange("business_name", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Contact Name</label>
                  <input className={inputCls} placeholder="Jane Smith" value={profile.contact_name || ""} onChange={e => onProfileChange("contact_name", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Phone</label>
                  <input className={inputCls} placeholder="+44 7…" value={profile.phone || ""} onChange={e => onProfileChange("phone", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Email</label>
                  <input className={inputCls} placeholder="you@example.com" value={profile.email || ""} onChange={e => onProfileChange("email", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Address Line 1</label>
                  <input className={inputCls} value={profile.address_line_1 || ""} onChange={e => onProfileChange("address_line_1", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Address Line 2</label>
                  <input className={inputCls} value={profile.address_line_2 || ""} onChange={e => onProfileChange("address_line_2", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>City</label>
                  <input className={inputCls} value={profile.city || ""} onChange={e => onProfileChange("city", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Postcode</label>
                  <input className={inputCls} value={profile.postcode || ""} onChange={e => onProfileChange("postcode", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Country</label>
                  <input className={inputCls} value={profile.country || ""} onChange={e => onProfileChange("country", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Tax ID / VAT</label>
                  <input className={inputCls} placeholder="GB123456789" value={profile.tax_id || ""} onChange={e => onProfileChange("tax_id", e.target.value)} />
                </div>
              </div>

              <div className="border-t border-gray-700 pt-3 mt-1">
                <p className="text-xs text-gray-500 mb-3">Bank details — shown on invoices for payment.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Bank Name</label>
                    <input className={inputCls} value={profile.bank_name || ""} onChange={e => onProfileChange("bank_name", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Account Name</label>
                    <input className={inputCls} value={profile.bank_account_name || ""} onChange={e => onProfileChange("bank_account_name", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Sort Code</label>
                    <input className={inputCls} placeholder="00-00-00" value={profile.bank_sort_code || ""} onChange={e => onProfileChange("bank_sort_code", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Account Number</label>
                    <input className={inputCls} value={profile.bank_account_number || ""} onChange={e => onProfileChange("bank_account_number", e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>IBAN</label>
                    <input className={inputCls} value={profile.bank_iban || ""} onChange={e => onProfileChange("bank_iban", e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Payment Instructions</label>
                    <textarea className={inputCls + " h-16 resize-none"} placeholder="e.g. Pay via bank transfer to…" value={profile.payment_instructions || ""} onChange={e => onProfileChange("payment_instructions", e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Assistant ────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Sparkles} label="Assistant" sectionKey="assistant" />
          {openSections.has("assistant") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-4">
              <p className="text-xs text-gray-500">Personalise how the AI assistant talks to you.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Your Name</label>
                  <input
                    className={inputCls}
                    placeholder="Your name"
                    value={settings.assistant_profile?.user_name || ""}
                    onChange={e => onChange("assistant_profile", { ...(settings.assistant_profile || {}), user_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls}>Assistant Name</label>
                  <input
                    className={inputCls}
                    placeholder={DEFAULT_ASSISTANT_NAME}
                    value={settings.assistant_profile?.assistant_name || ""}
                    onChange={e => onChange("assistant_profile", { ...(settings.assistant_profile || {}), assistant_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls}>Language</label>
                  <select
                    className={inputCls}
                    value={settings.assistant_profile?.language || DEFAULT_LANGUAGE}
                    onChange={e => onChange("assistant_profile", { ...(settings.assistant_profile || {}), language: e.target.value })}
                  >
                    {LANGUAGE_OPTIONS.map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>What You Do</label>
                  <input
                    className={inputCls}
                    placeholder="e.g. Guitarist"
                    value={settings.assistant_profile?.profession || ""}
                    onChange={e => onChange("assistant_profile", { ...(settings.assistant_profile || {}), profession: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>About you</label>
                <textarea
                  className={inputCls + " h-24 resize-none"}
                  placeholder="A few lines the assistant should always know — e.g. 'I'm a session guitarist based in London. I mostly do jazz and corporate events. My lesson rate is £50/hour.'"
                  value={settings.assistant_profile?.context_notes || ""}
                  onChange={e => onChange("assistant_profile", { ...(settings.assistant_profile || {}), context_notes: e.target.value })}
                />
                <p className="text-[10px] text-gray-600 mt-1">The assistant reads this on every conversation.</p>
              </div>
            </div>
          )}
        </section>

        {/* ── Finance ──────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Banknote} label="Finance" sectionKey="finance" />
          {openSections.has("finance") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Default Currency</label>
                  <select className={inputCls} value={settings.default_currency || "GBP"} onChange={e => onChange("default_currency", e.target.value)}>
                    {["GBP", "USD", "EUR", "AUD", "CAD"].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Payment Terms (days)</label>
                  <input type="number" className={inputCls} value={settings.default_payment_terms_days || 30} onChange={e => onChange("default_payment_terms_days", parseInt(e.target.value) || 0)} />
                </div>
                <div>
                  <label className={labelCls}>Default Tax Rate (%)</label>
                  <input type="number" className={inputCls} placeholder="0" value={settings.default_tax_rate || 0} onChange={e => onChange("default_tax_rate", parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <label className={labelCls}>Tax Year Starts</label>
                  <select className={inputCls} value={settings.tax_year_start_month || 4} onChange={e => onChange("tax_year_start_month", parseInt(e.target.value))}>
                    {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-t border-gray-700 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Invoice Numbering</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Prefix</label>
                    <input className={inputCls} value={settings.invoice_number_prefix || "INV-"} onChange={e => onChange("invoice_number_prefix", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Next Number</label>
                    <input type="number" min="1" className={inputCls} value={settings.invoice_number_next || 1} onChange={e => onChange("invoice_number_next", parseInt(e.target.value) || 1)} />
                  </div>
                </div>
                <p className="text-xs text-gray-600 mt-2">Next invoice: {settings.invoice_number_prefix || "INV-"}{String(settings.invoice_number_next || 1).padStart(4, "0")}</p>
              </div>

              <div className="border-t border-gray-700 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Invoice Template</p>
                {(() => {
                  const activeId = resolveTemplateId(settings.invoice_template);
                  const active = TEMPLATE_DEFS.find(t => t.id === activeId) || TEMPLATE_DEFS[0];
                  // Every template is customisable, and each remembers its own look —
                  // tuning Atelier must not disturb Statement.
                  const custom = getTemplateCustom(settings, activeId);
                  const setCustom = (patch) => onChange("invoice_custom", setTemplateCustom(settings, activeId, patch));
                  const segBtn = (on) => `min-w-0 text-[11px] py-1.5 px-1 rounded-md transition-colors truncate ${on ? "bg-indigo-600 text-white" : "bg-gray-900 text-gray-400 hover:text-gray-200"}`;
                  // cols wraps a set onto a grid — five font names do not fit one
                  // row at 360px and get truncated to "Geom…". Class strings are
                  // literal because Tailwind cannot see interpolated names.
                  const GRID_COLS = { 2: "grid grid-cols-2", 3: "grid grid-cols-3", 4: "grid grid-cols-4" };
                  const seg = (label, values, labels, key, { cols, styleFor } = {}) => (
                    <div>
                      <label className={labelCls}>{label}</label>
                      <div className={`gap-1.5 bg-gray-900 p-1 rounded-lg ${cols ? GRID_COLS[cols] : "flex"}`}>
                        {values.map(v => (
                          <button key={v} onClick={() => setCustom({ [key]: v })}
                            className={`${segBtn(custom[key] === v)} ${cols ? "" : "flex-1"}`}
                            style={styleFor ? styleFor(v) : undefined}>
                            {labels[v]}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                  return (
                    <>
                      <div className="flex gap-2.5">
                        {TEMPLATE_DEFS.map(t => (
                          <button
                            key={t.id}
                            onClick={() => onChange("invoice_template", t.id)}
                            className={`rounded-[3px] transition-all ${activeId === t.id ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-gray-800" : "opacity-55 hover:opacity-100"}`}
                            aria-label={t.name}
                            aria-pressed={activeId === t.id}
                          >
                            <TemplateThumb id={t.id} accent={getTemplateCustom(settings, t.id).accent_color} />
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center justify-between gap-3 mt-3">
                        <div className="min-w-0">
                          <p className="text-sm text-white">{active.name}</p>
                          <p className="text-xs text-gray-500 leading-snug">{active.desc}</p>
                        </div>
                        <button onClick={() => openTemplatePreview(active.id)} className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0 transition-colors">
                          Preview
                        </button>
                      </div>

                      <div className="mt-4 pt-4 border-t border-gray-700/60 space-y-4">
                        <p className="text-[11px] text-gray-500 leading-snug">
                          Styling applies to {active.name} only — or just ask the assistant:{" "}
                          <span className="text-gray-400">"make my invoice claret and centred."</span>
                        </p>

                        <div>
                          <label className={labelCls}>
                            Colour
                            <span className="text-gray-600 normal-case tracking-normal"> · {ACCENT_LABELS[custom.accent_color] || "Custom"}</span>
                          </label>
                          <div className="flex items-center gap-2 flex-wrap">
                            {ACCENT_PRESETS.map(hex => (
                              <button key={hex} onClick={() => setCustom({ accent_color: hex })}
                                aria-label={ACCENT_LABELS[hex] || hex} title={ACCENT_LABELS[hex] || hex}
                                className={`w-7 h-7 rounded-full transition-transform ${custom.accent_color === hex ? "ring-2 ring-offset-2 ring-offset-gray-800 ring-white scale-110" : "hover:scale-105"}`}
                                style={{ backgroundColor: hex }} />
                            ))}
                            <label className="w-7 h-7 rounded-full border border-gray-600 grid place-items-center cursor-pointer relative overflow-hidden" title="Custom colour">
                              <input type="color" value={custom.accent_color} onChange={e => setCustom({ accent_color: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
                              <span className="text-[10px] text-gray-400">+</span>
                            </label>
                          </div>
                        </div>

                        {seg("Header", HEADER_STYLES, HEADER_LABELS, "header_style")}

                        {/* Each button previews the face it selects. */}
                        {seg("Body font", FONT_CHOICES, FONT_LABELS, "font",
                          { cols: 3, styleFor: (v) => ({ fontFamily: FONT_STACKS[v] }) })}

                        <div>
                          <label className={labelCls}>Footer line</label>
                          <input className={inputCls} maxLength={160} placeholder={DEFAULT_FOOTER_TEXT}
                            value={custom.footer_text} onChange={e => setCustom({ footer_text: e.target.value })} />
                        </div>

                        {/* Personal unlocks the body choices the others keep fixed. */}
                        {activeId === 6 && (
                          <div className="space-y-4 pt-4 border-t border-gray-700/60">
                            <p className="text-[11px] text-gray-500">Personal also lets you change the body.</p>
                            {seg("Line items", ITEMS_STYLES, ITEMS_LABELS, "items_style")}
                            {seg("Total", TOTALS_STYLES, TOTALS_LABELS, "totals_style")}
                            {seg("Spacing", DENSITIES, DENSITY_LABELS, "density")}
                          </div>
                        )}

                        <label className="flex items-center justify-between cursor-pointer">
                          <span className="text-sm text-white">Show logo</span>
                          <button onClick={() => setCustom({ show_logo: !custom.show_logo })}
                            className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${custom.show_logo ? "bg-indigo-600" : "bg-gray-600"}`}
                            aria-pressed={custom.show_logo}>
                            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${custom.show_logo ? "left-[22px]" : "left-0.5"}`} />
                          </button>
                        </label>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </section>

        {/* ── Notifications ─────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Bell} label="Notifications" sectionKey="notifications" />
          {openSections.has("notifications") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-gray-200">Push notifications</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {pushLoading ? (pushActive ? "Turning off…" : "Turning on…") : pushActive ? "Active on this device" : "Off"}
                  </p>
                </div>
                <Toggle on={pushActive} disabled={pushLoading} onClick={pushActive ? handleDisablePush : handleEnablePush} />
              </div>

              {pushError && <p className="text-xs text-red-400 bg-red-900/30 rounded-lg px-3 py-2">{pushError}</p>}

              <div>
                <label className={labelCls}>Level</label>
                <div className="rounded-xl border border-gray-700 divide-y divide-gray-700 overflow-hidden">
                  {[
                    { key: "minimal",  label: "Minimal",  desc: "Money and live gig alerts only" },
                    { key: "standard", label: "Standard", desc: "Money, plus day-before reminders" },
                    { key: "full",     label: "Full",     desc: "Everything — customise below" },
                  ].map(({ key, label, desc }) => {
                    const active = (settings.notification_level || "standard") === key;
                    return (
                      <button key={key} onClick={() => handleLevelChange(key)}
                        className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors ${active ? "bg-indigo-600/15" : "bg-gray-900 hover:bg-gray-900/60"}`}>
                        <div>
                          <p className={`text-sm ${active ? "text-white font-medium" : "text-gray-300"}`}>{label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                        </div>
                        {active && <Check className="w-4 h-4 text-indigo-400 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {(settings.notification_level || "standard") === "full" && (
                <NotificationPrefsEditor prefs={settings.notification_prefs || DEFAULT_PREFS.full} onChange={handlePrefChange} />
              )}

              {pushActive && (
                <div>
                  <button onClick={handleTestPush} className="w-full py-2.5 rounded-xl text-sm font-medium border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-colors">
                    Send test notification
                  </button>
                  {testResult && <p className="text-xs text-gray-500 text-center mt-2">{testResult}</p>}
                </div>
              )}

              <div>
                <button onClick={() => setDiagOpen(o => !o)} className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors">
                  {diagOpen ? "Hide diagnostics" : "Diagnostics"}
                </button>
                {diagOpen && (
                  <div className="text-[11px] text-gray-600 space-y-0.5 mt-1.5">
                    <p>Push API: {'PushManager' in window ? "available" : "not available — install as PWA"}</p>
                    <p>Permission: {typeof Notification !== 'undefined' ? Notification.permission : "unknown"}</p>
                    <p>Display: {window.matchMedia('(display-mode: standalone)').matches ? "standalone (PWA)" : "browser tab"}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── Connections (Gmail + Calendar + Navigation) ───────────── */}
        <section>
          <SectionHeader icon={Link2} label="Connections" sectionKey="connections" />
          {openSections.has("connections") && (
            <div className="bg-gray-800 rounded-xl overflow-hidden divide-y divide-gray-700/60">

              {/* Google Calendar */}
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <p className="text-sm font-medium text-gray-200">Google Calendar</p>
                  </div>
                  {calStatus.connected ? (
                    <button onClick={handleDisconnectCalendar} disabled={calBusy}
                      className="text-xs text-red-400 hover:text-red-300 underline underline-offset-2 disabled:opacity-50 flex-shrink-0">
                      Disconnect
                    </button>
                  ) : null}
                </div>

                {calStatus.connected ? (
                  <>
                    <p className="text-xs text-gray-500 pl-6">{calStatus.email}</p>

                    <div className="flex items-center justify-between gap-3 pl-6">
                      <p className="text-sm text-gray-300">Sync gigs</p>
                      <Toggle on={!!calStatus.sync_enabled} onClick={handleCalendarToggle} />
                    </div>

                    <div className="pl-6">
                      <button onClick={handleCalendarSyncNow} disabled={calSyncing || !calStatus.sync_enabled}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
                        <RefreshCw className={`w-3.5 h-3.5 ${calSyncing ? "animate-spin" : ""}`} />
                        {calSyncing ? "Syncing…" : "Sync now"}
                      </button>
                      {(calMsg || calStatus.last_synced_at) && (
                        <p className="text-[11px] text-gray-600 mt-1">
                          {calMsg || (calStatus.last_synced_at ? `Last synced ${formatDistanceToNow(new Date(calStatus.last_synced_at), { addSuffix: true })}` : "")}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="pl-6 space-y-3">
                    <p className="text-xs text-gray-500 leading-relaxed">Two-way sync — gigs you create here appear in Google Calendar, and vice versa.</p>
                    <button onClick={handleConnectCalendar} disabled={calBusy}
                      className="flex items-center gap-2 text-sm font-medium text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors">
                      <CalendarDays className="w-4 h-4" />
                      Connect Google Calendar
                    </button>
                    {calMsg && <p className="text-xs text-gray-500">{calMsg}</p>}
                  </div>
                )}
              </div>

              {/* Gmail */}
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <p className="text-sm font-medium text-gray-200">Gmail</p>
                  </div>
                  {gmailConnected ? (
                    <button onClick={() => { disconnectGmail(); setGmailConnected(false); setGmailEmail(""); }}
                      className="text-xs text-red-400 hover:text-red-300 underline underline-offset-2 flex-shrink-0">
                      Disconnect
                    </button>
                  ) : null}
                </div>

                {gmailConnected ? (
                  <p className="text-xs text-gray-500 pl-6">{gmailEmail}</p>
                ) : (
                  <div className="pl-6 space-y-3">
                    <p className="text-xs text-gray-500">Send invoices directly from your Gmail account.</p>
                    <button onClick={connectGmail}
                      className="flex items-center gap-2 text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors">
                      <Mail className="w-4 h-4" />
                      Connect Gmail
                    </button>
                  </div>
                )}
              </div>

              {/* Navigation */}
              <div className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-200">Navigation app</p>
                  </div>
                  <div className="flex gap-1.5">
                    {["google_maps", "waze"].map(app => (
                      <button key={app} onClick={() => onChange("default_nav_app", app)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                          settings.default_nav_app === app
                            ? "bg-indigo-600 border-indigo-500 text-white"
                            : "bg-gray-900 border-gray-700 text-gray-400 hover:text-white"
                        }`}>
                        {app === "google_maps" ? "Google Maps" : "Waze"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

            </div>
          )}
        </section>

        {/* ── Backup & Restore ──────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Download} label="Backup & Restore" sectionKey="data" />
          {openSections.has("data") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-2">
              <button onClick={() => setShowCSVImport(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors">
                <UploadIcon className="w-4 h-4" />
                Restore from Backup
              </button>
              <button onClick={async () => { const csv = await exportFullApp(appClient); downloadCSV("flowtone-backup.csv", csv); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
                <Download className="w-4 h-4" />
                Export Full App Backup
              </button>
              <p className="text-[11px] text-gray-600 text-center">Saves everything — clients, events, invoices, practice, equipment</p>
            </div>
          )}
        </section>

        {/* ── Account ───────────────────────────────────────────────── */}
        {!isPreviewMode && (
          <div className="rounded-2xl border border-gray-700/40 p-4 space-y-3">
            {user?.email && (
              <p className="text-xs text-gray-500">Signed in as <span className="text-gray-300">{user.email}</span></p>
            )}
            <button onClick={() => logout()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}

      </div>

      {showCSVImport && <SmartCSVImport onClose={() => setShowCSVImport(false)} onImported={() => setShowCSVImport(false)} />}

      {previewHtml && (
        <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
          <div
            className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <p className="text-sm text-gray-300">Sample invoice</p>
            <button
              onClick={() => setPreviewHtml("")}
              className="text-gray-400 hover:text-white p-1.5 -mr-1.5 transition-colors"
              aria-label="Close preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div
            className="flex-1 overflow-auto px-3 pb-3"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <div ref={previewFitRef} className="w-full">
              <div
                className="mx-auto"
                style={{ width: PREVIEW_W * previewScale, height: PREVIEW_H * previewScale }}
              >
                <iframe
                  title="Invoice preview"
                  srcDoc={previewHtml}
                  sandbox=""
                  scrolling="no"
                  className="bg-white rounded-lg"
                  style={{
                    width: PREVIEW_W,
                    height: PREVIEW_H,
                    border: 0,
                    transform: `scale(${previewScale})`,
                    transformOrigin: "top left",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
