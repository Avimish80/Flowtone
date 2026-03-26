import { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Plus, ChevronRight, Upload, Trash2, CheckSquare, Square, CalendarRange, MapPin, Clock } from "lucide-react";
import { format, parseISO } from "date-fns";
import CSVImportModal from "../components/workevent/CSVImportModal";
import { usePageState } from "@/hooks/usePageState";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import SortDropdown from "@/components/SortDropdown";

const EVENT_TYPES = ["Gig", "Lesson", "Session", "Rehearsal", "Tour Day", "Residency", "Practice"];
const STATUSES = ["lead", "confirmed", "completed", "cancelled"];
const STATUS_LABELS = { lead: "Tentative", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" };

const statusColors = {
  lead: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  confirmed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  cancelled: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const SORT_OPTIONS = [
  { key: "date", label: "Date", type: "date" },
  { key: "client_name", label: "Client", type: "text" },
  { key: "event_type", label: "Type", type: "text" },
  { key: "status", label: "Status", type: "text" },
];

export default function WorkEvents() {
  const navigate = useNavigate();
  const location = useLocation();
  const [filterStatus, setFilterStatus] = usePageState("events_filterStatus_v2", "upcoming");
  const [filterType, setFilterType] = usePageState("events_filterType_v2", "all");
  const [sort, setSort] = usePageState("events_sort_v2", { key: "date", direction: "asc" });

  useScrollRestore("work_events");
  const [events, setEvents] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);


  const clientMap = useMemo(() => Object.fromEntries(clients.map(c => [c.id, c])), [clients]);

  const loadEvents = () => {
    Promise.all([
      appClient.entities.WorkEvent.list("-date"),
      appClient.entities.Client.list(),
    ]).then(([evts, cls]) => {
      setEvents(evts);
      setClients(cls);
      setLoading(false);
    });
  };

  useEffect(() => { loadEvents(); }, []);

  // Pre-apply filter from URL param e.g. /WorkEvents?filter=confirmed
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const f = params.get("filter");
    if (f) setFilterStatus(f);
  }, [location.search]);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }, []);

  const filtered = events.filter(e => {
    // Time-based filters
    if (filterStatus === "upcoming") {
      if (e.status === "cancelled") return false;
      if (!e.date || e.date < todayStr) return false;
    } else if (filterStatus === "past") {
      if (!e.date || e.date >= todayStr) return false;
    } else if (filterStatus !== "all" && e.status !== filterStatus) {
      return false;
    }
    if (filterType !== "all" && e.event_type !== filterType) return false;
    return true;
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

  const toggleSelect = (id) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleSelectAll = () => {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(e => e.id)));
  };

  const handleBulkDelete = async () => {
    if (!selected.size) return;
    setDeleting(true);
    await Promise.allSettled([...selected].map(id => appClient.entities.WorkEvent.delete(id)));
    setSelected(new Set()); setSelectMode(false); setDeleting(false); loadEvents();
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      {showImport && (
        <CSVImportModal onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); loadEvents(); }} />
      )}

      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(createPageUrl("CalendarView"))} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-medium transition-colors" title="Switch to calendar view">
            <CalendarRange className="w-4 h-4" />
          </button>
          <SortDropdown options={SORT_OPTIONS} activeSort={sort} onSortChange={setSort} />
          <button onClick={() => { setSelectMode(v => !v); setSelected(new Set()); }} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectMode ? "bg-red-700 text-white" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`}>
            {selectMode ? "Cancel" : "Select"}
          </button>
          <button onClick={() => setShowImport(true)} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-medium transition-colors">
            <Upload className="w-4 h-4" />
          </button>
          <Link to={createPageUrl("WorkEventDetail")} className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> New
          </Link>
        </div>
      </div>

      {selectMode && (
        <div className="flex items-center gap-3 mb-4 bg-gray-800 rounded-xl px-4 py-3">
          <button onClick={toggleSelectAll} className="text-indigo-400 text-sm flex items-center gap-1.5">
            {selected.size === filtered.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {selected.size === filtered.length ? "Deselect all" : "Select all"}
          </button>
          <span className="text-gray-500 text-sm">{selected.size} selected</span>
          {selected.size > 0 && (
            <button onClick={handleBulkDelete} disabled={deleting} className="ml-auto bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> {deleting ? "Deleting..." : `Delete ${selected.size}`}
            </button>
          )}
        </div>
      )}

      {/* Filter dropdowns */}
      <div className="flex gap-3 mb-4">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
        >
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
          <option value="all">All</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
        >
          <option value="all">All Types</option>
          {EVENT_TYPES.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="bg-gray-800 rounded-xl h-20 animate-pulse" />)}</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="mb-3">No events found</p>
          <Link to={createPageUrl("WorkEventDetail")} className="text-indigo-400 text-sm">+ Create your first event</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(event => {
            const isSelected = selected.has(event.id);
            const clientName = clientMap[event.client_id]?.name || "";
            const card = (
              <div className={`flex items-center gap-3 bg-gray-800 rounded-xl p-4 transition-colors ${isSelected ? "ring-2 ring-indigo-500" : ""}`}>
                {selectMode && (
                  <button onClick={() => toggleSelect(event.id)} className="flex-shrink-0 text-indigo-400">
                    {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-gray-600" />}
                  </button>
                )}
                {/* Date column */}
                {event.date && (
                  <div className="flex-shrink-0 w-11 text-center">
                    <p className="text-[10px] text-gray-500 uppercase">{format(parseISO(event.date), "EEE")}</p>
                    <p className="text-lg font-bold text-white leading-tight">{format(parseISO(event.date), "d")}</p>
                    <p className="text-[10px] text-gray-500">{format(parseISO(event.date), "MMM")}</p>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${statusColors[event.status]}`}>{STATUS_LABELS[event.status] || event.status}</span>
                    <span className="text-[10px] text-gray-500">{event.event_type}</span>
                    {event.is_recurring && <span className="text-[10px] text-indigo-400/70">{"\u21BB"}</span>}
                  </div>
                  <p className="font-semibold text-white truncate text-sm">{event.title}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                    {clientName && <span>{clientName}</span>}
                    {(event.start_time || event.time) && (
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />
                        {event.start_time
                          ? `${event.start_time}${event.end_time ? `–${event.end_time}` : ""}`
                          : event.time}
                      </span>
                    )}
                  </div>
                  {event.location_address && (
                    <p className="flex items-center gap-1 mt-1 text-[11px] text-gray-500 truncate">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      {event.location_address}
                    </p>
                  )}
                </div>
                {!selectMode && <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0" />}
              </div>
            );
            return selectMode ? (
              <div key={event.id}>{card}</div>
            ) : (
              <Link key={event.id} to={createPageUrl(`WorkEventDetail?id=${event.id}`)} className="block active:bg-gray-700">{card}</Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
