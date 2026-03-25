import { useState, useEffect, useRef, useCallback } from "react";
import { appClient } from "@/api/appClient";
import { Settings, Check, Mail, Navigation, Bell, DollarSign, Building2, Hash, ChevronDown, ChevronUp, Upload, X, Palette, Download, Upload as UploadIcon } from "lucide-react";
import { TEMPLATE_DEFS } from "@/lib/invoiceTemplates";
import { registerPush, unregisterPush, isPushActive, schedulePushNotifications } from "@/lib/pushManager";
import { isGmailConnected, getGmailEmail, connectGmail, disconnectGmail } from "@/lib/gmailClient";
import SmartCSVImport from "@/components/SmartCSVImport";
import { exportClients, exportEvents, exportInvoices, downloadCSV } from "@/lib/csvExport";

export default function AppSettings() {
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

  // ── Gmail state ───────────────────────────────────────────────────
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState('');

  // ── CSV Import state ──────────────────────────────────────────────
  const [showCSVImport, setShowCSVImport] = useState(false);

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
        estimate_number_prefix: "EST-",
        estimate_number_next: 1,
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
  }, []);

  const onChange = (field, value) => setSettings(prev => ({ ...prev, [field]: value }));
  const onProfileChange = (field, value) => setProfile(prev => ({ ...prev, [field]: value }));

  // ── Push helpers ───────────────────────────────────────────────────

  /** Load events + clients then reschedule all notifications. */
  const reschedule = useCallback(async (level) => {
    try {
      const [events, clients] = await Promise.all([
        appClient.entities.WorkEvent.list(),
        appClient.entities.Client.list(),
      ]);
      await schedulePushNotifications(events, clients, level);
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
        await reschedule(level);
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
    onChange("notification_level", level);
    if (pushActive) {
      await reschedule(level);
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
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
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

  return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Settings className="w-5 h-5 text-indigo-400" />
        <h1 className="text-xl font-bold text-white">Settings</h1>
      </div>

      <div className="space-y-6">
        {/* Business Profile */}
        <section>
          <SectionHeader icon={Building2} label="Business Profile" sectionKey="profile" />
          {openSections.has("profile") && profile && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-xs text-gray-500 mb-2">Your details — appears on invoices and estimates.</p>

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

        {/* Finance */}
        <section>
          <SectionHeader icon={DollarSign} label="Finance" sectionKey="finance" />
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
            </div>
          )}
        </section>

        {/* Document Numbering */}
        <section>
          <SectionHeader icon={Hash} label="Document Numbering" sectionKey="numbering" />
          {openSections.has("numbering") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-4">
              <p className="text-xs text-gray-500">Configure auto-numbering for invoices and estimates.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Invoice Prefix</label>
                  <input className={inputCls} value={settings.invoice_number_prefix || "INV-"} onChange={e => onChange("invoice_number_prefix", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Next Invoice #</label>
                  <input type="number" min="1" className={inputCls} value={settings.invoice_number_next || 1} onChange={e => onChange("invoice_number_next", parseInt(e.target.value) || 1)} />
                </div>
                <div>
                  <label className={labelCls}>Estimate Prefix</label>
                  <input className={inputCls} value={settings.estimate_number_prefix || "EST-"} onChange={e => onChange("estimate_number_prefix", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Next Estimate #</label>
                  <input type="number" min="1" className={inputCls} value={settings.estimate_number_next || 1} onChange={e => onChange("estimate_number_next", parseInt(e.target.value) || 1)} />
                </div>
              </div>
              <p className="text-xs text-gray-600">Preview: {settings.invoice_number_prefix || "INV-"}{String(settings.invoice_number_next || 1).padStart(4, "0")}</p>
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

        {/* Email / Gmail */}
        <section>
          <SectionHeader icon={Mail} label="Email" sectionKey="email" />
          {openSections.has("email") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm text-gray-200">Gmail Connected</p>
                  <p className="text-xs text-gray-500">Connect your Gmail to sync relevant emails</p>
                </div>
                <button
                  onClick={() => onChange("gmail_connected", !settings.gmail_connected)}
                  className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 ${settings.gmail_connected ? "bg-indigo-600" : "bg-gray-700"}`}
                >
                  <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${settings.gmail_connected ? "translate-x-4" : "translate-x-0"}`} />
                </button>
              </div>
              {settings.gmail_connected && (
                <div>
                  <label className={labelCls}>Gmail Account</label>
                  <input className={inputCls} placeholder="your@gmail.com" value={settings.gmail_account || ""} onChange={e => onChange("gmail_account", e.target.value)} />
                </div>
              )}
              <div>
                <label className={labelCls}>Email Auto Action</label>
                <select className={inputCls} value={settings.email_auto_action || "suggest_only"} onChange={e => onChange("email_auto_action", e.target.value)}>
                  <option value="suggest_only">Suggest only</option>
                  <option value="auto_draft">Auto draft</option>
                  <option value="ignore">Ignore</option>
                </select>
              </div>
            </div>
          )}
        </section>

        {/* Reminders */}
        <section>
          <SectionHeader icon={Bell} label="Reminders" sectionKey="reminders" />
          {openSections.has("reminders") && (
            <div className="bg-gray-800 rounded-xl p-4">
              <label className={labelCls}>Reminder Channel</label>
              <div className="flex gap-2">
                {["in_app", "email"].map(ch => (
                  <button
                    key={ch}
                    onClick={() => onChange("reminder_channel", ch)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                      settings.reminder_channel === ch
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "bg-gray-900 border-gray-700 text-gray-400 hover:text-white"
                    }`}
                  >
                    {ch === "in_app" ? "In-App" : "Email"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Invoice Templates */}
        <section>
          <SectionHeader icon={Palette} label="Invoice Templates" sectionKey="templates" />
          {openSections.has("templates") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-xs text-gray-500">Choose the design used when printing or emailing invoices & estimates.</p>
              <div className="grid grid-cols-1 gap-2">
                {TEMPLATE_DEFS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => onChange("invoice_template", t.id)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                      (settings.invoice_template || 1) === t.id
                        ? "border-indigo-500 bg-indigo-600/10"
                        : "border-gray-700 bg-gray-900 hover:border-gray-600"
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                      (settings.invoice_template || 1) === t.id ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-400"
                    }`}>{t.id}</div>
                    <div>
                      <p className={`text-sm font-medium ${(settings.invoice_template || 1) === t.id ? "text-indigo-400" : "text-white"}`}>{t.name}</p>
                      <p className="text-xs text-gray-500">{t.desc}</p>
                    </div>
                    {(settings.invoice_template || 1) === t.id && (
                      <Check className="w-4 h-4 text-indigo-400 ml-auto flex-shrink-0" />
                    )}
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
            <div className="bg-gray-800 rounded-xl p-4 space-y-4">

              {/* Status badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 uppercase tracking-wide">Status</span>
                {pushActive ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-400 bg-green-900/40 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                    Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-semibold text-gray-500 bg-gray-700 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500 inline-block" />
                    Off
                  </span>
                )}
              </div>

              {/* Mode selector */}
              <div>
                <label className={labelCls}>Notification Level</label>
                <div className="flex gap-2">
                  {[
                    { key: "minimal", label: "Minimal" },
                    { key: "standard", label: "Standard" },
                    { key: "full", label: "Full" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => handleLevelChange(key)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                        (settings.notification_level || "standard") === key
                          ? "bg-indigo-600 border-indigo-500 text-white"
                          : "bg-gray-900 border-gray-700 text-gray-400 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Level descriptions */}
              <div className="space-y-1.5">
                {[
                  { key: "minimal", desc: "Invoice reminders + Leave alerts" },
                  { key: "standard", desc: "+ Day-before gig reminders" },
                  { key: "full", desc: "All notifications" },
                ].map(({ key, desc }) => (
                  <div
                    key={key}
                    className={`flex items-start gap-2 text-xs transition-colors ${
                      (settings.notification_level || "standard") === key
                        ? "text-indigo-300"
                        : "text-gray-500"
                    }`}
                  >
                    <span className="mt-0.5 capitalize font-medium w-16 flex-shrink-0">{key}:</span>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>

              {/* Error message */}
              {pushError && (
                <p className="text-xs text-red-400 bg-red-900/30 rounded-lg px-3 py-2">{pushError}</p>
              )}

              {/* Enable / Disable button */}
              <button
                onClick={pushActive ? handleDisablePush : handleEnablePush}
                disabled={pushLoading}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${
                  pushActive
                    ? "bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white"
                }`}
              >
                <Bell className="w-4 h-4" />
                {pushLoading
                  ? pushActive ? "Disabling…" : "Enabling…"
                  : pushActive ? "Disable Notifications" : "Enable Notifications"}
              </button>

              <p className="text-[10px] text-gray-600 leading-relaxed">
                Push notifications work even when the app is closed. Your browser will ask for permission when you enable them.
              </p>
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

        {/* Data */}
        <section>
          <SectionHeader icon={Download} label="Data" sectionKey="data" />
          {openSections.has("data") && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-xs text-gray-500">Import data from a CSV file or export your data for backup or migration.</p>
              <button
                onClick={() => setShowCSVImport(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              >
                <UploadIcon className="w-4 h-4" />
                Import CSV
              </button>
              <div className="border-t border-gray-700 pt-3 space-y-2">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Export</p>
                <button
                  onClick={async () => { const csv = await exportClients(appClient); downloadCSV("clients.csv", csv); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Export Clients
                </button>
                <button
                  onClick={async () => { const csv = await exportEvents(appClient); downloadCSV("events.csv", csv); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Export Events
                </button>
                <button
                  onClick={async () => { const csv = await exportInvoices(appClient); downloadCSV("invoices.csv", csv); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Export Invoices
                </button>
              </div>
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
      </div>

      {showCSVImport && <SmartCSVImport onClose={() => setShowCSVImport(false)} onImported={() => setShowCSVImport(false)} />}
    </div>
  );
}
