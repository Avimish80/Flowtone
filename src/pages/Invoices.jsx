import { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl, currencySymbol } from "@/utils";
import { Plus, ChevronRight, CheckSquare, Square, Trash2, CheckCircle2, Lock, CalendarDays, ChevronDown, TrendingUp, AlertTriangle, FileText, Send, XCircle } from "lucide-react";
import { format, parseISO, isPast } from "date-fns";
import { usePageState } from "@/hooks/usePageState";
import SortDropdown from "@/components/SortDropdown";

const INV_SORT_OPTIONS = [
  { key: "created_at", label: "Date Created", type: "date" },
  { key: "due_date", label: "Due Date", type: "date" },
  { key: "total", label: "Amount", type: "number" },
  { key: "client_name", label: "Client", type: "text" },
  { key: "status", label: "Status", type: "text" },
];

const invoiceStatusColors = {
  draft: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  sent: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  paid: "bg-green-500/20 text-green-400 border-green-500/30",
  overdue: "bg-red-500/20 text-red-400 border-red-500/30",
  cancelled: "bg-gray-600/20 text-gray-500 border-gray-600/30",
  void: "bg-gray-600/20 text-gray-500 border-gray-600/30",
};

/** Get tax year label for a date. startMonth=4 (April) -> "2024/25" format; startMonth=1 -> "2025" */
const getTaxYear = (dateStr, startMonth) => {
  if (!dateStr) return null;
  try {
    const d = parseISO(dateStr);
    const m = d.getMonth() + 1; // 1-12
    const y = d.getFullYear();
    const yearStart = m >= startMonth ? y : y - 1;
    if (startMonth === 1) return String(yearStart);
    const shortEnd = String(yearStart + 1).slice(-2);
    return `${yearStart}/${shortEnd}`;
  } catch { return null; }
};

