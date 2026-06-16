import { useState, useEffect, useRef, useCallback } from "react";
import { appClient } from "@/api/appClient";
import { useAuth } from "@/lib/AuthContext";
import {
  Check, Mail, Bell, Banknote, Building2, CalendarDays, RefreshCw,
  ChevronDown, ChevronUp, Upload, X, Download, Upload as UploadIcon,
  LogOut, Sparkles, Link2
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getAssistantProfile, DEFAULT_ASSISTANT_NAME, DEFAULT_LANGUAGE } from "@/lib/assistantProfile";
import { LANGUAGE_OPTIONS } from "@/components/onboarding/onboardingScript";
import { TEMPLATE_DEFS, generateInvoiceHTML, sanitizeCustom, DEFAULT_CUSTOM, ACCENT_PRESETS, HEADER_STYLES, FONT_CHOICES } from "@/lib/invoiceTemplates";
import { registerPush, unregisterPush, isPushActive, schedulePushNotifications, sendTestPush } from "@/lib/pushManager";
import { DEFAULT_PREFS } from "@/lib/notificationPrefs";
import { isGmailConnected, getGmailEmail, connectGmail, disconnectGmail } from "@/lib/gmailClient";
import { connectCalendar, getCalendarStatus, syncNow as calendarSyncNow, setSyncEnabled as setCalendarSyncEnabled, disconnectCalendar } from "@/lib/calendarClient";
import SmartCSVImport from "@/components/SmartCSVImport";
import { exportFullApp, downloadCSV } from "@/lib/csvExport";
import NotificationPrefsEditor, { Toggle } from "@/components/NotificationPrefsEditor";

export default function AppSettings() {
  const { logout, user, isPreviewMode } = useAuth();
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // 'idle' | 'saving' | 'saved'
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState(new Set(["finance"]));
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

  useEffect(() => {
    Promise.all([
      appClient.entities.AppSettings.list(),
      appClient.entities.BusinessProfile.list(),
    ]).then(([settingsData, profileData]) => {
      const s = settingsData[0] || {
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

  const openTemplatePreview = (templateId) => {
    const sampleDoc = {
      document_type: "invoice", document_number: "INV-0001", title: "Sample Invoice",
      status: "sent", currency: "GBP",
      line_items: [
        { description: "Performance — Evening Event", quantity: 1, unit_price: 800, total: 800 },
        { description: "Travel expenses", quantity: 1, unit_price: 50, total: 50 },
      ],
      subtotal: 850, total: 850, discount_amount: 0, tax_amount: 0, tax_rate: 0,
      due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
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
    window.open(URL.createObjectURL(blob), "_blank");
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
                <div className="flex gap-2.5">
                  {TEMPLATE_DEFS.map(t => {
                    const isActive = (settings.invoice_template || 1) === t.id;
                    const thumb = {
                      1: { hdr: "#e2e8f0", hdrText: "#475569", accent: "#475569", line: "#cbd5e1" },
                      2: { hdr: "#4f46e5", hdrText: "#fff",    accent: "#4f46e5", line: "#e0e7ff" },
                      3: { hdr: "#0f172a", hdrText: "#e2e8f0", accent: "#0f172a", line: "#f1f5f9" },
                      4: { hdr: "#fff",    hdrText: "#111827", accent: "#374151", line: "#e5e7eb" },
                      5: { hdr: "#4c1d95", hdrText: "#ede9fe", accent: "#7c3aed", line: "#ddd6fe" },
                      6: (() => { const a = sanitizeCustom(settings.invoice_custom).accent_color; return { hdr: a, hdrText: "#fff", accent: a, line: "#e5e7eb" }; })(),
                    }[t.id];
                    return (
                      <button
                        key={t.id}
                        onClick={() => onChange("invoice_template", t.id)}
                        className={`rounded-md transition-all ${isActive ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-gray-800" : "opacity-60 hover:opacity-100"}`}
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
                      <button onClick={() => openTemplatePreview(active.id)} className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0 transition-colors">
                        Preview
                      </button>
                    </div>
                  );
                })()}

                {(settings.invoice_template || 1) === 6 && (() => {
                  const custom = sanitizeCustom(settings.invoice_custom);
                  const setCustom = (patch) => onChange("invoice_custom", { ...custom, ...patch });
                  const HEADER_LABELS = { band: "Colour band", minimal: "Minimal line", centered: "Centred" };
                  const FONT_LABELS = { sans: "Sans", serif: "Serif" };
                  const segBtn = (active) => `flex-1 text-xs py-1.5 rounded-md transition-colors ${active ? "bg-indigo-600 text-white" : "bg-gray-900 text-gray-400 hover:text-gray-200"}`;
                  return (
                    <div className="mt-4 pt-4 border-t border-gray-700/60 space-y-4">
                      <p className="text-[11px] text-gray-500 leading-snug">
                        Make it yours — or just ask the assistant: <span className="text-gray-400">"make my invoice header teal and centred."</span>
                      </p>
                      <div>
                        <label className={labelCls}>Accent colour</label>
                        <div className="flex items-center gap-2 flex-wrap">
                          {ACCENT_PRESETS.map(hex => (
                            <button key={hex} onClick={() => setCustom({ accent_color: hex })} aria-label={hex}
                              className={`w-7 h-7 rounded-full transition-transform ${custom.accent_color === hex ? "ring-2 ring-offset-2 ring-offset-gray-800 ring-white scale-110" : "hover:scale-105"}`}
                              style={{ backgroundColor: hex }} />
                          ))}
                          <label className="w-7 h-7 rounded-full border border-gray-600 grid place-items-center cursor-pointer relative overflow-hidden" title="Custom colour">
                            <input type="color" value={custom.accent_color} onChange={e => setCustom({ accent_color: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
                            <span className="text-[10px] text-gray-400">+</span>
                          </label>
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>Header style</label>
                        <div className="flex gap-1.5 bg-gray-900 p-1 rounded-lg">
                          {HEADER_STYLES.map(h => <button key={h} onClick={() => setCustom({ header_style: h })} className={segBtn(custom.header_style === h)}>{HEADER_LABELS[h]}</button>)}
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>Body font</label>
                        <div className="flex gap-1.5 bg-gray-900 p-1 rounded-lg">
                          {FONT_CHOICES.map(f => <button key={f} onClick={() => setCustom({ font: f })} className={segBtn(custom.font === f)}>{FONT_LABELS[f]}</button>)}
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>Footer line</label>
                        <input className={inputCls} maxLength={160} placeholder={DEFAULT_CUSTOM.footer_text} value={custom.footer_text} onChange={e => setCustom({ footer_text: e.target.value })} />
                      </div>
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-sm text-white">Show logo</span>
                        <button onClick={() => setCustom({ show_logo: !custom.show_logo })}
                          className={`w-11 h-6 rounded-full transition-colors relative ${custom.show_logo ? "bg-indigo-600" : "bg-gray-600"}`}
                          aria-pressed={custom.show_logo}>
                          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${custom.show_logo ? "left-[22px]" : "left-0.5"}`} />
                        </button>
                      </label>
                    </div>
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
    </div>
  );
}
