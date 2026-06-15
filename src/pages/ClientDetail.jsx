import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Save, Trash2, Plus, X, AlertTriangle, AlertCircle, CheckCircle2, FileText } from "lucide-react";
import { useGoBack } from "@/hooks/useGoBack";
import ClientFinancialSummary from "../components/client/ClientFinancialSummary";
import InvoiceLessonsModal from "../components/client/InvoiceLessonsModal";

const CLIENT_TYPES = ["venue", "agent", "student", "band", "other"];
const EMAIL_TAGS = ["none", "gig_provider", "student", "ignored"];

export default function ClientDetail() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const navigate = useNavigate();
  const goBack = useGoBack("Clients");

  const [client, setClient] = useState({
    name: "", client_type: "other", emails: [], phones: [],
    default_currency: "GBP", default_payment_terms_days: 30,
    email_filter_tag: "none", has_late_payment_history: false, notes: ""
  });
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [showInvoiceLessons, setShowInvoiceLessons] = useState(false);

  useEffect(() => {
    if (id) {
      appClient.entities.Client.filter({ id }).then(data => {
        if (data[0]) setClient(data[0]);
        setLoading(false);
      });
    }
  }, [id]);

  const onChange = (field, value) => setClient(prev => ({ ...prev, [field]: value }));

  const addEmail = () => {
    if (!newEmail.trim()) return;
    onChange("emails", [...(client.emails || []), newEmail.trim()]);
    setNewEmail("");
  };

  const removeEmail = (i) => onChange("emails", client.emails.filter((_, idx) => idx !== i));

  const addPhone = () => {
    if (!newPhone.trim()) return;
    onChange("phones", [...(client.phones || []), newPhone.trim()]);
    setNewPhone("");
  };

  const removePhone = (i) => onChange("phones", client.phones.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    setSaving(true);
    if (id) {
      await appClient.entities.Client.update(id, client);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } else {
      const created = await appClient.entities.Client.create(client);
      navigate(createPageUrl(`ClientDetail?id=${created.id}`));
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    await appClient.entities.Client.delete(id);
    navigate(createPageUrl("Clients"));
  };

  if (loading) return <div className="p-4 text-gray-400">Loading...</div>;

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 sticky top-0 z-20 border-b border-gray-800">
        <button onClick={goBack} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="flex-1 font-semibold text-white truncate">{client.name || "New Client"}</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all ${
            savedFlash
              ? "bg-green-600 text-white"
              : "bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
          }`}
        >
          {savedFlash
            ? <><CheckCircle2 className="w-4 h-4" /> Saved</>
            : <><Save className="w-4 h-4" /> {saving ? "Saving..." : "Save"}</>
          }
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* Name */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Name *</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            placeholder="Client or company name"
            value={client.name || ""}
            onChange={e => onChange("name", e.target.value)}
          />
        </div>

        {/* Type */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Type</label>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
            value={client.client_type || "other"}
            onChange={e => onChange("client_type", e.target.value)}
          >
            {CLIENT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
          </select>
        </div>

        {/* Emails */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Email Addresses</label>
          <div className="space-y-2 mb-2">
            {(client.emails || []).map((email, i) => (
              <div key={i} className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                <span className="flex-1 text-sm text-gray-200">{email}</span>
                <button onClick={() => removeEmail(i)} className="text-gray-500 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
              placeholder="email@example.com"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addEmail()}
            />
            <button onClick={addEmail} className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-3 py-2 transition-colors"><Plus className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Phones */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Phone Numbers</label>
          <div className="space-y-2 mb-2">
            {(client.phones || []).map((phone, i) => (
              <div key={i} className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                <span className="flex-1 text-sm text-gray-200">{phone}</span>
                <button onClick={() => removePhone(i)} className="text-gray-500 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
              placeholder="+44 ..."
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addPhone()}
            />
            <button onClick={addPhone} className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-3 py-2 transition-colors"><Plus className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Finance defaults */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Currency</label>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              value={client.default_currency || "GBP"}
              onChange={e => onChange("default_currency", e.target.value)}
            >
              {["GBP", "USD", "EUR", "AUD", "CAD"].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Payment Terms (days)</label>
            <input
              type="number"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              value={client.default_payment_terms_days || 30}
              onChange={e => onChange("default_payment_terms_days", parseInt(e.target.value))}
            />
          </div>
        </div>

        {/* Email Filter Tag */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Email Filter Tag</label>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
            value={client.email_filter_tag || "none"}
            onChange={e => onChange("email_filter_tag", e.target.value)}
          >
            {EMAIL_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Late Payment Flag */}
        <div className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-gray-200">Late Payment History</p>
            <p className="text-xs text-gray-500">Flag this client for late payments</p>
          </div>
          <button
            onClick={() => onChange("has_late_payment_history", !client.has_late_payment_history)}
            className={`w-10 h-6 rounded-full transition-colors ${client.has_late_payment_history ? "bg-red-600" : "bg-gray-700"}`}
          >
            <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${client.has_late_payment_history ? "translate-x-4" : "translate-x-0"}`} />
          </button>
        </div>

        {/* Default Fee */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Default Fee (£)</label>
          <input
            type="number"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            placeholder="e.g. 250"
            value={client.default_fee || ""}
            onChange={e => onChange("default_fee", parseFloat(e.target.value) || null)}
          />
          <p className="text-xs text-gray-600 mt-1">Pre-fills the gig fee when creating a new event for this client</p>
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Notes</label>
          <textarea
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
            placeholder="Any notes about this client..."
            rows={3}
            value={client.notes || ""}
            onChange={e => onChange("notes", e.target.value)}
          />
        </div>

        {/* Invoice several lessons at once */}
        {id && (
          <button
            onClick={() => setShowInvoiceLessons(true)}
            className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <FileText className="w-4 h-4 text-indigo-400" /> Invoice lessons
          </button>
        )}

        {/* Financial Summary */}
        {id && (
          <div>
            <label className="text-xs text-gray-400 mb-3 block uppercase tracking-wide">Financial History</label>
            <ClientFinancialSummary clientId={id} />
          </div>
        )}

        {/* Delete */}
        {id && (
          <div className="pt-2">
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="w-full text-red-500 hover:text-red-400 text-sm flex items-center gap-2 justify-center py-2 transition-colors">
                <Trash2 className="w-4 h-4" /> Delete Client
              </button>
            ) : (
              <div className="bg-red-950/50 border border-red-700/40 rounded-xl p-4">
                <div className="flex items-center gap-2 text-red-300 text-sm font-medium mb-3">
                  <AlertTriangle className="w-4 h-4" /> Delete this client?
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

      {showInvoiceLessons && id && (
        <InvoiceLessonsModal
          clientId={id}
          clientName={client.name || "this client"}
          onClose={() => setShowInvoiceLessons(false)}
          onCreated={(doc) => {
            setShowInvoiceLessons(false);
            navigate(createPageUrl(`DocumentDetail?id=${doc.id}`));
          }}
        />
      )}
    </div>
  );
}