import { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { Plus, Package, Pencil, Check, X, CheckSquare, Square, Trash2 } from "lucide-react";
import { currencySymbol } from "@/utils";
import { usePageState } from "@/hooks/usePageState";
import SortDropdown from "@/components/SortDropdown";

const CATEGORIES = ["instrument", "amp", "pedal", "accessory", "other"];

const catColors = {
  instrument: "text-purple-400", amp: "text-blue-400",
  pedal: "text-yellow-400", accessory: "text-green-400", other: "text-gray-400"
};

const SORT_OPTIONS = [
  { key: "name", label: "Name", type: "text" },
  { key: "category", label: "Category", type: "text" },
];

export default function Equipment() {
  const [sort, setSort] = usePageState("equipment_sort", { key: "name", direction: "asc" });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", category: "instrument", serial_number: "", notes: "", estimated_value: "" });
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  const loadItems = () => {
    appClient.entities.Equipment.list("name").then(data => {
      setItems(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { loadItems(); }, []);

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const av = (a[sort.key] || "").toLowerCase();
      const bv = (b[sort.key] || "").toLowerCase();
      const cmp = av.localeCompare(bv);
      return sort.direction === "desc" ? -cmp : cmp;
    });
  }, [items, sort]);

  const toggleSelect = (id) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSelectAll = () => {
    setSelected(selected.size === sorted.length ? new Set() : new Set(sorted.map(i => i.id)));
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await Promise.allSettled([...selected].map(id => appClient.entities.Equipment.delete(id)));
    } catch (err) {
      console.error("Bulk delete error:", err);
    }
    setSelected(new Set()); setSelectMode(false); setDeleting(false); loadItems();
  };

  const openNew = () => {
    setForm({ name: "", category: "instrument", serial_number: "", notes: "", estimated_value: "" });
    setEditing("new");
  };

  const openEdit = (item) => {
    setForm({ name: item.name, category: item.category || "other", serial_number: item.serial_number || "", notes: item.notes || "", estimated_value: item.estimated_value || "" });
    setEditing(item.id);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const payload = {
      ...form,
      estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : null,
    };
    if (editing === "new") {
      const created = await appClient.entities.Equipment.create(payload);
      setItems(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    } else {
      await appClient.entities.Equipment.update(editing, payload);
      setItems(prev => prev.map(i => i.id === editing ? { ...i, ...payload } : i));
    }
    setEditing(null);
  };

  const handleDelete = async (id) => {
    await appClient.entities.Equipment.delete(id);
    setItems(prev => prev.filter(i => i.id !== id));
    setEditing(null);
  };

  if (loading) return <div className="p-4 text-gray-400">Loading...</div>;

  return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="flex items-center justify-end mb-4">
        <div className="flex gap-2">
          <SortDropdown options={SORT_OPTIONS} activeSort={sort} onSortChange={setSort} />
          <button
            onClick={() => { setSelectMode(v => !v); setSelected(new Set()); setEditing(null); }}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectMode ? "bg-red-700 text-white" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
          <button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      {selectMode && (
        <div className="flex items-center gap-3 mb-4 bg-gray-800 rounded-xl px-4 py-3">
          <button onClick={toggleSelectAll} className="text-indigo-400 text-sm flex items-center gap-1.5">
            {selected.size === items.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {selected.size === items.length ? "Deselect all" : "Select all"}
          </button>
          <span className="text-gray-500 text-sm">{selected.size} selected</span>
          {selected.size > 0 && (
            <button onClick={handleBulkDelete} disabled={deleting} className="ml-auto bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
              {deleting ? "Deleting..." : `Delete ${selected.size}`}
            </button>
          )}
        </div>
      )}

      {/* Inline form */}
      {editing !== null && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4 space-y-3">
          <p className="text-sm font-medium text-gray-200">{editing === "new" ? "New Item" : "Edit Item"}</p>
          <input
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
            placeholder="Name"
            value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          />
          <select
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
            value={form.category}
            onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
            placeholder="Serial number (optional)"
            value={form.serial_number}
            onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))}
          />
          <input
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
            placeholder="Estimated value (£)"
            type="number"
            value={form.estimated_value}
            onChange={e => setForm(p => ({ ...p, estimated_value: e.target.value }))}
          />
          <textarea
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500 resize-none"
            placeholder="Notes"
            rows={2}
            value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
          />
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-1 transition-colors">
              <Check className="w-4 h-4" /> Save
            </button>
            {editing !== "new" && (
              <button onClick={() => handleDelete(editing)} className="bg-red-700 hover:bg-red-600 text-white rounded-lg px-3 py-2 text-sm transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => setEditing(null)} className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-3 py-2 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="mb-2">No gear added yet</p>
          <button onClick={openNew} className="text-indigo-400 text-sm">+ Add your first item</button>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(item => {
            const isSelected = selected.has(item.id);
            return (
              <div key={item.id} className={`bg-gray-800 rounded-xl p-4 flex items-center gap-3 transition-colors ${isSelected ? "ring-2 ring-indigo-500" : ""}`}>
                {selectMode && (
                  <button onClick={() => toggleSelect(item.id)} className="flex-shrink-0 text-indigo-400">
                    {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-gray-600" />}
                  </button>
                )}
                <Package className={`w-5 h-5 flex-shrink-0 ${catColors[item.category] || "text-gray-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white">{item.name}</p>
                  <p className="text-xs text-gray-500 capitalize">{item.category}{item.serial_number ? ` · #${item.serial_number}` : ""}</p>
                  {item.estimated_value != null && item.estimated_value !== "" && (
                    <p className="text-xs text-green-400">{currencySymbol()}{Number(item.estimated_value).toLocaleString()}</p>
                  )}
                </div>
                {!selectMode && (
                  <button onClick={() => openEdit(item)} className="text-gray-500 hover:text-white transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}