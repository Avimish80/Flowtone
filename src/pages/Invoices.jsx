import { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { Link } from "react-router-dom";
import { createPageUrl, currencySymbol } from "@/utils";
import { Plus, ChevronRight, AlertCircle, CheckSquare, Square, Trash2, CheckCircle2, Upload, Lock, CalendarDays, ChevronDown, ChevronUp, ArrowRightLeft } from "lucide-react";
import { format, parseISO, isPast } from "date-fns";
import InvoiceImportModal from "../components/invoices/InvoiceImportModal";
import { usePageState } from "@/hooks/usePageState";
import SortDropdown from "@/components/SortDropdown";

const INV_SORT_OPTIONS = [
  { key: "created_at", label: "Date Created", type: "date" },
  { key: "due_date", label: "Due Date", type: "date" },
  { key: "total", label: "Amount", type: "number" },
  { key: "client_name", label: "Client", type: "text" },
  { key: "status", label: "Status", type: "text" },
];

const EST_SORT_OPTIONS = [
  { key: "created_at", label: "Date Created", type: "date" },
  { key: "valid_until", label: "Valid Until", type: "date" },
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

const estimateStatusColors = {
  draft: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  sent: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  accepted: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  converted: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
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
  const [tab, setTab] = usePageState("finance_tab", "invoices");
  const [filterStatus, setFilterStatus] = usePageState("finance_filterStatus", "all");
  const [filterYear, setFilterYear] = usePageState("finance_filterYear", "all");
  const [sort, setSort] = usePageState("finance_sort", { key: "created_at", direction: "desc" });
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [taxYearStartMonth, setTaxYearStartMonth] = useState(4);
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [showSummary, setShowSummary] = usePageState("finance_showSummary", false);

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

  const switchTab = (t) => {
    setTab(t);
    setSelectMode(false);
    setSelected(new Set());
    setFilterStatus("all");
    setFilterYear("all");
  };

  // Split documents by type
  const invoices = useMemo(() => documents.filter(d => d.document_type === "invoice"), [documents]);
  const estimates = useMemo(() => documents.filter(d => d.document_type === "estimate"), [documents]);
  const items = tab === "invoices" ? invoices : estimates;

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

  // Compute available tax years from current tab's data
  const availableYears = useMemo(() => {
    const years = new Set();
    for (const item of items) {
      const dateStr = item.due_date || item.valid_until || item.created_at;
      const ty = getTaxYear(dateStr, taxYearStartMonth);
      if (ty) years.add(ty);
    }
    return [...years].sort().reverse();
  }, [items, taxYearStartMonth]);

  // Year-filtered items (applied before status filter)
  const yearFiltered = useMemo(() => {
    if (filterYear === "all") return items;
    return items.filter(item => {
      const dateStr = item.due_date || item.valid_until || item.created_at;
      return getTaxYear(dateStr, taxYearStartMonth) === filterYear;
    });
  }, [items, filterYear, taxYearStartMonth]);

  // Status filter pills per tab
  const invFilters = ["all", "draft", "sent", "paid", "overdue", "cancelled"];
  const estFilters = ["all", "draft", "sent", "accepted", "rejected", "converted"];
  const filters = tab === "invoices" ? invFilters : estFilters;
  const activeStatusColors = tab === "invoices" ? invoiceStatusColors : estimateStatusColors;

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

  // Contextual summary stats
  const summaryStats = useMemo(() => {
    const sum = (arr) => arr.reduce((s, i) => s + (i.total ?? i.subtotal ?? 0), 0);
    const cs = currencySymbol();
    const fmt = (n) => cs + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const fmtShort = (n) => {
      if (n >= 1000) return cs + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
      return cs + n.toFixed(0);
    };

    if (tab === "estimates") {
      const drafts = yearFiltered.filter(i => i.status === "draft");
      const sent = yearFiltered.filter(i => i.status === "sent");
      const accepted = yearFiltered.filter(i => i.status === "accepted");
      const rejected = yearFiltered.filter(i => i.status === "rejected");
      const converted = yearFiltered.filter(i => i.status === "converted");

      switch (filterStatus) {
        case "draft":
          return [
            { label: "Draft Value", value: fmt(sum(drafts)), color: "text-gray-300" },
            { label: "Drafts", value: String(drafts.length), color: "text-white" },
            { label: "Avg Value", value: drafts.length ? fmtShort(sum(drafts) / drafts.length) : "\u2014", color: "text-gray-400" },
          ];
        case "sent":
          return [
            { label: "Pending Value", value: fmt(sum(sent)), color: "text-blue-400" },
            { label: "Awaiting Response", value: String(sent.length), color: "text-blue-400" },
            { label: "Avg Estimate", value: sent.length ? fmtShort(sum(sent) / sent.length) : "\u2014", color: "text-gray-400" },
          ];
        case "accepted":
          return [
            { label: "Accepted Value", value: fmt(sum(accepted)), color: "text-green-400" },
            { label: "Accepted", value: String(accepted.length), color: "text-green-400" },
            { label: "Avg Value", value: accepted.length ? fmtShort(sum(accepted) / accepted.length) : "\u2014", color: "text-gray-400" },
          ];
        case "rejected":
          return [
            { label: "Rejected Value", value: fmt(sum(rejected)), color: "text-red-400" },
            { label: "Rejected", value: String(rejected.length), color: "text-red-400" },
          ];
        case "converted":
          return [
            { label: "Converted Value", value: fmt(sum(converted)), color: "text-indigo-400" },
            { label: "Converted", value: String(converted.length), color: "text-indigo-400" },
          ];
        default: // "all"
          return [
            { label: "Total Estimated", value: fmt(sum(yearFiltered)), color: "text-white" },
            { label: "Accepted", value: fmt(sum(accepted)), color: "text-green-400" },
            { label: "Pending", value: fmt(sum([...drafts, ...sent])), color: "text-blue-400" },
          ];
      }
    }

    // Invoice stats
    const paid = yearFiltered.filter(i => i.status === "paid");
    const sent = yearFiltered.filter(i => i.status === "sent");
    const drafts = yearFiltered.filter(i => i.status === "draft");
    const overdue = yearFiltered.filter(i => i.status === "sent" && i.due_date && isPast(parseISO(i.due_date)));
    const cancelled = yearFiltered.filter(i => i.status === "cancelled" || i.status === "void");

    switch (filterStatus) {
      case "draft":
        return [
          { label: "Draft Value", value: fmt(sum(drafts)), color: "text-gray-300" },
          { label: "Drafts", value: String(drafts.length), color: "text-white" },
          { label: "Avg Value", value: drafts.length ? fmtShort(sum(drafts) / drafts.length) : "\u2014", color: "text-gray-400" },
        ];
      case "sent":
        return [
          { label: "Outstanding", value: fmt(sum(sent)), color: "text-yellow-400" },
          { label: "Overdue", value: overdue.length > 0 ? fmt(sum(overdue)) : "None", color: overdue.length > 0 ? "text-red-400" : "text-green-400" },
          { label: "Sent", value: String(sent.length), color: "text-blue-400" },
        ];
      case "paid": {
        const totalCollected = sum(paid);
        const avg = paid.length ? totalCollected / paid.length : 0;
        return [
          { label: "Collected", value: fmt(totalCollected), color: "text-green-400" },
          { label: "Invoices Paid", value: String(paid.length), color: "text-white" },
          { label: "Avg Invoice", value: paid.length ? fmtShort(avg) : "\u2014", color: "text-gray-400" },
        ];
      }
      case "overdue": {
        let oldestDays = 0;
        for (const inv of overdue) {
          if (inv.due_date) {
            const days = Math.floor((Date.now() - parseISO(inv.due_date).getTime()) / (1000 * 60 * 60 * 24));
            if (days > oldestDays) oldestDays = days;
          }
        }
        return [
          { label: "Overdue Amount", value: fmt(sum(overdue)), color: "text-red-400" },
          { label: "Overdue", value: String(overdue.length), color: "text-red-400" },
          { label: "Oldest", value: overdue.length ? `${oldestDays}d ago` : "\u2014", color: "text-red-300" },
        ];
      }
      case "cancelled":
        return [
          { label: "Cancelled Value", value: fmt(sum(cancelled)), color: "text-gray-400" },
          { label: "Cancelled", value: String(cancelled.length), color: "text-gray-400" },
        ];
      default: // "all"
        return [
          { label: "Total Invoiced", value: fmt(sum(yearFiltered)), color: "text-white" },
          { label: "Collected", value: fmt(sum(paid)), color: "text-green-400" },
          { label: "Outstanding", value: fmt(sum(sent)), color: "text-yellow-400" },
        ];
    }
  }, [yearFiltered, filterStatus, tab]);

  const isInvoiceTab = tab === "invoices";

  return (
    <div className="p-4 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-end gap-2 mb-4">
        <div className="flex items-center gap-2">
          <SortDropdown options={isInvoiceTab ? INV_SORT_OPTIONS : EST_SORT_OPTIONS} activeSort={sort} onSortChange={setSort} />
          <div className="relative">
            <button
              onClick={() => setShowYearDropdown(v => !v)}
              className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium transition-colors"
            >
              <CalendarDays className="w-4 h-4" />
              <span className="max-w-[3rem] truncate">{filterYear === "all" ? "All" : filterYear}</span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {showYearDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowYearDropdown(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[8rem] max-h-60 overflow-y-auto">
                  <button
                    onClick={() => { setFilterYear("all"); setShowYearDropdown(false); }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${filterYear === "all" ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}
                  >
                    All Years
                  </button>
                  {availableYears.map(yr => (
                    <button
                      key={yr}
                      onClick={() => { setFilterYear(yr); setShowYearDropdown(false); }}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${filterYear === yr ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}
                    >
                      {yr}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => { setSelectMode(v => !v); setSelected(new Set()); }}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectMode ? "bg-red-700 text-white" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
          {isInvoiceTab && (
            <button onClick={() => setShowImport(true)} className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-medium transition-colors" title="Import CSV">
              <Upload className="w-4 h-4" />
            </button>
          )}
          <Link
            to={createPageUrl(isInvoiceTab ? "DocumentDetail?type=invoice" : "DocumentDetail?type=estimate")}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New
          </Link>
        </div>
      </div>

      {/* Invoices / Estimates Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1 mb-4">
        <button onClick={() => switchTab("invoices")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${tab === "invoices" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"}`}
        >
          Invoices
        </button>
        <button onClick={() => switchTab("estimates")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${tab === "estimates" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"}`}
        >
          Estimates
        </button>
      </div>

      {/* Bulk select bar */}
      {selectMode && (
        <div className="flex items-center gap-3 mb-4 bg-gray-800 rounded-xl px-4 py-3">
          <button onClick={toggleSelectAll} className="text-indigo-400 text-sm flex items-center gap-1.5">
            {selected.size === filtered.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {selected.size === filtered.length ? "Deselect all" : "Select all"}
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

      {/* Summary Stats — collapsible */}
      <button
        onClick={() => setShowSummary(v => !v)}
        className="w-full flex items-center justify-between bg-gray-800/60 rounded-xl px-4 py-2.5 mb-3 text-sm transition-colors hover:bg-gray-800"
      >
        <span className="text-gray-400 font-medium">Summary</span>
        <div className="flex items-center gap-2">
          {!showSummary && summaryStats[0] && (
            <span className={`text-xs font-semibold ${summaryStats[0].color}`}>{summaryStats[0].value}</span>
          )}
          {showSummary ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
        </div>
      </button>
      {showSummary && (
        <div className={`grid gap-3 mb-4 ${summaryStats.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {summaryStats.map((stat, i) => (
            <div key={i} className="bg-gray-800 rounded-xl p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{stat.label}</p>
              <p className={`text-lg font-bold ${stat.color} truncate`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter pills */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {filters.map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-colors ${
              filterStatus === s ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="bg-gray-800 rounded-xl h-20 animate-pulse" />)}</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="mb-3">No {isInvoiceTab ? "invoices" : "estimates"} found</p>
          <Link to={createPageUrl(isInvoiceTab ? "DocumentDetail?type=invoice" : "DocumentDetail?type=estimate")} className="text-indigo-400 text-sm">
            + Create first {isInvoiceTab ? "invoice" : "estimate"}
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(item => {
            const isOverdue = isInvoiceTab && item.status === "sent" && item.due_date && isPast(parseISO(item.due_date));
            const isSelected = selected.has(item.id);
            const client = clientMap[item.client_id];
            const clientName = client?.name || "";
            const displayStatus = isOverdue ? "overdue" : item.status;
            const inner = (
              <div className={`flex items-center justify-between gap-3 bg-gray-800 rounded-xl p-4 transition-colors ${isSelected ? "ring-2 ring-indigo-500" : ""}`}>
                {selectMode && (
                  <button onClick={() => toggleSelect(item.id)} className="flex-shrink-0 text-indigo-400">
                    {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-gray-600" />}
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${activeStatusColors[displayStatus] || activeStatusColors.draft}`}>
                      {displayStatus}
                    </span>
                    {item.is_locked && <Lock className="w-3 h-3 text-yellow-500" />}
                    {item.status === "converted" && <ArrowRightLeft className="w-3 h-3 text-indigo-400" />}
                    {item.document_number && <span className="text-xs text-gray-500">#{item.document_number}</span>}
                    {!isInvoiceTab && item.valid_until && <span className="text-xs text-gray-500">Until {format(parseISO(item.valid_until), "d MMM")}</span>}
                  </div>
                  <p className="font-semibold text-white truncate">{item.title || clientName}</p>
                  <p className="text-sm text-gray-400 truncate">{clientName}</p>
                  {isInvoiceTab && item.due_date && (
                    <p className="text-xs text-gray-500">Due {format(parseISO(item.due_date), "d MMM yy")}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                  <p className="font-bold text-white">{currencySymbol(item.currency)}{(item.total ?? item.subtotal ?? 0).toFixed(2)}</p>
                  {/* Invoice-specific: Mark Paid button for sent invoices */}
                  {isInvoiceTab && !selectMode && item.status === "sent" && (
                    <button
                      onClick={async (e) => {
                        e.preventDefault(); e.stopPropagation();
                        const today = format(new Date(), "yyyy-MM-dd");
                        await appClient.helpers.recordPayment({
                          document_id: item.id,
                          amount: item.total ?? item.subtotal ?? 0,
                          payment_date: today,
                          notes: "Marked as paid from list",
                        });
                        loadData();
                      }}
                      className="text-[10px] bg-gray-700 hover:bg-green-600/60 text-gray-300 hover:text-green-300 px-2 py-0.5 rounded-full font-medium transition-colors flex items-center gap-1 border border-gray-600 hover:border-green-500/50"
                    >
                      <CheckCircle2 className="w-3 h-3" /> Mark Paid
                    </button>
                  )}
                  {/* Invoice-specific: Paid date for paid invoices */}
                  {isInvoiceTab && !selectMode && item.status === "paid" && (
                    <span className="text-[10px] text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {item.paid_date ? format(parseISO(item.paid_date), "d MMM yy") : "Paid"}
                    </span>
                  )}
                  {!selectMode && <ChevronRight className="w-4 h-4 text-gray-600 mt-1 ml-auto" />}
                </div>
              </div>
            );
            return selectMode ? (
              <div key={item.id}>{inner}</div>
            ) : (
              <Link key={item.id} to={createPageUrl(`DocumentDetail?id=${item.id}`)} className="block active:bg-gray-700">{inner}</Link>
            );
          })}
        </div>
      )}
      {showImport && (
        <InvoiceImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { loadData(); setShowImport(false); }}
        />
      )}
    </div>
  );
}
