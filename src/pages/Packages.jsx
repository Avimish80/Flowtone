import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { createPageUrl, currencySymbol } from "@/utils";
import { uploadPackagePhoto, deletePackagePhoto, isPhotoUploadAvailable } from "@/lib/packagePhotos";
import { useToast } from "@/components/ui/use-toast";
import {
  Plus, ImagePlus, ChevronUp, ChevronDown, Trash2, Link2, ExternalLink, Eye, EyeOff, X, Check,
} from "lucide-react";

const CURRENCIES = ["GBP", "USD", "EUR", "AUD", "CAD"];

const emptyForm = { name: "", description: "", price: "", currency: "GBP" };

function makeSlug(businessName) {
  const base = (businessName || "flowtone")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "flowtone";
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${base}-${rand}`;
}

export default function Packages() {
  const { toast } = useToast();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [editingId, setEditingId] = useState(null); // "new" | package id | null
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const fileInputRef = useRef(null);
  const uploadTargetRef = useRef(null);

  const load = async () => {
    try {
      const [pkgs, prof] = await Promise.all([
        appClient.entities.ServicePackage.list("sort_order"),
        appClient.helpers.ensureSingletonEntity("BusinessProfile"),
      ]);
      setPackages(pkgs);
      setProfile(prof);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const enquiryUrl = profile?.public_slug
    ? `${window.location.origin}/p/${profile.public_slug}`
    : null;

  const handleShare = async () => {
    let slug = profile?.public_slug;
    if (!slug) {
      slug = makeSlug(profile?.business_name);
      const updated = await appClient.entities.BusinessProfile.update(profile.id, { public_slug: slug });
      setProfile(updated || { ...profile, public_slug: slug });
    }
    const url = `${window.location.origin}/p/${slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: profile?.business_name || "Get a quote", url });
        return;
      }
    } catch { /* fall through to clipboard */ }
    try {
      await navigator.clipboard.writeText(url);
      toast({ description: "Enquiry page link copied" });
    } catch {
      toast({ description: url });
    }
  };

  const startEdit = (pkg) => {
    setEditingId(pkg ? pkg.id : "new");
    setForm(pkg
      ? { name: pkg.name || "", description: pkg.description || "", price: pkg.price ?? "", currency: pkg.currency || "GBP" }
      : emptyForm);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const saveEdit = async () => {
    if (!form.name.trim()) {
      toast({ description: "Give the package a name" });
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        description: form.description.trim(),
        price: form.price === "" ? null : parseFloat(form.price) || 0,
        currency: form.currency,
      };
      if (editingId === "new") {
        const maxOrder = packages.reduce((m, p) => Math.max(m, p.sort_order || 0), 0);
        await appClient.entities.ServicePackage.create({ ...data, active: true, sort_order: maxOrder + 1 });
      } else {
        await appClient.entities.ServicePackage.update(editingId, data);
      }
      cancelEdit();
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (pkg) => {
    await appClient.entities.ServicePackage.update(pkg.id, { active: !pkg.active });
    await load();
  };

  const move = async (pkg, dir) => {
    const idx = packages.findIndex((p) => p.id === pkg.id);
    const swapWith = packages[idx + dir];
    if (!swapWith) return;
    await Promise.all([
      appClient.entities.ServicePackage.update(pkg.id, { sort_order: swapWith.sort_order ?? idx + dir }),
      appClient.entities.ServicePackage.update(swapWith.id, { sort_order: pkg.sort_order ?? idx }),
    ]);
    await load();
  };

  const handleDelete = async (pkg) => {
    if (pkg.photo_url) deletePackagePhoto(pkg.photo_url);
    await appClient.entities.ServicePackage.delete(pkg.id);
    setConfirmDeleteId(null);
    await load();
  };

  const pickPhoto = (pkg) => {
    uploadTargetRef.current = pkg;
    fileInputRef.current?.click();
  };

  const handlePhotoSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const pkg = uploadTargetRef.current;
    if (!file || !pkg) return;
    setUploadingId(pkg.id);
    try {
      const url = await uploadPackagePhoto(file);
      if (pkg.photo_url) deletePackagePhoto(pkg.photo_url);
      await appClient.entities.ServicePackage.update(pkg.id, { photo_url: url });
      await load();
    } catch (err) {
      toast({ description: err.message || "Photo upload failed" });
    } finally {
      setUploadingId(null);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-500 text-center py-16">Loading…</div>;
  }

  return (
    <div className="p-4 max-w-xl mx-auto pb-24">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelected} />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Link to={createPageUrl("Leads")} className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
            Leads
          </Link>
          {enquiryUrl && (
            <a
              href={enquiryUrl}
              target="_blank"
              rel="noreferrer"
              className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Preview page
            </a>
          )}
        </div>
        <div className="flex items-center gap-4">
          <button onClick={handleShare} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 transition-colors">
            <Link2 className="w-3 h-3" /> Share link
          </button>
          <button onClick={() => startEdit(null)} className="text-ink hover:text-ink/80 text-xs flex items-center gap-1 transition-colors">
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>
      </div>

      {packages.length === 0 && editingId !== "new" && (
        <div className="text-center py-16">
          <p className="text-base font-semibold text-white">Your offer, ready to share</p>
          <p className="text-sm text-gray-500 mt-2 max-w-xs mx-auto">
            Create packages like "DJ solo" or "DJ + sax" with a photo and price. Prospects pick one on your public enquiry page.
          </p>
          <button
            onClick={() => startEdit(null)}
            className="mt-6 bg-ink hover:bg-ink/90 text-ink-fg text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            Create first package
          </button>
        </div>
      )}

      <div className="space-y-3">
        {editingId === "new" && (
          <PackageEditor form={form} setForm={setForm} onSave={saveEdit} onCancel={cancelEdit} saving={saving} />
        )}

        {packages.map((pkg, idx) => (
          <div key={pkg.id}>
            {editingId === pkg.id ? (
              <PackageEditor form={form} setForm={setForm} onSave={saveEdit} onCancel={cancelEdit} saving={saving} />
            ) : (
              <div className={`rounded-2xl border border-gray-700/60 bg-gray-800/30 overflow-hidden ${!pkg.active ? "opacity-50" : ""}`}>
                {pkg.photo_url && <img src={pkg.photo_url} alt={pkg.name} className="w-full h-40 object-cover" />}
                <div className="p-4">
                  <button onClick={() => startEdit(pkg)} className="w-full text-left">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-base font-semibold text-white">{pkg.name}</p>
                      {pkg.price != null && (
                        <p className="text-base font-bold text-white whitespace-nowrap">
                          {currencySymbol(pkg.currency)}{Number(pkg.price).toLocaleString()}
                        </p>
                      )}
                    </div>
                    {pkg.description && <p className="text-sm text-gray-400 mt-1 line-clamp-2">{pkg.description}</p>}
                  </button>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-800">
                    <div className="flex items-center gap-4">
                      <button onClick={() => pickPhoto(pkg)} disabled={!isPhotoUploadAvailable() || uploadingId === pkg.id} className="text-gray-500 hover:text-gray-300 disabled:opacity-40 text-xs flex items-center gap-1 transition-colors">
                        <ImagePlus className="w-3.5 h-3.5" />
                        {uploadingId === pkg.id ? "Uploading…" : pkg.photo_url ? "Change photo" : "Add photo"}
                      </button>
                      <button onClick={() => toggleActive(pkg)} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 transition-colors">
                        {pkg.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        {pkg.active ? "Visible" : "Hidden"}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => move(pkg, -1)} disabled={idx === 0} className="text-gray-600 hover:text-gray-300 disabled:opacity-30 transition-colors">
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button onClick={() => move(pkg, 1)} disabled={idx === packages.length - 1} className="text-gray-600 hover:text-gray-300 disabled:opacity-30 transition-colors">
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      {confirmDeleteId === pkg.id ? (
                        <button onClick={() => handleDelete(pkg)} className="text-red-400 text-xs font-medium ml-1">
                          Confirm?
                        </button>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(pkg.id)} className="text-gray-600 hover:text-red-400 ml-1 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PackageEditor({ form, setForm, onSave, onCancel, saving }) {
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const inputClass =
    "w-full bg-gray-900 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400";
  return (
    <div className="rounded-2xl border border-gray-700/60 bg-gray-800/50 p-4 space-y-3">
      <input className={inputClass} placeholder="Package name (e.g. DJ + Saxophone)" value={form.name} onChange={set("name")} autoFocus />
      <textarea className={`${inputClass} min-h-[80px]`} placeholder="What's included, set length, extras…" value={form.description} onChange={set("description")} />
      <div className="flex gap-2">
        <select className={`${inputClass} w-24`} value={form.currency} onChange={set("currency")}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className={inputClass} type="number" inputMode="decimal" placeholder="Price" value={form.price} onChange={set("price")} />
      </div>
      <div className="flex items-center justify-end gap-3 pt-1">
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 transition-colors">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        <button onClick={onSave} disabled={saving} className="bg-ink hover:bg-ink/90 disabled:opacity-60 text-ink-fg text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1 transition-colors">
          <Check className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
