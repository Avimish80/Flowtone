import { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { useNavigate } from "react-router-dom";
import { createPageUrl, currencySymbol } from "@/utils";
import { useGoBack } from "@/hooks/useGoBack";
import {
  ArrowLeft, Save, Trash2, Plus, X, AlertTriangle, Send, CheckCircle2,
  XCircle, Clock, CalendarDays, Loader2, ExternalLink, ChevronDown,
  Lock, Unlock, ArrowRightLeft, Printer, Mail,
} from "lucide-react";
import { format, addDays, parseISO } from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { printInvoice, buildMailtoLink } from "@/lib/invoiceTemplates";
import { isGmailConnected, getGmailEmail, sendGmailEmail } from "@/lib/gmailClient";

const CURRENCIES = ["GBP", "USD", "EUR", "AUD", "CAD"];
const CLIENT_TYPES = ["venue", "agent", "student", "band", "other"];

export default function DocumentDetail() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const typeParam = params.get("type") || "invoice";
  const navigate = useNavigate();

  const defaultDueDate = format(addDays(new Date(), 30), "yyyy-MM-dd");

  const emptyDoc = {
    document_type: typeParam,
    document_number: "",
    title: "",
    client_id: "",
    client_email: "",
    status: "draft",
    currency: "GBP",
    line_items: [],
    subtotal: 0,
    total: 0,
    discount_type: null,
    discount_value: 0,
    discount_amount: 0,
    tax_rate: 0,
    tax_amount: 0,
    notes: "",
    due_date: typeParam === "invoice" ? defaultDueDate : "",
    valid_until: "",
    payment_terms_days: 30,
    work_event_id: "",
    is_standalone: false,
    is_locked: false,
    paid_amount: 0,
    paid_date: "",
    payment_method: "",
    converted_from_id: "",
  };

  const [doc, setDoc] = useState(emptyDoc);
  const [clients, setClients] = useState([]);
  const [linkedEvent, setLinkedEvent] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newItem, setNewItem] = useState({ description: "", quantity: 1, unit_price: "" });
  const [editingItem, setEditingItem] = useState(null); // idx of line item being edited inline
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [saveError, setSaveError] = useState("");
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const [quickSending, setQuickSending] = useState(false);
  const [quickSent, setQuickSent] = useState(false);
  const [linkingType, setLinkingType] = useState(null);
  const [showDetails, setShowDetails] = useState(false); // "event" | "client" | null — for new invoice tile picker

  // Available events for new invoice
  const [availableEvents, setAvailableEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Quick-create modals
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ name: "", client_type: "venue", email: "" });
  const [newEventForm, setNewEventForm] = useState({ title: "", date: "", client_id: "", base_price: "" });
  const [creatingClient, setCreatingClient] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [clientModalContext, setClientModalContext] = useState("invoice");
  const [bizProfile, setBizProfile] = useState(null);
  const [appSettings, setAppSettings] = useState(null);
  const [gmailConnected, setGmailConnected] = useState(false);

  const isInvoice = doc.document_type === "invoice";
  const isEstimate = doc.document_type === "estimate";
  const typeLabel = isInvoice ? "Invoice" : "Estimate";
  const listPage = "Finance";
  const isNew = !id;
  const goBack = useGoBack(listPage);

  const clientMap = useMemo(() => Object.fromEntries(clients.map(c => [c.id, c])), [clients]);

  // Load business profile + settings (for invoice templates)
  useEffect(() => {
    Promise.all([
      appClient.entities.BusinessProfile.list(),
      appClient.entities.AppSettings.list(),
    ]).then(([profiles, settingsArr]) => {
      setBizProfile(profiles[0] || null);
      setAppSettings(settingsArr[0] || null);
      setGmailConnected(isGmailConnected());
    }).catch(() => {});
  }, []);

  // Load data
  useEffect(() => {
    const promises = [appClient.entities.Client.list()];
    if (id) promises.push(appClient.entities.Document.filter({ id }));

    Promise.all(promises).then(async ([cls, docs]) => {
      setClients(cls);
      if (docs?.[0]) {
        const d = docs[0];
        setDoc(d);
        setEmailTo(d.client_email || "");

        if (d.work_event_id) {
          try {
            const evts = await appClient.entities.WorkEvent.filter({ id: d.work_event_id });
            if (evts?.[0]) {
              const evt = evts[0];
              setLinkedEvent(evt);

              // Auto-sync prices from event to draft invoices
              if (d.document_type === "invoice" && d.status === "draft" && !d.is_locked) {
                const eventFee = evt.total_price || evt.base_price || 0;
                const currentFee = d.line_items?.[0]?.unit_price || 0;
                // Only sync if event fee changed and there's a single event-derived line item
                if (eventFee !== currentFee && d.line_items?.length <= 1) {
                  const lineItems = eventFee > 0
                    ? [{ description: evt.event_type || "Performance", quantity: 1, unit_price: eventFee, total: eventFee }]
                    : [];
                  const subtotal = lineItems.reduce((s, i) => s + (i.total || 0), 0);
                  const discType = d.discount_type;
                  const discVal = d.discount_value || 0;
                  const taxRate = d.tax_rate || 0;
                  let discountAmount = 0;
                  if (discType === "percentage" && discVal) discountAmount = subtotal * (discVal / 100);
                  else if (discType === "fixed" && discVal) discountAmount = discVal;
                  const afterDisc = subtotal - discountAmount;
                  const taxAmount = afterDisc * (taxRate / 100);
                  const total = afterDisc + taxAmount;

                  const syncUpdates = {
                    line_items: lineItems,
                    subtotal: Math.round(subtotal * 100) / 100,
                    discount_amount: Math.round(discountAmount * 100) / 100,
                    tax_amount: Math.round(taxAmount * 100) / 100,
                    total: Math.round(total * 100) / 100,
                  };
                  setDoc(prev => ({ ...prev, ...syncUpdates }));
                  // Persist the sync
                  await appClient.entities.Document.update(d.id, syncUpdates);
                }
              }
            }
          } catch (err) {
            console.error("Failed to load linked event:", err);
          }
        }

        if (d.document_type === "invoice") {
          try {
            const pays = await appClient.entities.Payment.filter({ document_id: d.id });
            setPayments(pays);
          } catch (err) {
            console.error("Failed to load payments:", err);
          }
        }
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  // Load available events for linking (all invoice pages)
  useEffect(() => {
    if (!isInvoice) return;
    setLoadingEvents(true);
    appClient.entities.WorkEvent.list("-date").then(events => {
      setAvailableEvents(events);
      setLoadingEvents(false);
    }).catch(() => setLoadingEvents(false));
  }, [isInvoice]);

  const clientName = useMemo(() => {
    const cid = linkedEvent?.client_id || doc.client_id;
    if (!cid) return "";
    return clientMap[cid]?.name || "";
  }, [doc.client_id, linkedEvent, clientMap]);

  const onChange = (field, value) => {
    setDoc(prev => ({ ...prev, [field]: value }));
    setSaveError("");
  };

  // ─── Event Selection ────────────────────────────────────────────
  const handleSelectEvent = (eventId, directEvent) => {
    if (!eventId) {
      setLinkedEvent(null);
      setDoc(prev => ({ ...prev, work_event_id: "", client_id: "", is_standalone: true }));
      return;
    }
    const evt = directEvent || availableEvents.find(e => e.id === eventId);
    if (!evt) return;
    setLinkedEvent(evt);

    const fee = evt.total_price || evt.base_price || 0;
    const lineItems = fee > 0
      ? [{ description: evt.event_type || "Performance", quantity: 1, unit_price: fee, total: fee }]
      : [];
    const totals = recalcTotals(lineItems, doc.discount_type, doc.discount_value, doc.tax_rate);

    setDoc(prev => ({
      ...prev,
      work_event_id: evt.id,
      client_id: evt.client_id || "",
      currency: evt.currency || prev.currency,
      title: evt.title || prev.title,
      is_standalone: false,
      line_items: lineItems,
      ...totals,
    }));

    if (evt.client_id) {
      const client = clients.find(c => c.id === evt.client_id);
      if (client?.emails?.[0]) setEmailTo(client.emails[0]);
    }
  };

  const handleEventDropdownChange = (value) => {
    if (value === "__new_event__") {
      setNewEventForm({ title: "", date: "", client_id: "", base_price: "" });
      setShowCreateEvent(true);
      return;
    }
    handleSelectEvent(value);
  };

  const handleClientDropdownChange = (value, context = "invoice") => {
    if (value === "__new_client__") {
      setClientModalContext(context);
      setNewClientForm({ name: "", client_type: "venue", email: "" });
      setShowCreateClient(true);
      return;
    }
    if (context === "event-modal") {
      setNewEventForm(prev => ({ ...prev, client_id: value }));
    } else {
      const c = clients.find(c => c.id === value);
      setDoc(prev => ({ ...prev, client_id: value }));
      if (c?.emails?.[0]) setEmailTo(c.emails[0]);
    }
  };

  // ─── Quick-Create Handlers ─────────────────────────────────────
  const handleCreateClient = async () => {
    if (!newClientForm.name.trim()) return;
    setCreatingClient(true);
    try {
      const created = await appClient.entities.Client.create({
        name: newClientForm.name.trim(),
        client_type: newClientForm.client_type,
        emails: newClientForm.email.trim() ? [newClientForm.email.trim()] : [],
        phones: [],
        default_currency: "GBP",
        default_payment_terms_days: 30,
      });
      setClients(prev => [...prev, created]);

      if (clientModalContext === "invoice") {
        setDoc(prev => ({ ...prev, client_id: created.id }));
        if (created.emails?.[0]) setEmailTo(created.emails[0]);
      } else if (clientModalContext === "event-modal") {
        setNewEventForm(prev => ({ ...prev, client_id: created.id }));
      }

      setShowCreateClient(false);
    } catch (err) {
      console.error("Create client error:", err);
    }
    setCreatingClient(false);
  };

  const handleCreateEvent = async () => {
    if (!newEventForm.title.trim()) return;
    setCreatingEvent(true);
    try {
      const fee = parseFloat(newEventForm.base_price) || 0;
      const eventData = {
        title: newEventForm.title.trim(),
        date: newEventForm.date || "",
        client_id: newEventForm.client_id || "",
        event_type: "Gig",
        status: "lead",
        currency: doc.currency || "GBP",
        base_price: fee,
        total_price: fee,
      };
      const created = await appClient.entities.WorkEvent.create(eventData);

      // Auto-create estimate (mirroring WorkEventDetail behavior)
      const estNumber = await appClient.helpers.getNextDocumentNumber("estimate");
      await appClient.entities.Document.create({
        document_type: "estimate",
        document_number: estNumber,
        title: created.title,
        client_id: created.client_id || "",
        work_event_id: created.id,
        status: "draft",
        currency: eventData.currency,
        line_items: fee > 0
          ? [{ description: "Performance", quantity: 1, unit_price: fee, total: fee }]
          : [],
        subtotal: fee,
        total: fee,
      });

      setAvailableEvents(prev => [created, ...prev]);
      handleSelectEvent(created.id, created);

      setShowCreateEvent(false);
    } catch (err) {
      console.error("Create event error:", err);
    }
    setCreatingEvent(false);
  };

  // ─── Line Items ──────────────────────────────────────────────────
  const recalcTotals = (items, discType, discVal, taxRate) => {
    const subtotal = items.reduce((s, i) => s + ((i.quantity || 0) * (i.unit_price || 0)), 0);
    let discountAmount = 0;
    if (discType === "percentage" && discVal) {
      discountAmount = subtotal * (Number(discVal) / 100);
    } else if (discType === "fixed" && discVal) {
      discountAmount = Number(discVal);
    }
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = afterDiscount * ((Number(taxRate) || 0) / 100);
    const total = afterDiscount + taxAmount;
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      discount_amount: Math.round(discountAmount * 100) / 100,
      tax_amount: Math.round(taxAmount * 100) / 100,
      total: Math.round(total * 100) / 100,
    };
  };

  const addLineItem = () => {
    if (!newItem.description) return;
    const price = parseFloat(newItem.unit_price) || 0;
    const qty = newItem.quantity || 1;
    const item = { description: newItem.description, quantity: qty, unit_price: price, total: qty * price };
    const updated = [...(doc.line_items || []), item];
    const totals = recalcTotals(updated, doc.discount_type, doc.discount_value, doc.tax_rate);
    setDoc(prev => ({ ...prev, line_items: updated, ...totals }));
    setNewItem({ description: "", quantity: 1, unit_price: "" });
  };

  const removeLineItem = (idx) => {
    const updated = (doc.line_items || []).filter((_, i) => i !== idx);
    const totals = recalcTotals(updated, doc.discount_type, doc.discount_value, doc.tax_rate);
    setDoc(prev => ({ ...prev, line_items: updated, ...totals }));
    if (editingItem === idx) setEditingItem(null);
  };

  const updateLineItem = (idx, field, value) => {
    const updated = (doc.line_items || []).map((item, i) => {
      if (i !== idx) return item;
      const next = { ...item, [field]: field === "description" ? value : (parseFloat(value) || 0) };
      next.total = (next.quantity || 1) * (next.unit_price || 0);
      return next;
    });
    const totals = recalcTotals(updated, doc.discount_type, doc.discount_value, doc.tax_rate);
    setDoc(prev => ({ ...prev, line_items: updated, ...totals }));
  };

  const updateDiscountOrTax = (field, value) => {
    const next = { ...doc, [field]: value };
    const totals = recalcTotals(next.line_items || [], next.discount_type, next.discount_value, next.tax_rate);
    setDoc(prev => ({ ...prev, [field]: value, ...totals }));
  };

  // ─── Save ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!doc.title?.trim()) {
      setSaveError(`${typeLabel} title is required`);
      return;
    }
    if (doc.is_locked) {
      setSaveError(`This ${typeLabel.toLowerCase()} is locked. Unlock it first to make changes.`);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      let dataToSave = { ...doc };

      // Auto-set standalone flag
      if (isInvoice && !dataToSave.work_event_id) {
        dataToSave.is_standalone = true;
      }

      // Auto-fill client email from client record
      if (dataToSave.client_id && !dataToSave.client_email) {
        const client = clientMap[dataToSave.client_id];
        if (client?.emails?.[0]) {
          dataToSave.client_email = client.emails[0];
        }
      }

      if (id) {
        await appClient.entities.Document.update(id, dataToSave);
      } else {
        const docNumber = await appClient.helpers.getNextDocumentNumber(dataToSave.document_type);
        dataToSave.document_number = docNumber;

        const created = await appClient.entities.Document.create(dataToSave);
        await appClient.helpers.logDocumentActivity(created.id, "created", null, "draft");

        navigate(createPageUrl(`DocumentDetail?id=${created.id}`));
        return;
      }
    } catch (err) {
      setSaveError("Failed to save: " + (err.message || "Unknown error"));
      console.error("Save error:", err);
    }
    setSaving(false);
  };

  // ─── Status Actions ──────────────────────────────────────────────
  const handleMarkSent = async () => {
    const updates = {
      status: "sent",
      sent_date: new Date().toISOString(),
      is_locked: true,
      locked_at: new Date().toISOString(),
    };
    if (doc.client_id && !doc.client_email) {
      const client = clientMap[doc.client_id];
      if (client?.emails?.[0]) updates.client_email = client.emails[0];
    }
    setDoc(prev => ({ ...prev, ...updates }));
    try {
      if (id) {
        await appClient.entities.Document.update(id, updates);
        await appClient.helpers.logDocumentActivity(id, "sent", doc.status, "sent");
      }
    } catch (err) {
      console.error("Update error:", err);
    }
  };

  const handleMarkPaid = async () => {
    const today = format(new Date(), "yyyy-MM-dd");
    const updates = { status: "paid", paid_date: today, paid_amount: doc.total || doc.subtotal || 0 };
    setDoc(prev => ({ ...prev, ...updates }));
    try {
      if (id) {
        await appClient.helpers.recordPayment({
          document_id: id,
          amount: doc.total || doc.subtotal || 0,
          payment_date: today,
          payment_method: "",
          notes: "Marked as paid",
        });
        const pays = await appClient.entities.Payment.filter({ document_id: id });
        setPayments(pays);
        const docs = await appClient.entities.Document.filter({ id });
        if (docs[0]) setDoc(docs[0]);
      }
    } catch (err) {
      console.error("Update error:", err);
    }
  };

  const handleMarkCancelled = async () => {
    const updates = { status: "cancelled" };
    setDoc(prev => ({ ...prev, ...updates }));
    try {
      if (id) {
        await appClient.entities.Document.update(id, updates);
        await appClient.helpers.logDocumentActivity(id, "cancelled", doc.status, "cancelled");
      }
    } catch (err) {
      console.error("Update error:", err);
    }
  };

  const handleMarkUnpaid = async () => {
    const updates = { status: "sent", paid_date: "", paid_amount: 0 };
    setDoc(prev => ({ ...prev, ...updates }));
    try {
      if (id) {
        await appClient.entities.Document.update(id, updates);
        await appClient.helpers.logDocumentActivity(id, "reopened", "paid", "sent");
      }
    } catch (err) {
      console.error("Update error:", err);
    }
  };

  const handleReopenDraft = async () => {
    const updates = { status: "draft", is_locked: false };
    setDoc(prev => ({ ...prev, ...updates }));
    try {
      if (id) {
        await appClient.entities.Document.update(id, updates);
        await appClient.helpers.logDocumentActivity(id, "reopened", doc.status, "draft");
      }
    } catch (err) {
      console.error("Update error:", err);
    }
  };

  // ─── Estimate Status Actions ─────────────────────────────────────
  const handleMarkAccepted = async () => {
    const updates = { status: "accepted", accepted_date: new Date().toISOString() };
    setDoc(prev => ({ ...prev, ...updates }));
    try {
      if (id) {
        await appClient.entities.Document.update(id, updates);
        await appClient.helpers.logDocumentActivity(id, "accepted", doc.status, "accepted");
      }
    } catch (err) {
      console.error("Update error:", err);
    }
  };

  const handleMarkRejected = async () => {
    const updates = { status: "rejected" };
    setDoc(prev => ({ ...prev, ...updates }));
    try {
      if (id) {
        await appClient.entities.Document.update(id, updates);
        await appClient.helpers.logDocumentActivity(id, "rejected", doc.status, "rejected");
      }
    } catch (err) {
      console.error("Update error:", err);
    }
  };

  const handleConvertToInvoice = async () => {
    try {
      const invoice = await appClient.helpers.convertEstimateToInvoice(id);
      navigate(createPageUrl(`DocumentDetail?id=${invoice.id}`));
    } catch (err) {
      setSaveError("Failed to convert: " + (err.message || "Unknown error"));
    }
  };

  // ─── Locking ─────────────────────────────────────────────────────
  const handleUnlock = async () => {
    try {
      await appClient.helpers.unlockDocument(id, unlockReason);
      setDoc(prev => ({ ...prev, is_locked: false }));
      setShowUnlockDialog(false);
      setUnlockReason("");
    } catch (err) {
      console.error("Unlock error:", err);
    }
  };

  // ─── Delete ──────────────────────────────────────────────────────
  const handleDelete = async () => {
    try {
      await appClient.entities.Document.delete(id);
      navigate(createPageUrl(listPage));
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  // ─── PDF ─────────────────────────────────────────────────────────
  const handleDownloadPdf = async () => {
    setGeneratingPdf(true);
    try {
      const res = await appClient.functions.invoke("generateAndSendInvoice", { document_id: id, send_email: false });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.document_type}-${doc.document_number || id}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error("PDF generation error:", err);
      setSaveError("Failed to generate PDF");
    }
    setGeneratingPdf(false);
  };

  // ─── Email ───────────────────────────────────────────────────────
  function buildInvoiceHtml(doc, profile) {
    const cs = currencySymbol(doc.currency);
    const items = (doc.line_items || []).map(item =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${item.description}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${item.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${cs}${(item.unit_price || 0).toFixed(2)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${cs}${((item.quantity || 1) * (item.unit_price || 0)).toFixed(2)}</td>
      </tr>`
    ).join('');

    return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#4f46e5">${profile?.business_name || 'Invoice'}</h2>
  <p><strong>${doc.document_type === 'invoice' ? 'Invoice' : 'Estimate'} #${doc.document_number || ''}</strong></p>
  ${doc.due_date ? `<p>Due: ${format(parseISO(doc.due_date), 'd MMM yyyy')}</p>` : ''}
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <thead><tr style="background:#f5f5f5">
      <th style="padding:8px;text-align:left">Description</th>
      <th style="padding:8px;text-align:right">Qty</th>
      <th style="padding:8px;text-align:right">Unit</th>
      <th style="padding:8px;text-align:right">Total</th>
    </tr></thead>
    <tbody>${items}</tbody>
  </table>
  <p style="text-align:right"><strong>Total: ${cs}${(doc.total || doc.subtotal || 0).toFixed(2)}</strong></p>
  ${doc.notes ? `<p style="color:#666;font-size:14px">${doc.notes}</p>` : ''}
  ${profile?.payment_instructions ? `<p style="color:#666;font-size:13px">${profile.payment_instructions}</p>` : ''}
</body></html>`;
  }

  const handleSendEmail = async () => {
    if (!emailTo?.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo.trim())) {
      setSaveError("Please enter a valid email address");
      return;
    }
    setSendingEmail(true);
    setShowEmailDialog(false);
    try {
      if (gmailConnected) {
        // Send via Gmail API
        const profile = await appClient.entities.BusinessProfile.list().then(d => d[0] || {});
        const settings = await appClient.entities.AppSettings.list().then(d => d[0] || {});
        const subject = `${typeLabel} #${doc.document_number || ''} from ${profile?.business_name || 'us'}`;
        const htmlBody = buildInvoiceHtml(doc, profile, settings);
        await sendGmailEmail({ to: emailTo.trim(), subject, htmlBody });
        // Update status to 'sent' if still draft
        if (doc.status === 'draft' && id) {
          await appClient.entities.Document.update(id, { status: 'sent', client_email: emailTo.trim() });
          setDoc(prev => ({ ...prev, status: 'sent', client_email: emailTo.trim() }));
        }
      } else {
        // Fallback: open mailto
        const profile = await appClient.entities.BusinessProfile.list().then(d => d[0] || {});
        const settings = await appClient.entities.AppSettings.list().then(d => d[0] || {});
        const link = buildMailtoLink(doc, profile, settings, emailTo.trim());
        window.open(link, '_blank');
      }
      if (emailTo.trim() !== doc.client_email && id) {
        await appClient.entities.Document.update(id, { client_email: emailTo.trim() });
        setDoc(prev => ({ ...prev, client_email: emailTo.trim() }));
      }
    } catch (err) {
      setSaveError(`Failed to send email: ${err.message}`);
    }
    setSendingEmail(false);
  };

  // Quick-send: one-tap send for draft invoices with a client email
  const quickSendEmail = useMemo(() => {
    const cid = linkedEvent?.client_id || doc.client_id;
    const client = cid ? clientMap[cid] : null;
    return client?.emails?.[0] || doc.client_email || "";
  }, [doc.client_id, doc.client_email, linkedEvent, clientMap]);

  const handleQuickSend = async () => {
    if (!quickSendEmail || !gmailConnected) return;
    setQuickSending(true);
    setSaveError("");
    try {
      // Save first if unsaved
      if (id) {
        const profile = bizProfile || {};
        const subject = `Invoice #${doc.document_number || ''} from ${profile?.business_name || 'us'}`;
        const htmlBody = buildInvoiceHtml(doc, profile, appSettings);
        await sendGmailEmail({ to: quickSendEmail, subject, htmlBody });
        await appClient.entities.Document.update(id, { status: 'sent', client_email: quickSendEmail });
        setDoc(prev => ({ ...prev, status: 'sent', client_email: quickSendEmail }));
        setQuickSent(true);
      }
    } catch (err) {
      setSaveError(`Failed to send: ${err.message}`);
    }
    setQuickSending(false);
  };

  const sym = currencySymbol(doc.currency);

  // Normalize a stored date string to yyyy-MM-dd for <input type="date">
  const safeDateValue = (v) => {
    if (!v) return "";
    try {
      const d = new Date(v);
      const year = d.getFullYear();
      if (isNaN(d.getTime()) || year < 1970 || year > 2100) return "";
      return format(d, "yyyy-MM-dd");
    } catch { return ""; }
  };

  // Save then navigate back
  const handleGoBack = async () => {
    if (id && doc.title?.trim() && !doc.is_locked) {
      try { await appClient.entities.Document.update(id, doc); } catch {}
    }
    goBack();
  };

  const statusIsOverdue = doc.status === "sent" && doc.due_date && new Date(doc.due_date) < new Date();
  const statusLabel = statusIsOverdue ? "Overdue" : doc.status;
  const statusPillClass = statusIsOverdue
    ? "bg-red-950/60 border-red-700/40 text-red-300"
    : doc.status === "paid" ? "bg-green-950/40 border-green-700/30 text-green-400"
    : doc.status === "sent" ? "bg-blue-950/40 border-blue-700/30 text-blue-400"
    : doc.status === "cancelled" || doc.status === "void" ? "bg-gray-800 border-gray-700 text-gray-500"
    : "bg-gray-800/60 border-gray-700/40 text-gray-500"; // draft
  // Enrich doc with client_name for templates
  const docForPrint = useMemo(() => ({
    ...doc,
    client_name: clientName || doc.client_name || "",
  }), [doc, clientName]);

  if (loading) return <div className="p-4 text-gray-400">Loading...</div>;

  // ─── Client dropdown helper ──────────────────────────────────────
  const renderClientSelect = (value, onChangeFn, disabled = false, context = "invoice") => (
    <select
      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
      value={value || ""}
      onChange={e => {
        const v = e.target.value;
        if (v === "__new_client__") {
          e.target.value = value || ""; // reset visual
          handleClientDropdownChange("__new_client__", context);
        } else if (onChangeFn) {
          onChangeFn(v);
        } else {
          handleClientDropdownChange(v, context);
        }
      }}
      disabled={disabled}
    >
      <option value="">No client</option>
      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      <option value="__new_client__">+ Add New Client</option>
    </select>
  );

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 sticky top-0 z-20 border-b border-gray-800">
        <button onClick={handleGoBack} className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5">
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm text-gray-500">{typeLabel}</span>
          {doc.is_locked && <Lock className="w-3.5 h-3.5 text-yellow-500" />}
        </button>
        <div className="flex-1 flex justify-center">
          {id && isInvoice && (
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border capitalize ${statusPillClass}`}>
              {statusLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {id && (
            <>
              <button
                onClick={() => {
                  const templateId = appSettings?.invoice_template || 1;
                  printInvoice(docForPrint, bizProfile, appSettings, templateId);
                }}
                title="Print / Save as PDF"
                className="bg-gray-700 hover:bg-gray-600 text-white p-1.5 rounded-lg transition-colors"
              >
                <Printer className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  const cid = linkedEvent?.client_id || doc.client_id;
                  const client = cid ? clientMap[cid] : null;
                  setEmailTo(client?.emails?.[0] || doc.client_email || "");
                  setShowEmailDialog(true);
                }}
                title="Send by email"
                className="bg-gray-700 hover:bg-gray-600 text-white p-1.5 rounded-lg transition-colors"
              >
                <Mail className="w-4 h-4" />
              </button>
            </>
          )}
          <button onClick={handleSave} disabled={saving || doc.is_locked} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors">
            <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Error */}
        {saveError && (
          <div className="bg-red-950/50 border border-red-700/40 rounded-xl px-4 py-3 text-sm text-red-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {saveError}
            <button onClick={() => setSaveError("")} className="ml-auto text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Lock Banner */}
        {doc.is_locked && id && (
          <div className="bg-yellow-950/50 border border-yellow-700/40 rounded-xl px-4 py-3 flex items-center gap-3">
            <Lock className="w-4 h-4 text-yellow-400 flex-shrink-0" />
            <span className="text-sm text-yellow-300 flex-1">
              This {typeLabel.toLowerCase()} is locked. Unlock to make changes.
            </span>
            <button
              onClick={() => setShowUnlockDialog(true)}
              className="bg-yellow-700/60 hover:bg-yellow-600/60 text-yellow-200 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Unlock className="w-3.5 h-3.5" /> Unlock
            </button>
          </div>
        )}

        {/* Quick Send Banner — for draft invoices ready to send */}
        {id && isInvoice && doc.status === "draft" && quickSendEmail && !quickSent && doc.total > 0 && (
          <div className="bg-indigo-950/50 border border-indigo-700/40 rounded-xl px-4 py-3 flex items-center gap-3">
            <Send className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-indigo-200">
                Ready to send · {sym}{(doc.total || 0).toFixed(2)}
              </p>
              <p className="text-xs text-indigo-400/70 truncate">
                {gmailConnected ? `via Gmail to ${quickSendEmail}` : `to ${quickSendEmail}`}
              </p>
            </div>
            {gmailConnected ? (
              <button
                onClick={handleQuickSend}
                disabled={quickSending}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-colors"
              >
                {quickSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {quickSending ? "Sending…" : "Send Now"}
              </button>
            ) : (
              <button
                onClick={() => {
                  setEmailTo(quickSendEmail);
                  setShowEmailDialog(true);
                }}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Mail className="w-4 h-4" /> Send
              </button>
            )}
          </div>
        )}

        {/* Quick Sent Success */}
        {quickSent && (
          <div className="bg-green-950/50 border border-green-700/40 rounded-xl px-4 py-3 flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
            <p className="text-sm font-medium text-green-300">
              Invoice sent to {quickSendEmail}
            </p>
          </div>
        )}

        {/* Unlock Dialog */}
        {showUnlockDialog && (
          <div className="bg-gray-800 border border-yellow-700/40 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-white">Unlock {typeLabel} for Editing</p>
            <p className="text-xs text-gray-400">Please provide a reason for unlocking (for audit trail).</p>
            <input
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-yellow-500"
              placeholder="e.g. Client requested changes"
              value={unlockReason}
              onChange={e => setUnlockReason(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={handleUnlock} className="flex-1 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg py-2 text-sm font-medium transition-colors">Unlock</button>
              <button onClick={() => setShowUnlockDialog(false)} className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-4 py-2 text-sm transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {/* Email Dialog */}
        {showEmailDialog && (
          <div className="bg-gray-800 border border-indigo-700/40 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-white">Send {typeLabel} by Email</p>
            <p className="text-xs text-gray-400">
              {gmailConnected
                ? `Sending from ${getGmailEmail()}. The ${typeLabel.toLowerCase()} will be delivered directly.`
                : "Gmail not connected — we'll open your email app with a pre-filled message instead."}
            </p>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Recipient Email</label>
              <input
                type="email"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
                placeholder="client@example.com"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const templateId = appSettings?.invoice_template || 1;
                  // First open print dialog
                  printInvoice(docForPrint, bizProfile, appSettings, templateId);
                  // Then open email client
                  setTimeout(() => {
                    window.location.href = buildMailtoLink(docForPrint, bizProfile, appSettings, emailTo.trim());
                  }, 600);
                  setShowEmailDialog(false);
                }}
                disabled={!emailTo?.trim()}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <Mail className="w-4 h-4" /> Open Print + Email
              </button>
              <button onClick={() => setShowEmailDialog(false)} className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-4 py-2 text-sm transition-colors">Cancel</button>
            </div>
          </div>
        )}


        {/* ─── Estimate Status Actions ────────────────────────────── */}
        {id && isEstimate && (
          <div className="space-y-2 border border-gray-700 rounded-xl p-3 bg-gray-800/40">
            <div className={`rounded-xl px-3 py-2.5 flex items-center gap-2 text-sm
              ${doc.status === "accepted" ? "bg-green-950/50 border border-green-700/40 text-green-300" :
                doc.status === "rejected" ? "bg-red-950/50 border border-red-700/40 text-red-300" :
                doc.status === "converted" ? "bg-indigo-950/50 border border-indigo-700/40 text-indigo-300" :
                doc.status === "sent" ? "bg-blue-950/50 border border-blue-700/40 text-blue-300" :
                "bg-gray-800/50 border border-gray-700/40 text-gray-400"}`}>
              {doc.status === "accepted" && <CheckCircle2 className="w-4 h-4" />}
              {doc.status === "rejected" && <XCircle className="w-4 h-4" />}
              {doc.status === "converted" && <ArrowRightLeft className="w-4 h-4" />}
              {doc.status === "sent" && <Send className="w-4 h-4" />}
              <span className="capitalize font-medium">{doc.status}</span>
              {doc.document_number && (
                <span className="ml-auto text-xs opacity-60">#{doc.document_number}</span>
              )}
            </div>

            <div className="flex gap-2 flex-wrap">
              {doc.status === "draft" && (
                <button onClick={handleMarkSent} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors">
                  <Send className="w-4 h-4" /> Mark as Sent
                </button>
              )}
              {doc.status === "sent" && (
                <>
                  <button onClick={handleMarkAccepted} className="flex-1 bg-green-600 hover:bg-green-500 text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors">
                    <CheckCircle2 className="w-4 h-4" /> Accepted
                  </button>
                  <button onClick={handleMarkRejected} className="flex-1 bg-red-700 hover:bg-red-600 text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors">
                    <XCircle className="w-4 h-4" /> Rejected
                  </button>
                </>
              )}
              {(doc.status === "accepted" || doc.status === "rejected") && doc.status !== "converted" && (
                <button onClick={handleConvertToInvoice} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors">
                  <ArrowRightLeft className="w-4 h-4" /> Convert to Invoice
                </button>
              )}
              {doc.status === "rejected" && (
                <button onClick={handleReopenDraft} className="bg-gray-700 hover:bg-gray-600 text-white rounded-xl py-2.5 px-4 text-sm font-medium flex items-center gap-2 transition-colors">
                  Reopen
                </button>
              )}
            </div>
          </div>
        )}



        {/* ─── ESTIMATE: Client + Valid Until ─────────────────────── */}
        {isEstimate && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Client</label>
              {renderClientSelect(doc.client_id, null, doc.is_locked, "invoice")}
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Valid Until</label>
              <input
                type="date"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={doc.valid_until || ""}
                onChange={e => onChange("valid_until", e.target.value)}
                disabled={doc.is_locked}
              />
            </div>
          </div>
        )}

        {/* ── Unified Invoice Card: Title · Items · Total ────────── */}
        <div className="rounded-2xl border border-gray-700/60 bg-gray-800/30 overflow-hidden">

          {/* Card Header: Title · Status · Date · Actions · Link */}
          <div className="px-4 pt-4 pb-3 border-b border-gray-700/40 space-y-2.5">

            {/* Row 1: Title + Due date on same line */}
            <div className="flex items-center gap-3">
              <input
                className="flex-1 min-w-0 bg-transparent text-white text-base font-semibold placeholder-gray-600 focus:outline-none"
                placeholder={isInvoice ? "Invoice title…" : "Estimate title…"}
                value={doc.title || ""}
                onChange={e => onChange("title", e.target.value)}
                disabled={doc.is_locked}
              />
              {isInvoice && doc.status === "paid" ? (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-xs text-green-600">Paid</span>
                  <input
                    type="date"
                    className="bg-gray-800/60 border border-green-800/40 rounded-lg px-2 py-1 text-green-400 text-xs focus:outline-none focus:border-green-600 transition-colors"
                    value={safeDateValue(doc.paid_date) || format(new Date(), "yyyy-MM-dd")}
                    onChange={e => onChange("paid_date", e.target.value)}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-xs text-gray-600">{isInvoice ? "Due" : "Until"}</span>
                  <input
                    type="date"
                    className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-2 py-1 text-gray-400 text-xs focus:outline-none focus:border-indigo-500 focus:text-white transition-colors"
                    value={safeDateValue(isInvoice ? doc.due_date : doc.valid_until)}
                    onChange={e => onChange(isInvoice ? "due_date" : "valid_until", e.target.value)}
                    disabled={doc.is_locked}
                  />
                </div>
              )}
            </div>

            {/* Row 2: Action buttons + status pill — all right-aligned */}
            {isInvoice && (
              <div className="flex items-center justify-end gap-2 flex-wrap">
                {!doc.is_locked && (
                  <>
                    {doc.status === "draft" && (
                      <button onClick={handleMarkSent}
                        className="text-xs bg-blue-600/15 text-blue-400 hover:bg-blue-600/30 border border-blue-700/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
                        <Send className="w-3 h-3" /> Mark sent
                      </button>
                    )}
                    {(doc.status === "sent" || doc.status === "draft") && (
                      <button onClick={handleMarkPaid}
                        className="text-xs bg-green-600/15 text-green-400 hover:bg-green-600/30 border border-green-700/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
                        <CheckCircle2 className="w-3 h-3" /> Mark paid
                      </button>
                    )}
                    {doc.status === "paid" && (
                      <button onClick={handleMarkUnpaid}
                        className="text-xs bg-gray-700/50 text-gray-400 hover:bg-gray-700 border border-gray-700/40 px-3 py-1.5 rounded-lg transition-colors">
                        Mark unpaid
                      </button>
                    )}
                    {doc.status !== "cancelled" && doc.status !== "void" && doc.status !== "paid" && (
                      <button onClick={handleMarkCancelled}
                        className="text-xs text-gray-600 hover:text-red-400 transition-colors">
                        Cancel
                      </button>
                    )}
                    {(doc.status === "cancelled" || doc.status === "void") && (
                      <button onClick={handleReopenDraft}
                        className="text-xs bg-gray-700/50 text-gray-400 hover:bg-gray-700 border border-gray-700/40 px-3 py-1.5 rounded-lg transition-colors">
                        Reopen as draft
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Event / Client link — or inline tile picker if neither is set */}
            {isInvoice && (
              linkedEvent ? (
                <span className="flex items-center gap-1">
                  <a
                    href={createPageUrl(`WorkEventDetail?id=${linkedEvent.id}`)}
                    className="flex items-center gap-1 text-xs text-indigo-400/60 hover:text-indigo-300 transition-colors"
                    onClick={e => e.stopPropagation()}
                  >
                    <ExternalLink className="w-3 h-3" />
                    {linkedEvent.title}
                    {linkedEvent.date && (
                      <span className="text-indigo-400/40">
                        {" · "}{(() => { try { return format(parseISO(linkedEvent.date), "d MMM"); } catch { return ""; } })()}
                      </span>
                    )}
                  </a>
                  {!doc.is_locked && (
                    <button onClick={e => { e.stopPropagation(); handleSelectEvent(""); }}
                      className="text-gray-600 hover:text-red-400 transition-colors ml-0.5" title="Unlink event">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ) : clientName ? (
                <span className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block" />
                  {clientName}
                  {!doc.is_locked && (
                    <button onClick={e => { e.stopPropagation(); onChange("client_id", ""); }}
                      className="text-gray-600 hover:text-red-400 transition-colors ml-0.5" title="Unlink client">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ) : !doc.is_locked && (
                linkingType === null ? (
                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    <button onClick={() => setLinkingType("event")}
                      className="rounded-xl p-3 text-left border bg-indigo-950/30 border-indigo-800/20 hover:bg-indigo-950/50 transition-all">
                      <CalendarDays className="w-3.5 h-3.5 text-indigo-400 mb-1.5" />
                      <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-0.5">Event</p>
                      <p className="text-[10px] text-indigo-300/60">
                        {loadingEvents ? "Loading…" : `${availableEvents.length} available`}
                      </p>
                    </button>
                    <button onClick={() => setLinkingType("client")}
                      className="rounded-xl p-3 text-left border bg-gray-800/60 border-gray-700/40 hover:bg-gray-700/50 transition-all">
                      <div className="w-3.5 h-3.5 mb-1.5 text-gray-400">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                        </svg>
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Client</p>
                      <p className="text-[10px] text-gray-600">{clients.length} contacts</p>
                    </button>
                  </div>
                ) : linkingType === "event" ? (
                  <div className="rounded-xl border border-indigo-800/30 bg-indigo-950/20 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2.5 border-b border-indigo-800/20">
                      <p className="text-sm font-medium text-indigo-300">Choose an event</p>
                      <button onClick={() => setLinkingType(null)} className="text-gray-500 hover:text-gray-300 transition-colors"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-indigo-900/30">
                      {availableEvents.map(evt => {
                        const evtClient = clientMap[evt.client_id]?.name || "";
                        const dateStr = evt.date ? (() => { try { return format(parseISO(evt.date), "d MMM"); } catch { return ""; } })() : "";
                        return (
                          <button key={evt.id} onClick={() => { handleSelectEvent(evt.id); setLinkingType(null); }}
                            className="w-full text-left px-3 py-2.5 hover:bg-indigo-900/30 transition-colors">
                            <p className="text-sm text-white">{evt.title}</p>
                            <p className="text-xs text-gray-500">{[dateStr, evtClient].filter(Boolean).join(" · ")}</p>
                          </button>
                        );
                      })}
                      <button onClick={() => { handleEventDropdownChange("__new_event__"); setLinkingType(null); }}
                        className="w-full text-left px-3 py-2.5 text-indigo-400 hover:bg-indigo-900/20 text-sm transition-colors flex items-center gap-2">
                        <Plus className="w-3.5 h-3.5" /> Create new event
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-gray-700/40 bg-gray-800/40 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-700/30">
                      <p className="text-sm font-medium text-white">Choose a client</p>
                      <button onClick={() => setLinkingType(null)} className="text-gray-500 hover:text-gray-300 transition-colors"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-gray-700/20">
                      {clients.map(c => (
                        <button key={c.id} onClick={() => { handleClientDropdownChange(c.id); setLinkingType(null); }}
                          className="w-full text-left px-3 py-2.5 hover:bg-gray-700/30 transition-colors">
                          <p className="text-sm text-white">{c.name}</p>
                          {c.client_type && <p className="text-xs text-gray-500 capitalize">{c.client_type}</p>}
                        </button>
                      ))}
                      <button onClick={() => { handleClientDropdownChange("__new_client__"); setLinkingType(null); }}
                        className="w-full text-left px-3 py-2.5 text-indigo-400 hover:bg-gray-700/20 text-sm transition-colors flex items-center gap-2">
                        <Plus className="w-3.5 h-3.5" /> Add new client
                      </button>
                    </div>
                  </div>
                )
              )
            )}
          </div>

          {/* Line items list */}
          <div className="divide-y divide-gray-700/30">
            {(doc.line_items || []).length === 0 && (
              <p className="px-4 py-4 text-sm text-gray-600 italic">No items yet — add one below</p>
            )}
            {(doc.line_items || []).map((item, idx) =>
              editingItem === idx ? (
                /* ─ Inline edit mode ─ */
                <div key={idx} className="flex items-center gap-2 px-4 py-3 bg-gray-800/70">
                  <input
                    autoFocus
                    className="flex-1 bg-gray-700/60 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 min-w-0"
                    value={item.description}
                    onChange={e => updateLineItem(idx, "description", e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") setEditingItem(null); }}
                  />
                  <div className="flex items-center bg-gray-700/60 rounded-lg px-2.5 py-1.5 gap-1 w-28 flex-shrink-0">
                    <span className="text-gray-400 text-sm">{sym}</span>
                    <input
                      type="number"
                      className="w-full bg-transparent text-white text-sm focus:outline-none"
                      value={item.unit_price}
                      onChange={e => updateLineItem(idx, "unit_price", e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") setEditingItem(null); }}
                    />
                  </div>
                  <button onClick={() => setEditingItem(null)}
                    className="text-indigo-400 hover:text-indigo-300 text-xs font-medium px-1 flex-shrink-0 transition-colors">
                    Done
                  </button>
                </div>
              ) : (
                /* ─ Display mode (tap to edit) ─ */
                <div key={idx}
                  className={`flex items-center gap-3 px-4 py-3 ${!doc.is_locked ? "cursor-pointer active:bg-gray-700/40" : ""}`}
                  onClick={() => { if (!doc.is_locked) setEditingItem(idx); }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{item.description}</p>
                    {item.quantity !== 1 && (
                      <p className="text-xs text-gray-500">{item.quantity} ×  {sym}{(item.unit_price || 0).toFixed(2)}</p>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-white flex-shrink-0">
                    {sym}{((item.quantity || 1) * (item.unit_price || 0)).toFixed(2)}
                  </span>
                  {!doc.is_locked && (
                    <button onClick={e => { e.stopPropagation(); removeLineItem(idx); }}
                      className="text-gray-600 hover:text-red-400 flex-shrink-0 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )
            )}
          </div>

          {/* Add item row */}
          {!doc.is_locked && (
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-700/40">
              <input
                className="flex-1 bg-transparent text-white text-sm placeholder-gray-600 focus:outline-none min-w-0"
                placeholder="Add item…"
                value={newItem.description}
                onChange={e => setNewItem(p => ({ ...p, description: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") addLineItem(); }}
              />
              <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 gap-1 w-28 flex-shrink-0">
                <span className="text-gray-500 text-sm">{sym}</span>
                <input
                  type="number"
                  className="w-full bg-transparent text-white text-sm focus:outline-none"
                  placeholder="0.00"
                  value={newItem.unit_price}
                  onChange={e => setNewItem(p => ({ ...p, unit_price: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") addLineItem(); }}
                />
              </div>
              <button onClick={addLineItem} disabled={!newItem.description}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white rounded-lg p-2 flex-shrink-0 transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Total footer */}
          <div className="px-4 py-4 border-t border-gray-700/40 bg-gray-800/50">
            {(doc.discount_amount > 0 || doc.tax_amount > 0) && (
              <div className="space-y-1 mb-3">
                {doc.discount_amount > 0 && (
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Subtotal</span><span>{sym}{(doc.subtotal || 0).toFixed(2)}</span>
                  </div>
                )}
                {doc.discount_amount > 0 && (
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Discount {doc.discount_type === "percentage" ? `(${doc.discount_value}%)` : ""}</span>
                    <span>−{sym}{(doc.discount_amount || 0).toFixed(2)}</span>
                  </div>
                )}
                {doc.tax_amount > 0 && (
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Tax ({doc.tax_rate}%)</span>
                    <span>+{sym}{(doc.tax_amount || 0).toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-sm">Total</span>
              <span className="text-2xl font-bold text-white">{sym}{(doc.total || doc.subtotal || 0).toFixed(2)}</span>
            </div>

          </div>
        </div>

        {/* Payments */}
        {isInvoice && payments.length > 0 && (
          <div>
            <label className="text-xs text-gray-400 mb-2 block">Payments</label>
            <div className="space-y-1">
              {payments.map(p => (
                <div key={p.id} className="bg-gray-800 rounded-lg px-3 py-2 flex items-center justify-between text-sm">
                  <div>
                    <span className="text-white">{sym}{Number(p.amount).toFixed(2)}</span>
                    {p.payment_method && <span className="text-gray-500 ml-2">({p.payment_method})</span>}
                  </div>
                  <span className="text-gray-500 text-xs">{p.payment_date}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Notes / Payment Details</label>
          <textarea
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
            placeholder="Bank details, payment instructions..."
            rows={3}
            value={doc.notes || ""}
            onChange={e => onChange("notes", e.target.value)}
            disabled={doc.is_locked}
          />
        </div>

        {/* ── Details (collapsible) ────────────────────────────────── */}
        <div className="border-t border-gray-800/80 pt-4">
          <button
            onClick={() => setShowDetails(v => !v)}
            className="flex items-center gap-2 w-full text-left mb-0 group"
          >
            <p className="text-[10px] text-gray-600 group-hover:text-gray-500 uppercase tracking-widest font-semibold transition-colors">Details</p>
            <ChevronDown className={`w-3 h-3 text-gray-700 group-hover:text-gray-500 ml-auto transition-transform duration-200 ${showDetails ? "rotate-180" : ""}`} />
          </button>
          {showDetails && <div className="mt-3 space-y-3">

          {/* Discount & Tax */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Discount</label>
              <div className="flex gap-1">
                <select
                  className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                  value={doc.discount_type || ""}
                  onChange={e => updateDiscountOrTax("discount_type", e.target.value || null)}
                  disabled={doc.is_locked}
                >
                  <option value="">None</option>
                  <option value="percentage">%</option>
                  <option value="fixed">Fixed</option>
                </select>
                {doc.discount_type && (
                  <input
                    type="number"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                    value={doc.discount_value || ""}
                    onChange={e => updateDiscountOrTax("discount_value", parseFloat(e.target.value) || 0)}
                    disabled={doc.is_locked}
                    placeholder={doc.discount_type === "percentage" ? "%" : sym}
                  />
                )}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Tax Rate (%)</label>
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                placeholder="0"
                value={doc.tax_rate || ""}
                onChange={e => updateDiscountOrTax("tax_rate", parseFloat(e.target.value) || 0)}
                disabled={doc.is_locked}
              />
            </div>
          </div>

          {/* Currency + Invoice # */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Currency</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                value={doc.currency || "GBP"}
                onChange={e => onChange("currency", e.target.value)}
                disabled={doc.is_locked}
              >
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{typeLabel} #</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                placeholder="Auto-generated"
                value={doc.document_number || ""}
                onChange={e => onChange("document_number", e.target.value)}
                disabled={doc.is_locked || !id}
              />
            </div>
          </div>

          {/* Paid date (if paid) */}
          {isInvoice && doc.status === "paid" && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 flex-shrink-0">Date paid</label>
              <input
                type="date"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                value={doc.paid_date || ""}
                onChange={e => onChange("paid_date", e.target.value)}
              />
            </div>
          )}
        </div>}
        </div>

        {/* Delete */}
        {id && (
          <div className="pt-2">
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="w-full text-red-500 hover:text-red-400 text-sm flex items-center gap-2 justify-center py-2 transition-colors">
                <Trash2 className="w-4 h-4" /> Delete {typeLabel}
              </button>
            ) : (
              <div className="bg-red-950/50 border border-red-700/40 rounded-xl p-4">
                <div className="flex items-center gap-2 text-red-300 text-sm font-medium mb-3">
                  <AlertTriangle className="w-4 h-4" /> Delete this {typeLabel.toLowerCase()}?
                </div>
                <div className="flex gap-2">
                  <button onClick={handleDelete} className="flex-1 bg-red-600 hover:bg-red-500 text-white rounded-lg py-2 text-sm font-medium transition-colors">Delete</button>
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg py-2 text-sm font-medium transition-colors">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Quick-Create Client Modal ──────────────────────────────── */}
      <Dialog open={showCreateClient} onOpenChange={setShowCreateClient}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Add New Client</DialogTitle>
            <DialogDescription className="text-gray-400">Quick-create a client for this document.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Name *</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
                placeholder="Client name"
                value={newClientForm.name}
                onChange={e => setNewClientForm(p => ({ ...p, name: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter" && newClientForm.name.trim()) handleCreateClient(); }}
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Type</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                value={newClientForm.client_type}
                onChange={e => setNewClientForm(p => ({ ...p, client_type: e.target.value }))}
              >
                {CLIENT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Email</label>
              <input
                type="email"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
                placeholder="client@example.com"
                value={newClientForm.email}
                onChange={e => setNewClientForm(p => ({ ...p, email: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter" && newClientForm.name.trim()) handleCreateClient(); }}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCreateClient}
                disabled={!newClientForm.name.trim() || creatingClient}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors"
              >
                {creatingClient ? "Creating..." : "Create Client"}
              </button>
              <button onClick={() => setShowCreateClient(false)} className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-4 py-2 text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Quick-Create Event Modal ───────────────────────────────── */}
      <Dialog open={showCreateEvent} onOpenChange={setShowCreateEvent}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Create New Event</DialogTitle>
            <DialogDescription className="text-gray-400">Create an event to link to this invoice.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Title *</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
                placeholder="e.g. Jazz Night at Blue Note"
                value={newEventForm.title}
                onChange={e => setNewEventForm(p => ({ ...p, title: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter" && newEventForm.title.trim()) handleCreateEvent(); }}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Date</label>
                <input
                  type="date"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                  value={newEventForm.date}
                  onChange={e => setNewEventForm(p => ({ ...p, date: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Fee</label>
                <input
                  type="number"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="0"
                  value={newEventForm.base_price}
                  onChange={e => setNewEventForm(p => ({ ...p, base_price: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Client</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                value={newEventForm.client_id}
                onChange={e => {
                  if (e.target.value === "__new_client__") {
                    e.target.value = newEventForm.client_id;
                    handleClientDropdownChange("__new_client__", "event-modal");
                  } else {
                    setNewEventForm(p => ({ ...p, client_id: e.target.value }));
                  }
                }}
              >
                <option value="">No client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new_client__">+ Add New Client</option>
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCreateEvent}
                disabled={!newEventForm.title.trim() || creatingEvent}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors"
              >
                {creatingEvent ? "Creating..." : "Create Event"}
              </button>
              <button onClick={() => setShowCreateEvent(false)} className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-4 py-2 text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
