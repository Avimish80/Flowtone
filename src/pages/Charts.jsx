import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { createPageUrl } from "@/utils";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import {
  Music, Plus, Search, Mic2, StickyNote, ChevronRight, X
} from "lucide-react";

const TYPE_CONFIG = {
  chart:  { label: "Chart",  icon: Music,     color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  lyrics: { label: "Lyrics", icon: Mic2,      color: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
  notes:  { label: "Notes",  icon: StickyNote, color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
};

const MUSIC_KEYS = [
  "C","C#/Db","D","D#/Eb","E","F","F#/Gb","G","G#/Ab","A","A#/Bb","B",
];

const FILTERS = [
  { key: "all",    label: "All" },
  { key: "chart",  label: "Charts" },
  { key: "lyrics", label: "Lyrics" },
  { key: "notes",  label: "Notes" },
];

export default function Charts() {
  useScrollRestore("charts");
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    appClient.entities.Chart.list()
      .then(data => { setCharts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = charts;
    if (filter !== "all") list = list.filter(c => c.chart_type === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        (c.title || "").toLowerCase().includes(q) ||
        (c.genre || "").toLowerCase().includes(q) ||
        (c.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    return list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }, [charts, filter, search]);

  // Count by type
  const counts = useMemo(() => ({
    all: charts.length,
    chart: charts.filter(c => c.chart_type === "chart").length,
    lyrics: charts.filter(c => c.chart_type === "lyrics").length,
    notes: charts.filter(c => c.chart_type === "notes").length,
  }), [charts]);

  return (
    <div className="max-w-xl mx-auto px-4 pt-4 pb-6">
      {/* Header */}
      <div className="flex items-center justify-end mb-5">
        <Link
          to={createPageUrl("ChartDetail")}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> New
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-9 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          placeholder="Search title, genre, tags…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              filter === f.key
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
            }`}
          >
            {f.label}
            <span className={`ml-1.5 text-xs ${filter === f.key ? "text-indigo-200" : "text-gray-600"}`}>
              {counts[f.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Music className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">
            {search ? "No results found" : "No items yet"}
          </p>
          <p className="text-sm text-gray-600 mt-1">
            {search ? "Try a different search" : "Tap + New to add your first chart, lyrics, or notes"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(chart => {
            const cfg = TYPE_CONFIG[chart.chart_type] || TYPE_CONFIG.chart;
            const Icon = cfg.icon;
            return (
              <Link
                key={chart.id}
                to={createPageUrl(`ChartDetail?id=${chart.id}`)}
                className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3 hover:bg-gray-700/80 transition-colors group"
              >
                {/* Type icon */}
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border ${cfg.color}`}>
                  <Icon className="w-4 h-4" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-white text-sm truncate">{chart.title || "Untitled"}</p>
                    {chart.key && (
                      <span className="text-[10px] font-bold text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded uppercase">
                        {chart.key}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {chart.genre && (
                      <span className="text-xs text-gray-500">{chart.genre}</span>
                    )}
                    {chart.tempo && (
                      <span className="text-xs text-gray-600">♩={chart.tempo}</span>
                    )}
                    {(chart.tags || []).slice(0, 3).map(tag => (
                      <span key={tag} className="text-[10px] text-gray-500 bg-gray-700/60 px-1.5 py-0.5 rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Indicators */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {(chart.file_url || chart.external_url) && (
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" title="Has file" />
                  )}
                  {chart.content && (
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" title="Has content" />
                  )}
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