export default function Invoices() {
  const location = useLocation();
  const [filterStatus, setFilterStatus] = usePageState("finance_filterStatus", "all");
  const [filterYear, setFilterYear] = usePageState("finance_filterYear", "all");
  const [sort, setSort] = usePageState("finance_sort", { key: "created_at", direction: "desc" });
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [taxYearStartMonth, setTaxYearStartMonth] = useState(4);
  const [showYearDropdown, setShowYearDropdown] = useState(false);

  const clientMap = useMemo(() => {
    return Object.fromEntries(clients.map(c => [c.id, c]));
  }, [clients]);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      appClient.entities.Document.list("-created_at"),
      appClient.entities.Client.list(),
      appClient.entities.AppSettings.list(),
    ]).then(([docs, cls, settingsArr]) => {
      setDocuments(docs);
      setClients(cls);
      const s = settingsArr[0];
      if (s?.tax_year_start_month) setTaxYearStartMonth(s.tax_year_start_month);
      setLoading(false);
    });
  };

  useEffect(() => { loadData(); }, []);

  // Pre-apply filter from URL param e.g. /Finance?filter=overdue
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const f = params.get("filter");
    if (f) setFilterStatus(f);
  }, [location.search]);

  // Only invoices
  const invoices = useMemo(() => documents.filter(d => d.document_type === "invoice"), [documents]);

  const toggleSelect = (id) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSelectAll = () => {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(i => i.id)));
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await Promise.allSettled([...selected].map(id => appClient.entities.Document.delete(id)));
    } catch (err) {
      console.error("Bulk delete error:", err);
    }
    setSelected(new Set()); setSelectMode(false); setDeleting(false); loadData();
  };

  // Compute available tax years from invoices
  const availableYears = useMemo(() => {
    const years = new Set();
    for (const item of invoices) {
      const dateStr = item.due_date || item.created_at;
      const ty = getTaxYear(dateStr, taxYearStartMonth);
      if (ty) years.add(ty);
    }
    return [...years].sort().reverse();
  }, [invoices, taxYearStartMonth]);

  // Year-filtered items
  const yearFiltered = useMemo(() => {
    if (filterYear === "all") return invoices;
    return invoices.filter(item => {
      const dateStr = item.due_date || item.created_at;
      return getTaxYear(dateStr, taxYearStartMonth) === filterYear;
    });
  }, [invoices, filterYear, taxYearStartMonth]);

  const filtered = yearFiltered.filter(item => {
    if (filterStatus === "all") return true;
    if (filterStatus === "overdue") {
      return item.status === "sent" && item.due_date && isPast(parseISO(item.due_date));
    }
    return item.status === filterStatus;
  });

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av, bv;
      if (sort.key === "client_name") {
        av = (clientMap[a.client_id]?.name || "").toLowerCase();
        bv = (clientMap[b.client_id]?.name || "").toLowerCase();
      } else {
        av = a[sort.key] ?? "";
        bv = b[sort.key] ?? "";
      }
      if (typeof av === "number" && typeof bv === "number") {
        return sort.direction === "desc" ? bv - av : av - bv;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sort.direction === "desc" ? -cmp : cmp;
    });
  }, [filtered, sort, clientMap]);

  // ── Always-visible overview (all invoices, ignores year/status filter) ──
  const overview = useMemo(() => {
    const sum = (arr) => arr.reduce((s, i) => s + (i.total ?? i.subtotal ?? 0), 0);
    const cs = currencySymbol();
    const fmt = (n) => {
      if (n >= 10000) return cs + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
      return cs + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    };
    const overdue    = invoices.filter(i => i.status === "sent" && i.due_date && isPast(parseISO(i.due_date)));
    const sent       = invoices.filter(i => i.status === "sent");
    const paid       = invoices.filter(i => i.status === "paid");
    const drafts     = invoices.filter(i => i.status === "draft");
    const cancelled  = invoices.filter(i => i.status === "cancelled");
    return { overdue, sent, paid, drafts, cancelled, sum, fmt };
  }, [invoices]);

  return (
    <div className="p-4 max-w-xl mx-auto">

      {/* ── Top toolbar ── */}
      <div className="flex items-center justify-end gap-2 mb-5">
        {/* Year filter */}
        <div className="relative">
          <button onClick={() => setShowYearDropdown(v => !v)}
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-xs font-medium transition-colors">
            <CalendarDays className="w-3.5 h-3.5" />
            {filterYear === "all" ? "All years" : filterYear}
            <ChevronDown className="w-3 h-3 text-gray-500" />
          </button>
          {showYearDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowYearDropdown(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[8rem] max-h-60 overflow-y-auto">
                <button onClick={() => { setFilterYear("all"); setShowYearDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${filterYear === "all" ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                  All Years
                </button>
                {availableYears.map(yr => (
                  <button key={yr} onClick={() => { setFilterYear(yr); setShowYearDropdown(false); }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${filterYear === yr ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                    {yr}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <SortDropdown options={INV_SORT_OPTIONS} activeSort={sort} onSortChange={setSort} />
        <button onClick={() => { setSelectMode(v => !v); setSelected(new Set()); }}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectMode ? "bg-red-700 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
          {selectMode ? "Cancel" : "Select"}
        </button>
        <Link to={createPageUrl("DocumentDetail?type=invoice")}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-1 text-xs font-semibold transition-colors">
          <Plus className="w-3.5 h-3.5" /> New
        </Link>
      </div>

      {/* ── Hero: Outstanding ── */}
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-5 mb-3 border border-gray-700/50">
        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-widest mb-1">Outstanding</p>
        <p className={`text-3xl font-bold mb-1 ${overview.overdue.length > 0 ? "text-yellow-300" : "text-white"}`}>
          {overview.fmt(overview.sum(overview.sent))}
        </p>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-400">{overview.sent.length} sent</span>
          {overview.overdue.length > 0 && (
            <span className="text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {overview.overdue.length} overdue
            </span>
          )}
        </div>
      </div>

      {/* ── Swipeable stat tiles ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-5 -mx-4 px-4 snap-x snap-mandatory scrollbar-none">
        {[
          {
            key: "overdue",
            label: "Overdue",
            icon: AlertTriangle,
            value: overview.overdue.length > 0 ? overview.fmt(overview.sum(overview.overdue)) : "None",
            sub: `${overview.overdue.length} invoice${overview.overdue.length !== 1 ? "s" : ""}`,
            active: overview.overdue.length > 0,
            colors: overview.overdue.length > 0
              ? "bg-red-950/60 border-red-800/40 text-red-300"
              : "bg-gray-800/60 border-gray-700/40 text-gray-400",
            iconColor: overview.overdue.length > 0 ? "text-red-400" : "text-gray-500",
            labelColor: overview.overdue.length > 0 ? "text-red-400" : "text-gray-500",
            subColor: overview.overdue.length > 0 ? "text-red-400/60" : "text-gray-600",
          },
          {
            key: "paid",
            label: "Paid",
            icon: TrendingUp,
            value: overview.fmt(overview.sum(overview.paid)),
            sub: `${overview.paid.length} invoice${overview.paid.length !== 1 ? "s" : ""}`,
            colors: "bg-green-950/30 border-green-800/20 text-green-300",
            iconColor: "text-green-400",
            labelColor: "text-green-400",
            subColor: "text-green-400/60",
          },
          {
            key: "draft",
            label: "Drafts",
            icon: FileText,
            value: String(overview.drafts.length),
            sub: "in progress",
            colors: "bg-gray-800/60 border-gray-700/40 text-white",
            iconColor: "text-gray-400",
            labelColor: "text-gray-400",
            subColor: "text-gray-500",
          },
          {
            key: "sent",
            label: "Sent",
            icon: Send,
            value: String(overview.sent.length),
            sub: `${overview.fmt(overview.sum(overview.sent))} outstanding`,
            colors: "bg-blue-950/30 border-blue-800/20 text-blue-300",
            iconColor: "text-blue-400",
            labelColor: "text-blue-400",
            subColor: "text-blue-400/60",
          },
          {
            key: "cancelled",
            label: "Cancelled",
            icon: XCircle,
            value: String(overview.cancelled.length),
            sub: "voided",
            colors: "bg-gray-800/40 border-gray-700/30 text-gray-500",
            iconColor: "text-gray-600",
            labelColor: "text-gray-600",
            subColor: "text-gray-700",
          },
        ].map(tile => {
          const Icon = tile.icon;
          const isActive = filterStatus === tile.key;
          return (
            <button
              key={tile.key}
              onClick={() => setFilterStatus(isActive ? "all" : tile.key)}
              className={`flex-shrink-0 w-32 snap-start rounded-xl p-3 text-left transition-all border ${tile.colors} ${isActive ? "ring-2 ring-indigo-500 scale-[1.02]" : ""}`}
            >
              <div className="flex items-center gap-1 mb-2">
                <Icon className={`w-3 h-3 ${tile.iconColor}`} />
                <p className={`text-[10px] font-bold uppercase tracking-wider ${tile.labelColor}`}>{tile.label}</p>
              </div>
              <p className="text-lg font-bold leading-tight truncate">{tile.value}</p>
              <p className={`text-[10px] mt-0.5 truncate ${tile.subColor}`}>{tile.sub}</p>
            </button>
          );
        })}
      </div>

      {/* Bulk select bar */}
      {selectMode && (
        <div className="flex items-center gap-3 mb-3 bg-gray-800 rounded-xl px-4 py-3">
          <button onClick={toggleSelectAll} className="text-indigo-400 text-sm flex items-center gap-1.5">
            {selected.size === filtered.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {selected.size === filtered.length ? "Deselect all" : "Select all"}
          </button>
          <span className="text-gray-500 text-sm">{selected.size} selected</span>
          {selected.size > 0 && (
            <button onClick={handleBulkDelete} disabled={deleting}
              className="ml-auto bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
              {deleting ? "Deleting..." : `Delete ${selected.size}`}
            </button>
          )}
        </div>
      )}

      {/* ── Active filter indicator + clear ── */}
      {filterStatus !== "all" && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400">
            Showing: <span className="text-white font-medium capitalize">{filterStatus}</span>
          </p>
          <button onClick={() => setFilterStatus("all")} className="text-xs text-indigo-400 hover:text-indigo-300">
            Show all
          </button>
        </div>
      )}

      {/* ── List ── */}
      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="bg-gray-800 rounded-xl h-20 animate-pulse" />)}</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="mb-3">No invoices found</p>
          <Link to={createPageUrl("DocumentDetail?type=invoice")}
            className="text-indigo-400 text-sm hover:text-indigo-300 transition-colors">
            + Create invoice
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(item => {
            const isOverdue = item.status === "sent" && item.due_date && isPast(parseISO(item.due_date));
            const isSelected = selected.has(item.id);
            const clientName = clientMap[item.client_id]?.name || "";
            const displayStatus = isOverdue ? "overdue" : item.status;
            const inner = (
              <div className={`flex items-center gap-3 bg-gray-800 rounded-xl p-4 transition-colors active:bg-gray-700 ${isSelected ? "ring-2 ring-indigo-500" : ""}`}>
                {selectMode && (
                  <button onClick={() => toggleSelect(item.id)} className="flex-shrink-0 text-indigo-400">
                    {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-gray-600" />}
                  </button>
                )}
                {/* Status bar on left edge */}
                <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${
                  displayStatus === "overdue" ? "bg-red-500" :
                  displayStatus === "paid" ? "bg-green-500" :
                  displayStatus === "sent" ? "bg-blue-500" :
                  "bg-gray-600"
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {item.document_number && <span className="text-[11px] text-gray-500 font-mono">#{item.document_number}</span>}
                    {item.is_locked && <Lock className="w-3 h-3 text-yellow-500 flex-shrink-0" />}
                  </div>
                  <p className="font-semibold text-white truncate text-sm">{item.title || clientName}</p>
                  <p className="text-xs text-gray-400 truncate">{clientName}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${invoiceStatusColors[displayStatus] || invoiceStatusColors.draft}`}>
                      {displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1)}
                    </span>
                    {item.due_date && (
                      <span className={`text-[10px] ${isOverdue ? "text-red-400" : "text-gray-500"}`}>
                        {isOverdue ? "Overdue" : "Due"} {format(parseISO(item.due_date), "d MMM")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <p className="font-bold text-white text-sm">{currencySymbol(item.currency)}{(item.total ?? item.subtotal ?? 0).toFixed(2)}</p>
                  {!selectMode && item.status === "sent" && (
                    <button
                      onClick={async (e) => {
                        e.preventDefault(); e.stopPropagation();
                        await appClient.helpers.recordPayment({
                          document_id: item.id,
                          amount: item.total ?? item.subtotal ?? 0,
                          payment_date: format(new Date(), "yyyy-MM-dd"),
                          notes: "Marked as paid from list",
                        });
                        loadData();
                      }}
                      className="text-[10px] bg-gray-700 hover:bg-green-700/60 text-gray-300 hover:text-green-300 px-2 py-0.5 rounded-full font-semibold transition-colors flex items-center gap-1 border border-gray-600 hover:border-green-500/50">
                      <CheckCircle2 className="w-3 h-3" /> Mark Paid
                    </button>
                  )}
                  {!selectMode && item.status === "paid" && (
                    <span className="text-[10px] text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {item.paid_date ? format(parseISO(item.paid_date), "d MMM") : "Paid"}
                    </span>
                  )}
                  {!selectMode && <ChevronRight className="w-4 h-4 text-gray-600" />}
                </div>
              </div>
            );
            return selectMode
              ? <div key={item.id}>{inner}</div>
              : <Link key={item.id} to={createPageUrl(`DocumentDetail?id=${item.id}`)} className="block">{inner}</Link>;
          })}
        </div>
      )}
    </div>
  );
}
