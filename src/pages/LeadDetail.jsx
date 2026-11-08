import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { createPageUrl, currencySymbol, formatMoney } from "@/utils";
import { isGmailConnected, sendGmailEmail } from "@/lib/gmailClient";
import { useToast } from "@/components/ui/use-toast";
import { format, addDays } from "date-fns";
import {
  Phone, Mail, MapPin, Calendar, FileText, CalendarRange, ChevronDown,
  Link2, Send, Pencil, MessageSquare,
} from "lucide-react";

const STATUS_LABELS = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  accepted: "Accepted",
  declined: "Declined",
  lost: "Lost",
};

const STATUS_PILL = {
  new: "bg-gray-700/50 text-gray-300 border-gray-700/60",
  contacted: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  quoted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  accepted: "bg-green-500/20 text-green-400 border-green-500/30",
  declined: "bg-gray-800 text-gray-500 border-gray-700",
  lost: "bg-gray-800 text-gray-500 border-gray-700",
};

export default function LeadDetail() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const leadId = new URLSearchParams(location.search).get("id");

  const [lead, setLead] = useState(null);
  const [pkg, setPkg] = useState(null);
  const [quoteDoc, setQuoteDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sendingQuote, setSendingQuote] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    if (!leadId) return;
    (async () => {
      try {
        const found = await appClient.entities.Lead.filter({ id: leadId });
        const row = found[0] || null;
        setLead(row);
        if (row?.package_id) {
          const pkgs = await appClient.entities.ServicePackage.filter({ id: row.package_id });
          setPkg(pkgs[0] || null);
        }
        if (row?.document_id) {
          const docs = await appClient.entities.Document.filter({ id: row.document_id });
          setQuoteDoc(docs[0] || null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [leadId]);

  // Auto-save: update local state immediately, persist debounced.
  const patchLead = (patch) => {
    setLead((prev) => ({ ...prev, ...patch }));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      appClient.entities.Lead.update(leadId, { ...patch, last_activity_at: new Date().toISOString() });
    }, 600);
  };

  const setStatus = async (status) => {
    setLead((prev) => ({ ...prev, status }));
    await appClient.entities.Lead.update(leadId, { status, last_activity_at: new Date().toISOString() });
  };

  const quoteUrl = lead?.public_token ? `${window.location.origin}/q/${lead.public_token}` : null;

  const copyQuoteLink = async () => {
    if (!quoteUrl) return;
    try {
      await navigator.clipboard.writeText(quoteUrl);
      toast({ description: "Quote link copied" });
    } catch {
      toast({ description: quoteUrl });
    }
  };

  const ensureQuote = async () => {
    if (quoteDoc) return quoteDoc;
    const settings = await appClient.helpers.ensureSingletonEntity("AppSettings");
    const documentNumber = await appClient.helpers.getNextDocumentNumber("estimate");
    const price = pkg?.price != null ? Number(pkg.price) : 0;
    const description = pkg?.name
      ? `${pkg.name}${lead.event_date ? ` — ${lead.event_date}` : ""}`
      : `${lead.event_type || "Performance"}${lead.event_date ? ` — ${lead.event_date}` : ""}`;
    const lineItems = [{ description, quantity: 1, unit_price: price, total: price }];
    const totals = appClient.helpers.calculateDocumentTotals({
      line_items: lineItems,
      discount_type: "none",
      discount_value: 0,
      tax_rate: 0,
    });
    const doc = await appClient.entities.Document.create({
      document_type: "estimate",
      document_number: documentNumber,
      title: pkg?.name || `Quote for ${lead.contact_name}`,
      client_name: lead.contact_name || "",
      client_email: lead.contact_email || "",
      status: "draft",
      currency: pkg?.currency || settings?.currency || "GBP",
      line_items: lineItems,
      ...totals,
      valid_until: format(addDays(new Date(), 14), "yyyy-MM-dd"),
      is_standalone: true,
      lead_id: lead.id,
    });
    setQuoteDoc(doc);
    await appClient.entities.Lead.update(leadId, { document_id: doc.id });
    setLead((prev) => ({ ...prev, document_id: doc.id }));
    return doc;
  };

  const handleEditQuoteFirst = async () => {
    setSendingQuote(true);
    try {
      const doc = await ensureQuote();
      navigate(createPageUrl(`DocumentDetail?id=${doc.id}&type=estimate`));
    } finally {
      setSendingQuote(false);
    }
  };

  const handleSendQuote = async () => {
    setSendingQuote(true);
    try {
      const doc = await ensureQuote();
      if (doc.status === "draft") {
        await appClient.entities.Document.update(doc.id, { status: "sent", sent_date: format(new Date(), "yyyy-MM-dd") });
        setQuoteDoc((prev) => ({ ...prev, status: "sent" }));
      }
      await appClient.entities.Lead.update(leadId, {
        status: "quoted",
        quote_sent_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      });
      setLead((prev) => ({ ...prev, status: "quoted", quote_sent_at: new Date().toISOString() }));

      if (isGmailConnected() && lead.contact_email) {
        const profile = await appClient.helpers.ensureSingletonEntity("BusinessProfile");
        const business = profile?.business_name || "Flowtone";
        await sendGmailEmail({
          to: lead.contact_email,
          subject: `Your quote from ${business}`,
          htmlBody: buildQuoteEmail({ lead, business, total: doc.total, currency: doc.currency, quoteUrl }),
        });
        toast({ description: `Quote emailed to ${lead.contact_email}` });
      } else {
        await copyQuoteLink();
        if (!lead.contact_email) toast({ description: "No email on this lead — link copied instead" });
        else toast({ description: "Gmail not connected — quote link copied, paste it anywhere" });
      }
    } catch (err) {
      toast({ description: err.message || "Could not send the quote" });
    } finally {
      setSendingQuote(false);
    }
  };

  const handleDelete = async () => {
    await appClient.entities.Lead.delete(leadId);
    navigate(createPageUrl("Leads"));
  };

  const heroRows = useMemo(() => {
    if (!lead) return [];
    const rows = [];
    if (lead.contact_phone) rows.push({ icon: Phone, label: lead.contact_phone, href: `tel:${lead.contact_phone}` });
    if (lead.contact_email) rows.push({ icon: Mail, label: lead.contact_email, href: `mailto:${lead.contact_email}` });
    if (lead.event_date) rows.push({ icon: Calendar, label: formatLongDate(lead.event_date), to: createPageUrl(`CalendarView?date=${lead.event_date}`) });
    if (lead.location) rows.push({ icon: MapPin, label: lead.location, href: `https://maps.google.com/?q=${encodeURIComponent(lead.location)}` });
    if (lead.document_id) rows.push({ icon: FileText, label: quoteDoc ? `Quote ${quoteDoc.document_number} · ${formatMoney(quoteDoc.total, quoteDoc.currency)}` : "View quote", to: createPageUrl(`DocumentDetail?id=${lead.document_id}&type=estimate`) });
    if (lead.work_event_id) rows.push({ icon: CalendarRange, label: "Booked event", to: createPageUrl(`WorkEventDetail?id=${lead.work_event_id}`) });
    return rows;
  }, [lead, quoteDoc]);

  if (loading) return <div className="p-4 text-sm text-gray-500 text-center py-16">Loading…</div>;
  if (!lead) {
    return (
      <div className="p-4 text-center py-16">
        <p className="text-base font-semibold text-white">Lead not found</p>
        <Link to={createPageUrl("Leads")} className="text-ink text-sm mt-3 inline-block">Back to leads</Link>
      </div>
    );
  }

  const isOpen = ["new", "contacted"].includes(lead.status);
  const isClosed = ["declined", "lost"].includes(lead.status);

  return (
    <div className="p-4 max-w-xl mx-auto pb-24">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-gray-800/80 to-gray-900 border border-gray-700/60 overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-2xl font-bold text-white">{lead.contact_name}</p>
              <p className="text-sm text-gray-400 mt-1">
                {[pkg?.name, lead.event_type].filter(Boolean).join(" · ") || "Enquiry"}
                {pkg?.price != null && (
                  <span className="text-gray-300 font-semibold"> · {currencySymbol(pkg.currency)}{Number(pkg.price).toLocaleString()}</span>
                )}
              </p>
            </div>
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border flex-shrink-0 ${STATUS_PILL[lead.status] || ""}`}>
              {STATUS_LABELS[lead.status] || lead.status}
            </span>
          </div>
        </div>
        {heroRows.length > 0 && (
          <div className="border-t border-gray-700/40 divide-y divide-gray-800/60">
            {heroRows.map((row, idx) => {
              const Icon = row.icon;
              const content = (
                <div className="flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors">
                  <Icon className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  <span className="text-sm text-white truncate">{row.label}</span>
                </div>
              );
              return row.to ? (
                <Link key={idx} to={row.to}>{content}</Link>
              ) : (
                <a key={idx} href={row.href} target={row.href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{content}</a>
              );
            })}
          </div>
        )}
      </div>

      {/* Prospect message */}
      {lead.message && (
        <div className="mt-4 rounded-2xl border border-gray-700/60 bg-gray-800/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-3.5 h-3.5 text-gray-500" />
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Their message</p>
          </div>
          <p className="text-sm text-gray-300 whitespace-pre-line">{lead.message}</p>
        </div>
      )}

      {/* Actions */}
      <div className="mt-5 space-y-3">
        {(isOpen || lead.status === "quoted") && (
          <button
            onClick={handleSendQuote}
            disabled={sendingQuote}
            className="w-full bg-ink hover:bg-ink/90 disabled:opacity-60 text-ink-fg font-semibold rounded-xl py-3 text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <Send className="w-4 h-4" />
            {sendingQuote ? "Working…" : lead.status === "quoted" ? "Send quote again" : "Send quote"}
          </button>
        )}

        <div className="flex items-center justify-center gap-5 flex-wrap">
          {isOpen && (
            <button onClick={handleEditQuoteFirst} disabled={sendingQuote} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 transition-colors">
              <Pencil className="w-3 h-3" /> Edit quote first
            </button>
          )}
          {lead.status === "quoted" && (
            <button onClick={copyQuoteLink} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 transition-colors">
              <Link2 className="w-3 h-3" /> Copy quote link
            </button>
          )}
          {lead.status === "new" && (
            <button onClick={() => setStatus("contacted")} className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
              Mark contacted
            </button>
          )}
          {(isOpen || lead.status === "quoted") && (
            <>
              <button onClick={() => setStatus("accepted")} className="text-green-500/80 hover:text-green-400 text-xs transition-colors">
                Mark won
              </button>
              <button onClick={() => setStatus("lost")} className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
                Mark lost
              </button>
            </>
          )}
          {isClosed && (
            <button onClick={() => setStatus("new")} className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
              Reopen
            </button>
          )}
        </div>
      </div>

      {/* Edit details (collapsed) */}
      <div className="mt-6">
        <button
          onClick={() => setEditOpen(!editOpen)}
          className="w-full flex items-center justify-between text-gray-500 hover:text-gray-300 text-xs uppercase tracking-wider font-semibold transition-colors"
        >
          Edit details
          <ChevronDown className={`w-4 h-4 transition-transform ${editOpen ? "rotate-180" : ""}`} />
        </button>
        {editOpen && (
          <div className="mt-3 space-y-3">
            <Field label="Name" value={lead.contact_name} onChange={(v) => patchLead({ contact_name: v })} />
            <Field label="Email" type="email" value={lead.contact_email} onChange={(v) => patchLead({ contact_email: v })} />
            <Field label="Phone" type="tel" value={lead.contact_phone} onChange={(v) => patchLead({ contact_phone: v })} />
            <Field label="Event date" type="date" value={lead.event_date || ""} onChange={(v) => patchLead({ event_date: v || null })} />
            <Field label="Event type" value={lead.event_type} onChange={(v) => patchLead({ event_type: v })} />
            <Field label="Location" value={lead.location} onChange={(v) => patchLead({ location: v })} />
          </div>
        )}
      </div>

      {/* Delete */}
      <div className="mt-10 text-center">
        {confirmDelete ? (
          <div className="flex items-center justify-center gap-4">
            <button onClick={handleDelete} className="text-red-400 text-xs font-semibold">Delete this lead</button>
            <button onClick={() => setConfirmDelete(false)} className="text-gray-500 text-xs">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-gray-600 hover:text-red-400 text-xs transition-colors">
            Delete lead
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">{label}</p>
      <input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-gray-400"
      />
    </div>
  );
}

function buildQuoteEmail({ lead, business, total, currency, quoteUrl }) {
  const firstName = (lead.contact_name || "").split(" ")[0];
  const symbol = { GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$" }[currency] || "";
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#111">
      <p>Hi ${firstName || "there"},</p>
      <p>Thanks for getting in touch${lead.event_date ? ` about your event on ${lead.event_date}` : ""}. Here is your quote from ${business}:</p>
      <p style="font-size:22px;font-weight:bold;margin:18px 0">${symbol}${Number(total || 0).toLocaleString("en-GB", { minimumFractionDigits: 2 })}</p>
      <p><a href="${quoteUrl}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">View and accept your quote</a></p>
      <p style="color:#555;font-size:13px">You can review the details and accept online. If you have any questions, just reply to this email.</p>
      <p>${business}</p>
    </div>
  `;
}

function formatLongDate(value) {
  try {
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  } catch {
    return value;
  }
}
