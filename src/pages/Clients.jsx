import { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Plus, User, ChevronRight, AlertCircle, CheckSquare, Square, Trash2 } from "lucide-react";
import { usePageState } from "@/hooks/usePageState";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import SortDropdown from "@/components/SortDropdown";

const typeColors = {
  venue: "text-purple-400", agent: "text-blue-400",
  student: "text-green-400", band: "text-yellow-400", other: "text-gray-400"
};

const SORT_OPTIONS = [
  { key: "name", label: "Name", type: "text" },
  { key: "client_type", label: "Type", type: "text" },
];

export default function Clients() {
  useScrollRestore("clients");
  const [sort, setSort] = usePageState("clients_sort", { key: "name", direction: "asc" });
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  const loadClients = () => {
    appClient.entities.Client.list("name").then(data => {
      setClients(data);
      setLoading(false);
    });
  };

  useEffect(() => { loadClients(); }, []);

  const sorted = useMemo(() => {
    return [...clients].sort((a, b) => {
      const av = (a[sort.key] || "").toLowerCase();
      const bv = (b[sort.key] || "").toLowerCase();
      const cmp = av.localeCompare(bv);
      return sort.direction === "desc" ? -cmp : cmp;
    });
  }, [clients, sort]);

  const toggleSelect = (id) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSelectAll = () => {
    setSelected(selected.size === sorted.length ? new Set() : new Set(sorted.map(c => c.id)));
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    for (const id of selected) await appClient.entities.Client.delete(id);
    setSelected(new Set()); setSelectMode(false); setDeleting(false); loadClients();
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center gap-2">
          <SortDropdown options={SORT_OPTIONS} activeSort={sort} onSortChange={setSort} />
          <button
            onClick={() => { setSelectMode(v => !v); setSelected(new Set()); }}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectMode ? "bg-red-700 text-white" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
          <Link to={createPageUrl("ClientDetail")} className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> New
          </Link>
        </div>
      </div>

      {selectMode && (
        <div className="flex items-center gap-3 mb-4 bg-gray-800 rounded-xl px-4 py-3">
          <button onClick={toggleSelectAll} className="text-indigo-400 text-sm flex items-center gap-1.5">
            {selected.size === sorted.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {selected.size === sorted.length ? "Deselect all" : "Select all"}
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

      {loading ? (
        <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="bg-gray-800 rounded-xl h-16 animate-pulse" />)}</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="mb-3">No clients yet</p>
          <Link to={createPageUrl("ClientDetail")} className="text-indigo-400 text-sm">+ Add your first client</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(client => {
            const isSelected = selected.has(client.id);
            const inner = (
              <div className={`flex items-center gap-3 bg-gray-800 rounded-xl p-4 transition-colors ${isSelected ? "ring-2 ring-indigo-500" : ""}`}>
                {selectMode && (
                  <button onClick={() => toggleSelect(client.id)} className="flex-shrink-0 text-indigo-400">
                    {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-gray-600" />}
                  </button>
                )}
                <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-white truncate">{client.name}</p>
                    {(client.late_payment_flag || client.has_late_payment_history) && <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                  </div>
                  <p className={`text-xs capitalize ${typeColors[client.client_type] || "text-gray-400"}`}>
                    {client.client_type || "other"}
                    {client.emails?.[0] ? ` \u00b7 ${client.emails[0]}` : ""}
                  </p>
                </div>
                {!selectMode && <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0" />}
              </div>
            );
            return selectMode ? (
              <div key={client.id}>{inner}</div>
            ) : (
              <Link key={client.id} to={createPageUrl(`ClientDetail?id=${client.id}`)} className="block active:bg-gray-700">{inner}</Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
