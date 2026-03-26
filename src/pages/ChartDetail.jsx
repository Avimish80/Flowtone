import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { createPageUrl } from "@/utils";
import { useGoBack } from "@/hooks/useGoBack";
import {
  ArrowLeft, Save, Trash2, Music, Mic2, StickyNote, Upload,
  Link2, X, Plus, ExternalLink, FileText, Check
} from "lucide-react";

const CHART_TYPES = [
  { value: "chart",  label: "Chart",  desc: "Lead sheet, chord chart, sheet music" },
  { value: "lyrics", label: "Lyrics", desc: "Song text, words with or without chords" },
  { value: "notes",  label: "Notes",  desc: "Arrangement notes, session briefings" },
];

const MUSIC_KEYS = [
  "C", "C#", "Db", "D", "D#", "Eb", "E", "F",
  "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B",
];

const FEELS = [
  "Swing", "Bossa Nova", "Ballad", "Latin", "Funk",
  "Rock", "Blues", "Waltz", "Samba", "Straight",
];

const labelCls = "text-xs text-gray-400 mb-1 block";
const inputCls = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 placeholder-gray-500";

export default function ChartDetail() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const navigate = useNavigate();
  const goBack = useGoBack("Charts");
  const fileInputRef = useRef(null);

  const emptyChart = {
    title: "", chart_type: "chart", key: "", tempo: "", feel: "",
    genre: "", tags: [], content: "", file_url: "", file_name: "",
    file_type: "", external_url: "", notes: "",
  };

  const [chart, setChart] = useState(emptyChart);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [events, setEvents] = useState([]);
  const [linkedEvents, setLinkedEvents] = useState([]);

  useEffect(() => {
    const promises = [appClient.entities.WorkEvent.list("-date")];
    if (id) promises.push(appClient.entities.Chart.filter({ id }));
    Promise.all(promises).then(([evts, charts]) => {
      setEvents(evts || []);
      if (charts?.[0]) {
        const c = charts[0];
        setChart(c);
        // Load linked events
        const ids = c.linked_event_ids || [];
        setLinkedEvents(evts.filter(e => ids.includes(e.id)));
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const onChange = (field, value) => setChart(prev => ({ ...prev, [field]: value }));

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("File must be under 5 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      setChart(prev => ({
        ...prev,
        file_url: ev.target.result,
        file_name: file.name,
        file_type: file.type,
      }));
    };
    reader.readAsDataURL(file);
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || (chart.tags || []).includes(tag)) { setTagInput(""); return; }
    onChange("tags", [...(chart.tags || []), tag]);
    setTagInput("");
  };

  const removeTag = (tag) => onChange("tags", (chart.tags || []).filter(t => t !== tag));

  const toggleEvent = (evt) => {
    const ids = chart.linked_event_ids || [];
    const newIds = ids.includes(evt.id) ? ids.filter(i => i !== evt.id) : [...ids, evt.id];
    onChange("linked_event_ids", newIds);
    setLinkedEvents(events.filter(e => newIds.includes(e.id)));
  };

  const handleSave = async () => {
    if (!chart.title?.trim()) return;
    setSaving(true);
    try {
      if (id) {
        await appClient.entities.Chart.update(id, chart);
      } else {
        const created = await appClient.entities.Chart.create(chart);
        navigate(createPageUrl(`ChartDetail?id=${created.id}`), { replace: true });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Save error:", err);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await appClient.entities.Chart.delete(id);
      navigate(createPageUrl("Charts"));
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  if (loading) return <div className="p-4 text-gray-400">Loading…</div>;

  const isNew = !id;

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 sticky top-0 z-20 border-b border-gray-800">
        <button onClick={goBack} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="flex-1 font-semibold text-white truncate">
          {chart.title || (isNew ? "New Item" : "Edit Item")}
        </h1>
        <div className="flex items-center gap-2">
          {id && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !chart.title?.trim()}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
              saved ? "bg-green-600 text-white" : "bg-indigo-600 hover:bg-indigo-500 text-white"
            }`}
          >
            {saved ? <><Check className="w-4 h-4" /> Saved</> : <><Save className="w-4 h-4" /> Save</>}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Delete confirm */}
        {confirmDelete && (
          <div className="bg-red-950/40 border border-red-700/40 rounded-xl p-4 space-y-3">
            <p className="text-sm text-red-300">Delete this item permanently?</p>
            <div className="flex gap-2">
              <button onClick={handleDelete} className="flex-1 bg-red-600 hover:bg-red-500 text-white rounded-lg py-2 text-sm font-medium transition-colors">Delete</button>
              <button onClick={() => setConfirmDelete(false)} className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-4 py-2 text-sm transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {/* Type selector */}
        <div>
          <label className={labelCls}>Type</label>
          <div className="grid grid-cols-3 gap-2">
            {CHART_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => onChange("chart_type", t.value)}
                className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-center transition-colors ${
                  chart.chart_type === t.value
                    ? "border-indigo-500 bg-indigo-600/15 text-indigo-300"
                    : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
                }`}
              >
                {t.value === "chart" && <Music className="w-4 h-4" />}
                {t.value === "lyrics" && <Mic2 className="w-4 h-4" />}
                {t.value === "notes" && <StickyNote className="w-4 h-4" />}
                <span className="text-xs font-medium">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className={labelCls}>Title *</label>
          <input
            className={inputCls}
            placeholder={chart.chart_type === "lyrics" ? "Song title" : chart.chart_type === "notes" ? "Note title" : "Chart title"}
            value={chart.title || ""}
            onChange={e => onChange("title", e.target.value)}
            autoFocus={isNew}
          />
        </div>

        {/* Musical details — only relevant for charts */}
        {chart.chart_type === "chart" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Key</label>
              <select className={inputCls} value={chart.key || ""} onChange={e => onChange("key", e.target.value)}>
                <option value="">— Key —</option>
                {MUSIC_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Tempo (BPM)</label>
              <input type="number" className={inputCls} placeholder="120" value={chart.tempo || ""} onChange={e => onChange("tempo", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Feel / Style</label>
              <select className={inputCls} value={chart.feel || ""} onChange={e => onChange("feel", e.target.value)}>
                <option value="">— Feel —</option>
                {FEELS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Genre</label>
              <input className={inputCls} placeholder="Jazz, Pop, Classical…" value={chart.genre || ""} onChange={e => onChange("genre", e.target.value)} />
            </div>
          </div>
        )}

        {/* Genre for lyrics/notes */}
        {chart.chart_type !== "chart" && (
          <div>
            <label className={labelCls}>Genre / Style</label>
            <input className={inputCls} placeholder="Jazz, Pop, Soul…" value={chart.genre || ""} onChange={e => onChange("genre", e.target.value)} />
          </div>
        )}

        {/* Tags */}
        <div>
          <label className={labelCls}>Tags</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(chart.tags || []).map(tag => (
              <span key={tag} className="flex items-center gap-1 text-xs bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                {tag}
                <button onClick={() => removeTag(tag)} className="hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className={inputCls + " flex-1"}
              placeholder="Add tag (e.g. standard, original, wedding)…"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            />
            <button onClick={addTag} disabled={!tagInput.trim()} className="bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white px-3 rounded-lg transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* File / Content section */}
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Content</p>

          {/* File upload */}
          <div>
            <label className={labelCls}>Upload File (PDF, image)</label>
            {chart.file_url ? (
              <div className="flex items-center gap-3 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                <span className="text-sm text-gray-300 flex-1 truncate">{chart.file_name || "Uploaded file"}</span>
                <button onClick={() => onChange("file_url", "")} className="text-gray-500 hover:text-red-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-700 hover:border-indigo-500/50 rounded-xl py-4 flex flex-col items-center gap-1.5 text-gray-500 hover:text-gray-400 transition-colors"
              >
                <Upload className="w-5 h-5" />
                <span className="text-xs">Click to upload PDF or image · max 5 MB</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileUpload} />
          </div>

          {/* Google Drive / Dropbox link */}
          <div>
            <label className={labelCls}>Or link from Google Drive / Dropbox</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  className={inputCls + " pl-9"}
                  placeholder="Paste Drive or Dropbox URL…"
                  value={chart.external_url || ""}
                  onChange={e => onChange("external_url", e.target.value)}
                />
              </div>
              {chart.external_url && (
                <a href={chart.external_url} target="_blank" rel="noreferrer"
                  className="bg-gray-700 hover:bg-gray-600 text-white px-3 rounded-lg flex items-center transition-colors">
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>

          {/* Plain text content (lyrics / notes) */}
          {(chart.chart_type === "lyrics" || chart.chart_type === "notes") && (
            <div>
              <label className={labelCls}>
                {chart.chart_type === "lyrics" ? "Lyrics / Words" : "Notes"}
              </label>
              <textarea
                className={inputCls + " h-40 resize-none leading-relaxed"}
                placeholder={chart.chart_type === "lyrics" ? "Type or paste lyrics here…" : "Type arrangement notes, cues, or instructions…"}
                value={chart.content || ""}
                onChange={e => onChange("content", e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Linked Gigs */}
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Linked Gigs</p>
          <p className="text-xs text-gray-500">Link this to upcoming events — useful for building setlists.</p>

          {linkedEvents.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {linkedEvents.map(evt => (
                <div key={evt.id} className="flex items-center gap-2 bg-indigo-600/10 border border-indigo-500/20 rounded-lg px-3 py-2">
                  <span className="flex-1 text-sm text-indigo-300 truncate">{evt.title}</span>
                  <span className="text-xs text-gray-500">{evt.date}</span>
                  <button onClick={() => toggleEvent(evt)} className="text-gray-500 hover:text-red-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <select
            className={inputCls}
            value=""
            onChange={e => {
              if (!e.target.value) return;
              const evt = events.find(ev => ev.id === e.target.value);
              if (evt) toggleEvent(evt);
              e.target.value = "";
            }}
          >
            <option value="">+ Link a gig…</option>
            {events
              .filter(e => !(chart.linked_event_ids || []).includes(e.id))
              .map(e => (
                <option key={e.id} value={e.id}>
                  {e.title} {e.date ? `· ${e.date}` : ""}
                </option>
              ))
            }
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className={labelCls}>Additional Notes</label>
          <textarea
            className={inputCls + " h-20 resize-none"}
            placeholder="Any extra notes about this item…"
            value={chart.notes || ""}
            onChange={e => onChange("notes", e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
