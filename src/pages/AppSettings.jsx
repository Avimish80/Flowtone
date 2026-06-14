import { useState, useEffect, useRef, useCallback } from "react";
import { appClient } from "@/api/appClient";
import { useAuth } from "@/lib/AuthContext";
import { Check, Mail, Navigation, Bell, Banknote, Building2, CalendarDays, RefreshCw, ChevronDown, ChevronUp, Upload, X, Download, Upload as UploadIcon, LogOut, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getAssistantProfile, DEFAULT_ASSISTANT_NAME, DEFAULT_LANGUAGE } from "@/lib/assistantProfile";
import { setPreferredCurrency } from "@/lib/currencyCache";
import { LANGUAGE_OPTIONS } from "@/components/onboarding/onboardingScript";
import { TEMPLATE_DEFS, generateInvoiceHTML } from "@/lib/invoiceTemplates";
import { registerPush, unregisterPush, isPushActive, schedulePushNotifications, sendTestPush } from "@/lib/pushManager";
import { DEFAULT_PREFS } from "@/lib/notificationPrefs";
import { isGmailConnected, getGmailEmail, connectGmail, disconnectGmail } from "@/lib/gmailClient";
import { connectCalendar, getCalendarStatus, syncNow as calendarSyncNow, setSyncEnabled as setCalendarSyncEnabled, disconnectCalendar } from "@/lib/calendarClient";
import SmartCSVImport from "@/components/SmartCSVImport";
import { exportFullApp, downloadCSV } from "@/lib/csvExport";
import { generateBusyMusicianData } from "@/lib/busyMusicianTestData";
import NotificationPrefsEditor, { Toggle } from "@/components/NotificationPrefsEditor";

export default function AppSettings() {
  const { logout, user, isPreviewMode } = useAuth();
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState(new Set(["finance"]));
  const logoInputRef = useRef(null);

  // ── Push Notification state ────────────────────────────────────────
  const [pushActive, setPushActive] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState("");
  const [testResult, setTestResult] = useState("");
  const [diagOpen, setDiagOpen] = useState(false);

  // ── Gmail state ───────────────────────────────────────────────────
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState('');

  // ── Calendar state ────────────────────────────────────────────────
  const [calStatus, setCalStatus] = useState({ connected: false });
  const [calBusy, setCalBusy] = useState(false);
  const [calSyncing, setCalSyncing] = useState(false);
  const [calMsg, setCalMsg] = useState('');

  // ── CSV Import state ──────────────────────────────────────────────
  const [showCSVImport, setShowCSVImport] = useState(false);
  const [testImporting, setTestImporting] = useState(null);
  const [testImported, setTestImported] = useState(null);
  const [loadingBusyMusician, setLoadingBusyMusician] = useState(false);

  useEffect(() => {
    Promise.all([
      appClient.entities.AppSettings.list(),
      appClient.entities.BusinessProfile.list(),
    ]).then(([settingsData, profileData]) => {
      setSettings(settingsData[0] || {
        invoice_template: 1,
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
      });
      setProfile(profileData[0] || {
        business_name: "",
        contact_name: "",
        email: "",
        phone: "",
        address_line_1: "",
        address_line_2: "",
        city: "",
        postcode: "",
        country: "GB",
        tax_id: "",
        bank_name: "",
        bank_account_name: "",
        bank_sort_code: "",
        bank_account_number: "",
        bank_iban: "",
        payment_instructions: "",
      });
      setLoading(false);
    }).catch(() => setLoading(false));

    // Check current push subscription status
    isPushActive().then(setPushActive).catch(() => {});

    // Check Gmail connection status
    setGmailConnected(isGmailConnected());
    setGmailEmail(getGmailEmail());

    // Handle the Google Calendar OAuth return, then load its status
    const hash = window.location.hash;
    if (hash.includes("calendar=connected") || hash.includes("calendar=error")) {
      setOpenSections(new Set(["calendar"]));
      setCalMsg(hash.includes("calendar=connected")
        ? "Google Calendar connected."
        : "Couldn't connect Google Calendar. Please try again.");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    getCalendarStatus().then(setCalStatus).catch(() => {});
  }, []);

  const onChange = (field, value) => {
    setSettings(prev => {
      const update = { ...prev, [field]: value };
      if (field === "default_currency") update.currency = value;
      if (field === "currency") update.default_currency = value;
      return update;
    });
    // Keep the app-wide currency in sync so every screen updates immediately
    if (field === "default_currency" || field === "currency") setPreferredCurrency(value);
  };
  const onProfileChange = (field, value) => setProfile(prev => ({ ...prev, [field]: value }));

  // ── Calendar helpers ───────────────────────────────────────────────
  const handleConnectCalendar = async () => {
    setCalBusy(true);
    setCalMsg("");
    try {
      await connectCalendar(); // redirects to Google
    } catch {
      setCalMsg("Couldn't start Google sign-in.");
      setCalBusy(false);
    }
  };

  const handleDisconnectCalendar = async () => {
    setCalBusy(true);
    try {
      await disconnectCalendar();
      setCalStatus({ connected: false });
      setCalMsg("");
    } catch {
      setCalMsg("Couldn't disconnect.");
    }
    setCalBusy(false);
  };

  const handleCalendarSyncNow = async () => {
    setCalSyncing(true);
    setCalMsg("");
    try {
      const r = await calendarSyncNow();
      if (r.skipped) {
        setCalMsg("Sync is turned off.");
      } else {
        setCalStatus(s => ({ ...s, last_synced_at: r.last_synced_at }));
        setCalMsg(`Synced — ${r.pushed} sent, ${r.pulled} received.`);
      }
    } catch {
      setCalMsg("Sync failed. Please try again.");
    }
    setCalSyncing(false);
  };

  const handleCalendarToggle = async () => {
    const next = !calStatus.sync_enabled;
    setCalStatus(s => ({ ...s, sync_enabled: next }));
    try {
      await setCalendarSyncEnabled(next);
    } catch {
      setCalStatus(s => ({ ...s, sync_enabled: !next })); // revert on failure
    }
  };

  // ── Push helpers ───────────────────────────────────────────────────

  /** Load events, clients, documents then reschedule all notifications. */
  const reschedule = useCallback(async (currentSettings) => {
    try {
      const [events, clients, documents] = await Promise.all([
        appClient.entities.WorkEvent.list(),
        appClient.entities.Client.list(),
        appClient.entities.Document.list().catch(() => []),
      ]);
      await schedulePushNotifications(events, clients, documents, currentSettings);
    } catch (err) {
      console.warn("Push reschedule failed:", err);
    }
  }, []);

  const handleEnablePush = async () => {
    setPushLoading(true);
    setPushError("");
    const level = settings?.notification_level || "standard";
    try {
      const result = await registerPush(level);
      if (result.success) {
        setPushActive(true);
        await reschedule(settings);
      } else if (result.reason === "denied") {
        setPushError("Notification permission was denied. Please allow notifications in your browser settings.");
      } else {
        setPushError("Push notifications are not supported on this device or browser.");
      }
    } catch (err) {
      console.error("Enable push error:", err);
      setPushError("Something went wrong enabling notifications.");
    }
    setPushLoading(false);
  };

  const handleDisablePush = async () => {
    setPushLoading(true);
    setPushError("");
    try {
      await unregisterPush();
      setPushActive(false);
    } catch (err) {
      console.error("Disable push error:", err);
      setPushError("Something went wrong disabling notifications.");
    }
    setPushLoading(false);
  };

  const handleLevelChange = async (level) => {
    // When switching to full, seed notification_prefs from full defaults if not set
    const updatedSettings = { ...settings, notification_level: level };
    if (level === "full" && !settings?.notification_prefs) {
      updatedSettings.notification_prefs = DEFAULT_PREFS.full;
    }
    setSettings(updatedSettings);
    if (pushActive) {
      await reschedule(updatedSettings);
    }
  };

  const handlePrefChange = async (key, field, value) => {
    const currentPrefs = settings?.notification_prefs || DEFAULT_PREFS.full;
    const updatedPrefs = {
      ...currentPrefs,
      [key]: { ...(currentPrefs[key] || {}), [field]: value },
    };
    const updatedSettings = { ...settings, notification_prefs: updatedPrefs };
    setSettings(updatedSettings);
    if (pushActive) {
      await reschedule(updatedSettings);
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onProfileChange("logo", ev.target.result);
    reader.readAsDataURL(file);
  };

  const toggleSection = (key) => {
    setOpenSections(prev => {
      // Single-open accordion: open clicked section, close everything else
      if (prev.has(key)) return new Set(); // tap same = close
      return new Set([key]);
    });
  };

  const openTemplatePreview = (templateId) => {
    const sampleDoc = {
      document_type: "invoice", document_number: "INV-0001",
      title: "Sample Invoice", status: "sent",
      currency: "GBP",
      line_items: [
        { description: "Performance — Evening Event", quantity: 1, unit_price: 800, total: 800 },
        { description: "Travel expenses", quantity: 1, unit_price: 50, total: 50 },
      ],
      subtotal: 850, total: 850, discount_amount: 0, tax_amount: 0, tax_rate: 0,
      due_date: new Date(Date.now() + 14*86400000).toISOString().slice(0,10),
      notes: "Thank you for booking. Please transfer within 14 days.",
    };
    const sampleProfile = {
      business_name: profile?.business_name || "Your Name",
      address: profile?.address || "London, UK",
      email: profile?.email || "you@example.com",
      phone: profile?.phone || "",
      website: profile?.website || "",
      payment_instructions: profile?.payment_instructions || "Bank transfer preferred.",
    };
    const html = generateInvoiceHTML(sampleDoc, sampleProfile, settings, templateId);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const handleTestPush = async () => {
    setTestResult("Sending…");
    const result = await sendTestPush();
    if (result.success) {
      setTestResult("Sent — it should arrive in a few seconds.");
    } else if (result.reason === "not_subscribed") {
      setTestResult("Not subscribed — turn notifications off and on again.");
    } else {
      setTestResult("Failed: " + (result.reason || "unknown error"));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save settings
      if (settings.id) {
        await appClient.entities.AppSettings.update(settings.id, settings);
      } else {
        const created = await appClient.entities.AppSettings.create(settings);
        setSettings(created);
      }
      // Save business profile
      if (profile.id) {
        await appClient.entities.BusinessProfile.update(profile.id, profile);
      } else {
        const created = await appClient.entities.BusinessProfile.create(profile);
        setProfile(created);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Refresh the assistant profile module cache (AI chat + briefing read it)
      getAssistantProfile({ fresh: true }).catch(() => {});
      // Re-schedule notifications with latest settings (if push is active)
      if (pushActive) {
        reschedule(settings).catch(() => {});
      }
    } catch (err) {
      console.error("Save error:", err);
    }
    setSaving(false);
  };

  if (loading || !settings) return <div className="p-4 text-gray-400">Loading...</div>;

  const SectionHeader = ({ icon: Icon, label, sectionKey }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="w-full flex items-center gap-2 mb-3"
    >
      <Icon className="w-4 h-4 text-indigo-400" />
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide flex-1 text-left">{label}</h2>
      {openSections.has(sectionKey) ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
    </button>
  );

  const inputCls = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 placeholder-gray-500";
  const labelCls = "text-xs text-gray-400 mb-1 block";

  const DataSubSection = ({ label, children, defaultOpen = true }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
      <div className="border border-gray-700/60 rounded-xl overflow-hidden">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-800/60 hover:bg-gray-800 transition-colors"
        >
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
          {open ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
        </button>
        {open && <div className="px-3 pb-3">{children}</div>}
      </div>
    );
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="space-y-6">
        {/* Business Profile */}
        <section>
          <SectionHeader icon={Building2} label="Business Profile" sectionKey="profile" />
          {openSections.has("profile") && profile && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-xs text-gray-500 mb-2">Your details — appears on invoices.</p>

              {/* Logo upload */}
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
                  <input className={inputCls} placeholder="+44 7..." value={profile.phone || ""} onChange={e => onProfileChange("phone", e.target.value)} />
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

              <div className="border-t border-gray-700 pt-3 mt-3">
                <p className="text-xs text-gray-500 mb-2">Bank details — shown on invoices for payment.</p>
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
                    <textarea className={inputCls + " h-16 resize-none"} placeholder="e.g. Pay via bank transfer to..." value={profile.payment_instructions || ""} onChange={e => onProfileChange("payment_instructions", e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* AI Assistant */}
        <section>
          <SectionHeader icon={Sparkles} label="Assistant" sectionKey="assistant" />
          {openSections.has("assistant") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-4">
              <p className="text-xs text-gray-500">Personalize how the AI assistant talks to you.</p>
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
            </div>
          )}
        </section>

        <section>
          <SectionHeader icon={Banknote} label="Finance" sectionKey="finance" />
          {openSections.has("finance") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Default Currency</label>
                  <select className={inputCls} value={settings.currency || settings.default_currency || "GBP"} onChange={e => onChange("default_currency", e.target.value)}>
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

              {/* Invoice numbering */}
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

              {/* Invoice template */}
              <div className="border-t border-gray-700 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Invoice Template</p>
                <div className="flex gap-2.5">
                  {TEMPLATE_DEFS.map(t => {
                    const isActive = (settings.invoice_template || 1) === t.id;
                    const thumb = {
                      1: { hdr: "#e2e8f0", hdrText: "#475569", accent: "#475569", line: "#cbd5e1" },
                      2: { hdr: "#4f46e5", hdrText: "#fff",    accent: "#4f46e5", line: "#e0e7ff" },
                      3: { hdr: "#0f172a", hdrText: "#e2e8f0", accent: "#0f172a", line: "#f1f5f9" },
                      4: { hdr: "#fff",    hdrText: "#111827", accent: "#374151", line: "#e5e7eb" },
                      5: { hdr: "#4c1d95", hdrText: "#ede9fe", accent: "#7c3aed", line: "#ddd6fe" },
                    }[t.id];
                    return (
                      <button
                        key={t.id}
                        onClick={() => onChange("invoice_template", t.id)}
                        className={`rounded-md transition-all ${
                          isActive ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-gray-800" : "opacity-60 hover:opacity-100"
                        }`}
                        aria-label={t.name}
                      >
                        <svg width="44" height="57" viewBox="0 0 40 52" fill="none" className="rounded-md">
                          <rect width="40" height="52" fill="white" rx="2"/>
                          <rect width="40" height="13" fill={thumb.hdr} rx="2"/>
                          <rect x="0" y="11" width="40" height="2" fill={thumb.hdr}/>
                          <rect x="3" y="3" width="18" height="3" fill={thumb.hdrText} opacity="0.9" rx="1"/>
                          <rect x="3" y="7" width="10" height="1.5" fill={thumb.hdrText} opacity="0.5" rx="1"/>
                          <rect x="3" y="16" width="16" height="2" fill={thumb.accent} opacity="0.5" rx="1"/>
                          <rect x="3" y="20" width="11" height="1.5" fill={thumb.accent} opacity="0.3" rx="1"/>
                          <rect x="3" y="27" width="34" height="1.2" fill={thumb.line} rx="1"/>
                          <rect x="3" y="30.5" width="34" height="1.2" fill={thumb.line} rx="1"/>
                          <rect x="3" y="34" width="34" height="1.2" fill={thumb.line} rx="1"/>
                          <rect x="3" y="37.5" width="34" height="1.2" fill={thumb.line} rx="1"/>
                          <rect x="22" y="44" width="15" height="2" fill={thumb.accent} opacity="0.6" rx="1"/>
                        </svg>
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const active = TEMPLATE_DEFS.find(t => t.id === (settings.invoice_template || 1)) || TEMPLATE_DEFS[0];
                  return (
                    <div className="flex items-center justify-between gap-3 mt-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white">{active.name}</p>
                        <p className="text-xs text-gray-500 leading-snug">{active.desc}</p>
                      </div>
                      <button
                        onClick={() => openTemplatePreview(active.id)}
                        className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0 transition-colors"
                      >
                        Preview
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </section>

        {/* Navigation */}
        <section>
          <SectionHeader icon={Navigation} label="Navigation" sectionKey="navigation" />
          {openSections.has("navigation") && (
            <div className="bg-gray-800 rounded-xl p-4">
              <label className={labelCls}>Default Nav App</label>
              <div className="flex gap-2">
                {["google_maps", "waze"].map(app => (
                  <button
                    key={app}
                    onClick={() => onChange("default_nav_app", app)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                      settings.default_nav_app === app
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "bg-gray-900 border-gray-700 text-gray-400 hover:text-white"
                    }`}
                  >
                    {app === "google_maps" ? "Google Maps" : "Waze"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Notifications */}
        <section>
          <SectionHeader icon={Bell} label="Notifications" sectionKey="notifications" />
          {openSections.has("notifications") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-5">

              {/* Master toggle */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-gray-200">Push notifications</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {pushLoading
                      ? (pushActive ? "Turning off…" : "Turning on…")
                      : pushActive ? "Active on this device" : "Off"}
                  </p>
                </div>
                <Toggle
                  on={pushActive}
                  disabled={pushLoading}
                  onClick={pushActive ? handleDisablePush : handleEnablePush}
                />
              </div>

              {pushError && (
                <p className="text-xs text-red-400 bg-red-900/30 rounded-lg px-3 py-2">{pushError}</p>
              )}

              {/* Level — stacked rows */}
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
                      <button
                        key={key}
                        onClick={() => handleLevelChange(key)}
                        className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors ${
                          active ? "bg-indigo-600/15" : "bg-gray-900 hover:bg-gray-900/60"
                        }`}
                      >
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

              {/* Full mode: per-notification prefs editor */}
              {(settings.notification_level || "standard") === "full" && (
                <NotificationPrefsEditor
                  prefs={settings.notification_prefs || DEFAULT_PREFS.full}
                  onChange={handlePrefChange}
                />
              )}

              {/* Test */}
              {pushActive && (
                <div>
                  <button
                    onClick={handleTestPush}
                    className="w-full py-2.5 rounded-xl text-sm font-medium border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
                  >
                    Send test notification
                  </button>
                  {testResult && (
                    <p className="text-xs text-gray-500 text-center mt-2">{testResult}</p>
                  )}
                </div>
              )}

              {/* Diagnostics — tucked away */}
              <div>
                <button
                  onClick={() => setDiagOpen(o => !o)}
                  className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
                >
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

        {/* Gmail */}
        <section>
          <SectionHeader icon={Mail} label="Gmail" sectionKey="gmail" />
          {openSections.has("gmail") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-4">
              {gmailConnected ? (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-900/40 flex items-center justify-center flex-shrink-0">
                    <Check className="w-4 h-4 text-green-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-400">Connected</p>
                    <p className="text-xs text-gray-400 truncate">{gmailEmail}</p>
                  </div>
                  <button
                    onClick={() => { disconnectGmail(); setGmailConnected(false); setGmailEmail(''); }}
                    className="text-xs text-red-400 hover:text-red-300 underline underline-offset-2 flex-shrink-0"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-xs text-gray-400">Send invoices directly from your Gmail account.</p>
                  <button
                    onClick={connectGmail}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                  >
                    <Mail className="w-4 h-4" />
                    Connect Gmail
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {/* Calendar */}
        <section>
          <SectionHeader icon={CalendarDays} label="Calendar" sectionKey="calendar" />
          {openSections.has("calendar") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-4">
              {calStatus.connected ? (
                <>
                  {/* Connected account */}
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-900/40 flex items-center justify-center flex-shrink-0">
                      <Check className="w-4 h-4 text-green-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-green-400">Connected</p>
                      <p className="text-xs text-gray-400 truncate">{calStatus.email}</p>
                    </div>
                    <button
                      onClick={handleDisconnectCalendar}
                      disabled={calBusy}
                      className="text-xs text-red-400 hover:text-red-300 underline underline-offset-2 flex-shrink-0 disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  </div>

                  {/* Sync toggle */}
                  <div className="flex items-center justify-between gap-3 border-t border-gray-700 pt-4">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-200">Sync gigs to my calendar</p>
                      <p className="text-xs text-gray-500 mt-0.5">Two-way with your “{calStatus.calendar_summary || "Flowtone Gigs"}” calendar.</p>
                    </div>
                    <Toggle on={!!calStatus.sync_enabled} onClick={handleCalendarToggle} />
                  </div>

                  {/* Sync now */}
                  <div>
                    <button
                      onClick={handleCalendarSyncNow}
                      disabled={calSyncing || !calStatus.sync_enabled}
                      className="w-full py-2.5 rounded-xl text-sm font-medium border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${calSyncing ? "animate-spin" : ""}`} />
                      {calSyncing ? "Syncing…" : "Sync now"}
                    </button>
                    <p className="text-xs text-gray-500 text-center mt-2">
                      {calMsg
                        ? calMsg
                        : calStatus.last_synced_at
                          ? `Last synced ${formatDistanceToNow(new Date(calStatus.last_synced_at), { addSuffix: true })}`
                          : "Not synced yet"}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Two-way sync with Google Calendar. Gigs you create here appear in your calendar, and gigs you add to your “Flowtone Gigs” calendar appear here.
                  </p>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    On iPhone, add your Google account in the Calendar app to see gigs there.
                  </p>
                  <button
                    onClick={handleConnectCalendar}
                    disabled={calBusy}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
                  >
                    <CalendarDays className="w-4 h-4" />
                    Connect Google Calendar
                  </button>
                  {calMsg && <p className="text-xs text-gray-500 text-center">{calMsg}</p>}
                </>
              )}
            </div>
          )}
        </section>

        {/* Data */}
        <section>
          <SectionHeader icon={Download} label="Data" sectionKey="data" />
          {openSections.has("data") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-2">

              {/* ── Load Data ── */}
              <DataSubSection label="Load Data" defaultOpen={false}>
                <div className="space-y-2 pt-1">

                <button
                  onClick={async () => {
                    setTestImporting("connected");
                    try {
                      const today = new Date();
                      const d = (offset) => {
                        const dt = new Date(today);
                        dt.setDate(dt.getDate() + offset);
                        return dt.toISOString().slice(0, 10);
                      };

                      // ── 1. Clients ──────────────────────────────────────────
                      const [venue1, venue2, agent, sophie, liam, ava, noah, jake, emily, corp] = await Promise.all([
                        appClient.entities.Client.create({ name: "The Blue Note", client_type: "venue", emails: ["booker@bluenote.co.uk"], phones: ["020 7946 0123"], city: "London", default_currency: "GBP" }),
                        appClient.entities.Client.create({ name: "Ronnie Scott's Jazz Club", client_type: "venue", emails: ["gigs@ronniescotts.co.uk"], phones: ["020 7439 0747"], city: "London", default_currency: "GBP" }),
                        appClient.entities.Client.create({ name: "Premier Events Agency", client_type: "agent", emails: ["info@premierevents.co.uk"], phones: ["020 7123 4567"], city: "London", default_currency: "GBP" }),
                        appClient.entities.Client.create({ name: "Sophie Williams", client_type: "student", emails: ["sophie.w@gmail.com"], phones: ["07700 900111"], city: "London", default_currency: "GBP", default_fee: 65 }),
                        appClient.entities.Client.create({ name: "Liam Harris", client_type: "student", emails: ["liam.harris@hotmail.com"], phones: ["07700 900222"], city: "London", default_currency: "GBP", default_fee: 65 }),
                        appClient.entities.Client.create({ name: "Ava Martinez", client_type: "student", emails: ["ava.m@outlook.com"], phones: ["07700 900333"], city: "London", default_currency: "GBP", default_fee: 65 }),
                        appClient.entities.Client.create({ name: "Noah Williams", client_type: "student", emails: ["noah.w@gmail.com"], phones: ["07700 900444"], city: "London", default_currency: "GBP", default_fee: 65 }),
                        appClient.entities.Client.create({ name: "Jake Thompson", client_type: "student", emails: ["jthompson@yahoo.com"], phones: ["07700 900555"], city: "London", default_currency: "GBP", default_fee: 65 }),
                        appClient.entities.Client.create({ name: "Emily Foster", client_type: "student", emails: ["emily.foster@gmail.com"], phones: ["07700 900666"], city: "London", default_currency: "GBP", default_fee: 70 }),
                        appClient.entities.Client.create({ name: "Barclays Corporate Events", client_type: "other", emails: ["events@barclays.com"], phones: ["020 7116 1000"], city: "London", default_currency: "GBP" }),
                      ]);

                      // ── 2. Events — dense 2-week schedule from today ────────
                      const evts = await Promise.all([
                        // ── Week 1 ──────────────────────────────────────────────
                        // Sat Mar 28
                        appClient.entities.WorkEvent.create({ title: "Sophie Williams – Piano", event_type: "Lesson", status: "confirmed", date: d(1), start_time: "10:00", end_time: "11:00", client_id: sophie.id, base_price: 65, total_price: 65, currency: "GBP" }),
                        appClient.entities.WorkEvent.create({ title: "Liam Harris – Guitar", event_type: "Lesson", status: "confirmed", date: d(1), start_time: "14:00", end_time: "15:00", client_id: liam.id, base_price: 65, total_price: 65, currency: "GBP" }),
                        appClient.entities.WorkEvent.create({ title: "Wedding Reception – Bennett", event_type: "Gig", status: "confirmed", date: d(1), start_time: "17:30", end_time: "23:00", client_id: agent.id, location_address: "Hampton Court Palace, East Molesey KT8 9AU", base_price: 2200, total_price: 2200, currency: "GBP" }),
                        // Sun Mar 29
                        appClient.entities.WorkEvent.create({ title: "Jake Thompson – Piano", event_type: "Lesson", status: "confirmed", date: d(2), start_time: "10:00", end_time: "11:00", client_id: jake.id, base_price: 65, total_price: 65, currency: "GBP" }),
                        // Mon Mar 30
                        appClient.entities.WorkEvent.create({ title: "Ava Martinez – Piano", event_type: "Lesson", status: "confirmed", date: d(3), start_time: "11:00", end_time: "12:00", client_id: ava.id, base_price: 65, total_price: 65, currency: "GBP" }),
                        appClient.entities.WorkEvent.create({ title: "Corporate Lunch – Barclays", event_type: "Session", status: "confirmed", date: d(3), start_time: "12:30", end_time: "14:30", client_id: corp.id, location_address: "1 Churchill Place, Canary Wharf, London", base_price: 450, total_price: 450, currency: "GBP" }),
                        // Tue Apr 1
                        appClient.entities.WorkEvent.create({ title: "Emily Foster – Vocals", event_type: "Lesson", status: "confirmed", date: d(5), start_time: "17:00", end_time: "18:00", client_id: emily.id, base_price: 70, total_price: 70, currency: "GBP" }),
                        appClient.entities.WorkEvent.create({ title: "Jazz Quartet Rehearsal", event_type: "Rehearsal", status: "confirmed", date: d(5), start_time: "19:00", end_time: "22:00", location_address: "Home Studio", base_price: 0, total_price: 0, currency: "GBP" }),
                        // Wed Apr 2
                        appClient.entities.WorkEvent.create({ title: "Noah Williams – Guitar", event_type: "Lesson", status: "confirmed", date: d(6), start_time: "16:00", end_time: "17:00", client_id: noah.id, base_price: 65, total_price: 65, currency: "GBP" }),
                        appClient.entities.WorkEvent.create({ title: "Corporate Dinner – Goldman Sachs", event_type: "Gig", status: "confirmed", date: d(6), start_time: "19:30", end_time: "22:30", client_id: corp.id, location_address: "Goldman Sachs HQ, Plumtree Court, London", base_price: 950, total_price: 950, currency: "GBP" }),
                        // ── Week 2 ──────────────────────────────────────────────
                        // Thu Apr 3
                        appClient.entities.WorkEvent.create({ title: "Music Theory Workshop", event_type: "Session", status: "confirmed", date: d(7), start_time: "10:00", end_time: "13:00", client_id: agent.id, location_address: "Trinity Laban, King Charles Court, London", base_price: 300, total_price: 300, currency: "GBP" }),
                        // Fri Apr 4
                        appClient.entities.WorkEvent.create({ title: "Private Party – 50th Birthday", event_type: "Gig", status: "confirmed", date: d(8), start_time: "20:00", end_time: "23:00", client_id: agent.id, location_address: "The Ivy, 1-5 West St, London WC2H 9NQ", base_price: 700, total_price: 700, currency: "GBP" }),
                        // Sat Apr 5
                        appClient.entities.WorkEvent.create({ title: "Sophie Williams – Piano", event_type: "Lesson", status: "confirmed", date: d(9), start_time: "10:00", end_time: "11:00", client_id: sophie.id, base_price: 65, total_price: 65, currency: "GBP" }),
                        appClient.entities.WorkEvent.create({ title: "Liam Harris – Guitar", event_type: "Lesson", status: "confirmed", date: d(9), start_time: "14:00", end_time: "15:00", client_id: liam.id, base_price: 65, total_price: 65, currency: "GBP" }),
                        appClient.entities.WorkEvent.create({ title: "Jazz Night @ Ronnie Scott's", event_type: "Gig", status: "confirmed", date: d(9), start_time: "21:00", end_time: "23:30", client_id: venue2.id, location_address: "47 Frith St, Soho, London W1D 4HT", base_price: 600, total_price: 600, currency: "GBP" }),
                        // Sun Apr 6
                        appClient.entities.WorkEvent.create({ title: "Jake Thompson – Piano", event_type: "Lesson", status: "confirmed", date: d(10), start_time: "11:00", end_time: "12:00", client_id: jake.id, base_price: 65, total_price: 65, currency: "GBP" }),
                        // Mon Apr 7
                        appClient.entities.WorkEvent.create({ title: "Ava Martinez – Piano", event_type: "Lesson", status: "confirmed", date: d(11), start_time: "11:00", end_time: "12:00", client_id: ava.id, base_price: 65, total_price: 65, currency: "GBP" }),
                        // Tue Apr 8
                        appClient.entities.WorkEvent.create({ title: "Chamber Music Session – Barbican", event_type: "Session", status: "lead", date: d(12), start_time: "14:00", end_time: "16:00", client_id: venue1.id, location_address: "Barbican Centre, Silk St, London EC2Y 8DS", base_price: 380, total_price: 380, currency: "GBP" }),
                        appClient.entities.WorkEvent.create({ title: "Emily Foster – Vocals", event_type: "Lesson", status: "confirmed", date: d(12), start_time: "17:00", end_time: "18:00", client_id: emily.id, base_price: 70, total_price: 70, currency: "GBP" }),
                        // Wed Apr 9
                        appClient.entities.WorkEvent.create({ title: "Noah Williams – Guitar", event_type: "Lesson", status: "confirmed", date: d(13), start_time: "16:00", end_time: "17:00", client_id: noah.id, base_price: 65, total_price: 65, currency: "GBP" }),
                        appClient.entities.WorkEvent.create({ title: "Corporate Awards Night – KPMG", event_type: "Gig", status: "confirmed", date: d(13), start_time: "19:00", end_time: "22:00", client_id: corp.id, location_address: "KPMG HQ, 15 Canada Square, London E14 5GL", base_price: 1200, total_price: 1200, currency: "GBP" }),
                        // Thu Apr 10
                        appClient.entities.WorkEvent.create({ title: "Jazz Quartet – Full Rehearsal", event_type: "Rehearsal", status: "confirmed", date: d(14), start_time: "16:00", end_time: "19:00", location_address: "Home Studio", base_price: 0, total_price: 0, currency: "GBP" }),
                        // ── Past events (completed/paid) ─────────────────────────
                        appClient.entities.WorkEvent.create({ title: "Jazz Night @ Blue Note", event_type: "Gig", status: "completed", date: d(-14), start_time: "20:00", end_time: "23:00", client_id: venue1.id, location_address: "131 W 3rd St, London", base_price: 350, total_price: 350, currency: "GBP" }),
                        appClient.entities.WorkEvent.create({ title: "Liam Harris – Guitar", event_type: "Lesson", status: "completed", date: d(-7), start_time: "14:00", end_time: "15:00", client_id: liam.id, base_price: 65, total_price: 65, currency: "GBP" }),
                        appClient.entities.WorkEvent.create({ title: "School Workshop – St Mary's", event_type: "Session", status: "completed", date: d(-10), start_time: "09:30", end_time: "11:30", client_id: agent.id, location_address: "St Mary's School, Upper Street, London N1", base_price: 280, total_price: 280, currency: "GBP" }),
                      ]);

                      // ── 3. Invoices — all linked, various statuses ───────────
                      const inv = (num, title, clientId, eventId, total, status, dueOffset, paidOffset) => {
                        const base = {
                          document_type: "invoice",
                          document_number: `INV-${String(num).padStart(4, "0")}`,
                          title, client_id: clientId, work_event_id: eventId,
                          status, total, subtotal: total, currency: "GBP",
                          due_date: d(dueOffset), is_locked: status !== "draft",
                          line_items: [{ description: title, quantity: 1, unit_price: total, total }],
                        };
                        if (paidOffset !== undefined) { base.paid_date = d(paidOffset); base.paid_amount = total; }
                        return base;
                      };

                      await Promise.all([
                        // ── Paid (past) ──
                        appClient.entities.Document.create(inv(1, "Jazz Night @ Blue Note", venue1.id, evts[22].id, 350, "paid", -7, -10)),
                        appClient.entities.Document.create(inv(2, "School Workshop – St Mary's", agent.id, evts[24].id, 280, "paid", -3, -5)),
                        appClient.entities.Document.create(inv(3, "Liam Harris – Guitar (Mar)", liam.id, evts[23].id, 65, "paid", -2, -2)),
                        // ── Overdue (sent but past due) ──
                        appClient.entities.Document.create(inv(4, "Sophie Williams – Piano (Mar)", sophie.id, evts[0].id, 130, "sent", -3)),
                        appClient.entities.Document.create(inv(5, "Jake Thompson – Piano (Mar)", jake.id, evts[3].id, 65, "sent", -1)),
                        // ── Sent (upcoming, awaiting payment) ──
                        appClient.entities.Document.create(inv(6, "Wedding Reception – Bennett", agent.id, evts[2].id, 2200, "sent", 14)),
                        appClient.entities.Document.create(inv(7, "Corporate Lunch – Barclays", corp.id, evts[5].id, 450, "sent", 21)),
                        appClient.entities.Document.create(inv(8, "Corporate Dinner – Goldman Sachs", corp.id, evts[9].id, 950, "sent", 28)),
                        appClient.entities.Document.create(inv(9, "Jazz Night @ Ronnie Scott's", venue2.id, evts[14].id, 600, "sent", 21)),
                        // ── Draft (need to send) ──
                        appClient.entities.Document.create(inv(10, "Private Party – 50th Birthday", agent.id, evts[11].id, 700, "draft", 30)),
                        appClient.entities.Document.create(inv(11, "Corporate Awards Night – KPMG", corp.id, evts[20].id, 1200, "draft", 30)),
                        appClient.entities.Document.create(inv(12, "Music Theory Workshop", agent.id, evts[10].id, 300, "draft", 21)),
                        appClient.entities.Document.create(inv(13, "Liam Harris – Guitar (Apr)", liam.id, evts[1].id, 130, "draft", 14)),
                        appClient.entities.Document.create(inv(14, "Ava Martinez – Piano (Apr)", ava.id, evts[4].id, 130, "draft", 14)),
                        appClient.entities.Document.create(inv(15, "Noah Williams – Guitar (Apr)", noah.id, evts[8].id, 130, "draft", 14)),
                        appClient.entities.Document.create(inv(16, "Emily Foster – Vocals (Apr)", emily.id, evts[6].id, 140, "draft", 14)),
                        appClient.entities.Document.create(inv(17, "Chamber Music – Barbican", venue1.id, evts[17].id, 380, "draft", 21)),
                      ]);

                      setTestImporting(null);
                      setTestImported("connected");
                    } catch (err) {
                      console.error("Demo data error:", err);
                      setTestImporting(null);
                    }
                  }}
                  disabled={testImporting === "connected"}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors"
                >
                  {testImporting === "connected" ? "Creating…" : testImported === "connected" ? "✓ Demo Data Loaded!" : "✨ Load Connected Demo Data"}
                </button>
                {testImported === "connected" && (
                  <p className="text-[11px] text-gray-500 text-center">10 clients · 25 events · 17 invoices</p>
                )}
                <button
                  onClick={async () => {
                    setLoadingBusyMusician(true);
                    try {
                      await generateBusyMusicianData(appClient);
                      setTestImported("busymusician");
                      setTimeout(() => setTestImported(null), 5000);
                    } catch (err) {
                      console.error("Error generating busy musician data:", err);
                    } finally {
                      setLoadingBusyMusician(false);
                    }
                  }}
                  disabled={loadingBusyMusician}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-purple-900/40 hover:bg-purple-900/60 disabled:opacity-50 text-purple-300 border border-purple-700/40 transition-colors"
                >
                  {loadingBusyMusician ? "Generating…" : testImported === "busymusician" ? "✓ Data Loaded!" : "Load Busy Musician Data (Jan 2025 – May 2027)"}
                </button>
                {testImported === "busymusician" && (
                  <p className="text-[11px] text-gray-500 text-center">20 students · 56 gigs · invoices · payments · practice</p>
                )}
                </div>
              </DataSubSection>

              {/* ── Backup & Restore ── */}
              <DataSubSection label="Backup & Restore">
                <div className="space-y-2 pt-1">
                  <button
                    onClick={() => setShowCSVImport(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
                  >
                    <UploadIcon className="w-4 h-4" />
                    Restore from Backup
                  </button>
                  <button
                    onClick={async () => { const csv = await exportFullApp(appClient); downloadCSV("flowtone-backup.csv", csv); }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Export Full App Backup
                  </button>
                  <p className="text-[11px] text-gray-600 text-center">Saves everything — clients, events, invoices, practice, equipment</p>
                </div>
              </DataSubSection>

            </div>
          )}
        </section>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
            saved ? "bg-green-600 text-white" : "bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
          }`}
        >
          {saved ? <><Check className="w-4 h-4" /> Saved!</> : saving ? "Saving..." : "Save Settings"}
        </button>

        {/* Account */}
        {!isPreviewMode && (
          <div className="rounded-2xl border border-gray-700/60 bg-gray-800/30 p-4 space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Account</p>
            {user?.email && (
              <p className="text-sm text-gray-400">Signed in as <span className="text-white">{user.email}</span></p>
            )}
            <button
              onClick={() => logout()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
      </div>

      {showCSVImport && <SmartCSVImport onClose={() => setShowCSVImport(false)} onImported={() => setShowCSVImport(false)} />}
    </div>
  );
}
