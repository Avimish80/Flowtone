import { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import { format, parseISO, differenceInCalendarDays, subDays, startOfMonth, endOfMonth } from "date-fns";
import {
  Dumbbell, Plus, Check, X, ChevronDown, ChevronUp,
  Flame, Target, Clock, CalendarDays, Trash2,
  Music, Brain, Mic2, Eye, Calendar, ArrowRight, Guitar
} from "lucide-react";

// ── Constants ────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: "technique",    label: "Technique",     icon: Dumbbell, color: "text-orange-400" },
  { value: "repertoire",   label: "Repertoire",    icon: Music,    color: "text-indigo-400" },
  { value: "theory",       label: "Theory",        icon: Brain,    color: "text-purple-400" },
  { value: "performance",  label: "Performance",   icon: Mic2,     color: "text-pink-400" },
  { value: "sight_reading",label: "Sight-Reading", icon: Eye,      color: "text-cyan-400" },
];

const ENERGY = [
  { value: 1, label: "😴 Low" },
  { value: 2, label: "😐 Okay" },
  { value: 3, label: "😊 Good" },
  { value: 4, label: "💪 Great" },
  { value: 5, label: "🔥 On Fire" },
];

const labelCls = "text-xs text-gray-400 mb-1 block";
const inputCls  = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 placeholder-gray-500";
const today     = format(new Date(), "yyyy-MM-dd");

// ── Helpers ──────────────────────────────────────────────────────────

function calcStreak(sessions) {
  if (!sessions.length) return 0;
  const dates = [...new Set(sessions.map(s => s.date))].sort().reverse();
  let streak = 0;
  let cursor = today;
  for (const d of dates) {
    const diff = differenceInCalendarDays(parseISO(cursor), parseISO(d));
    if (diff === 0 || diff === 1) { streak++; cursor = d; }
    else break;
  }
  return streak;
}

function calcMonthMinutes(sessions) {
  const now = new Date();
  const start = format(startOfMonth(now), "yyyy-MM-dd");
  const end   = format(endOfMonth(now),   "yyyy-MM-dd");
  return sessions
    .filter(s => s.date >= start && s.date <= end)
    .reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
}

function fmtDuration(mins) {
  if (!mins) return "0 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function CategoryBadge({ value }) {
  const cat = CATEGORIES.find(c => c.value === value);
  if (!cat) return null;
  const Icon = cat.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-700/80 ${cat.color}`}>
      <Icon className="w-2.5 h-2.5" /> {cat.label}
    </span>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export default function Practice() {
  const navigate = useNavigate();
  const [sessions,  setSessions]  = useState([]);
  const [goals,     setGoals]     = useState([]);
  const [charts,    setCharts]    = useState([]);
  const [gigs,      setGigs]      = useState([]); // upcoming work events for "preparing for" link
  const [upcoming,  setUpcoming]  = useState([]); // scheduled Practice WorkEvents in the future
  const [loading,   setLoading]   = useState(true);

  // UI state
  const [view,      setView]      = useState("hub"); // "hub" | "log" | "goal"
  const [expandGoals,    setExpandGoals]    = useState(true);
  const [expandUpcoming, setExpandUpcoming] = useState(true);
  const [expandSessions, setExpandSessions] = useState(true);

  // ── Log Session form ────────────────────────────────────────────
  const emptySession = {
    date: today,
    duration_minutes: 60,
    items: [],
    session_notes: "",
    energy_rating: 3,
    goal_id: "",
    linked_gig_id: "",
  };
  const emptyItem = { title: "", category: "technique", duration_minutes: 15, chart_id: "", notes: "" };
  const [sessionForm, setSessionForm] = useState(emptySession);
  const [newItem, setNewItem] = useState(emptyItem);
  const [savingSession, setSavingSession] = useState(false);

  // ── New Goal form ────────────────────────────────────────────────
  const emptyGoal = { title: "", category: "repertoire", chart_id: "", target_date: "", notes: "" };
  const [goalForm, setGoalForm] = useState(emptyGoal);
  const [savingGoal, setSavingGoal] = useState(false);

  // Load data
  useEffect(() => {
    Promise.all([
      appClient.entities.PracticeSession.list("-date"),
      appClient.entities.PracticeGoal.list(),
      appClient.entities.Chart.list(),
      appClient.entities.WorkEvent.list("date", 500),
    ]).then(([s, g, c, events]) => {
      setSessions(s);
      setGoals(g);
      setCharts(c);
      // Upcoming scheduled Practice events (future, not yet logged)
      const futurePractice = events
        .filter(e => e.event_type === "Practice" && e.date >= today && !e.practice_logged)
        .sort((a, b) => a.date.localeCompare(b.date));
      setUpcoming(futurePractice);
      // Other upcoming gigs/rehearsals for "preparing for" link
      const upcomingGigs = events
        .filter(e => e.event_type !== "Practice" && e.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 30);
      setGigs(upcomingGigs);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // ── Stats ────────────────────────────────────────────────────────
  const streak      = useMemo(() => calcStreak(sessions), [sessions]);
  const monthMins   = useMemo(() => calcMonthMinutes(sessions), [sessions]);
  const activeGoals = useMemo(() => goals.filter(g => !g.completed), [goals]);
  const doneGoals   = useMemo(() => goals.filter(g => g.completed), [goals]);
  const recentSessions = useMemo(() => sessions.slice(0, 5), [sessions]);

  // ── Contribution grid (last 35 days) ────────────────────────────
  const grid = useMemo(() => {
    const days = [];
    for (let i = 34; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "yyyy-MM-dd");
      const mins = sessions.filter(s => s.date === d).reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
      days.push({ date: d, mins });
    }
    return days;
  }, [sessions]);

  // ── Session form handlers ────────────────────────────────────────
  const addItem = () => {
    if (!newItem.title.trim()) return;
    setSessionForm(prev => ({ ...prev, items: [...prev.items, { ...newItem }] }));
    setNewItem(emptyItem);
  };

  const removeItem = (idx) => setSessionForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));

  const saveSession = async () => {
    if (!sessionForm.items.length && !sessionForm.session_notes?.trim()) return;
    setSavingSession(true);
    try {
      const created = await appClient.entities.PracticeSession.create({
        ...sessionForm,
        duration_minutes: Number(sessionForm.duration_minutes) || 0,
      });
      setSessions(prev => [created, ...prev]);
      setSessionForm(emptySession);
      setView("hub");
    } catch (err) { console.error(err); }
    setSavingSession(false);
  };

  const deleteSession = async (id) => {
    try {
      await appClient.entities.PracticeSession.delete(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (err) { console.error(err); }
  };

  // ── Goal handlers ────────────────────────────────────────────────
  const saveGoal = async () => {
    if (!goalForm.title.trim()) return;
    setSavingGoal(true);
    try {
      const created = await appClient.entities.PracticeGoal.create({ ...goalForm, completed: false });
      setGoals(prev => [created, ...prev]);
      setGoalForm(emptyGoal);
      setView("hub");
    } catch (err) { console.error(err); }
    setSavingGoal(false);
  };

  const toggleGoal = async (goal) => {
    try {
      const updated = await appClient.entities.PracticeGoal.update(goal.id, {
        completed: !goal.completed,
        completed_date: !goal.completed ? today : "",
      });
      setGoals(prev => prev.map(g => g.id === goal.id ? updated : g));
    } catch (err) { console.error(err); }
  };

  const deleteGoal = async (id) => {
    try {
      await appClient.entities.PracticeGoal.delete(id);
      setGoals(prev => prev.filter(g => g.id !== id));
    } catch (err) { console.error(err); }
  };

  if (loading) return <div className="p-4 text-gray-400">Loading…</div>;

  // ═══════════════════════════════════════════════════════════════
  // LOG SESSION VIEW
  // ═══════════════════════════════════════════════════════════════
  if (view === "log") return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 sticky top-0 z-20 border-b border-gray-800">
        <button onClick={() => setView("hub")} className="text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
        <h1 className="flex-1 font-semibold text-white">Log a Practice Session</h1>
        <button
          onClick={saveSession}
          disabled={savingSession || (!sessionForm.items.length && !sessionForm.session_notes?.trim())}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors"
        >
          <Check className="w-4 h-4" /> Save
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Date + Duration */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" className={inputCls} value={sessionForm.date}
              onChange={e => setSessionForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Total Duration (min)</label>
            <input type="number" className={inputCls} min="1" value={sessionForm.duration_minutes}
              onChange={e => setSessionForm(p => ({ ...p, duration_minutes: e.target.value }))} />
          </div>
        </div>

        {/* Goal + Gig links */}
        <div className="grid grid-cols-1 gap-3">
          {goals.filter(g => !g.completed).length > 0 && (
            <div>
              <label className={labelCls + " flex items-center gap-1"}><Target className="w-3 h-3" /> Linked Goal (optional)</label>
              <select className={inputCls} value={sessionForm.goal_id}
                onChange={e => setSessionForm(p => ({ ...p, goal_id: e.target.value }))}>
                <option value="">— No goal —</option>
                {goals.filter(g => !g.completed).map(g => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            </div>
          )}
          {gigs.length > 0 && (
            <div>
              <label className={labelCls + " flex items-center gap-1"}><Guitar className="w-3 h-3" /> Preparing for (optional)</label>
              <select className={inputCls} value={sessionForm.linked_gig_id}
                onChange={e => setSessionForm(p => ({ ...p, linked_gig_id: e.target.value }))}>
                <option value="">— No gig linked —</option>
                {gigs.map(g => (
                  <option key={g.id} value={g.id}>{g.title} · {g.date}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Energy */}
        <div>
          <label className={labelCls}>Session Energy</label>
          <div className="flex gap-2 flex-wrap">
            {ENERGY.map(e => (
              <button key={e.value} onClick={() => setSessionForm(p => ({ ...p, energy_rating: e.value }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  sessionForm.energy_rating === e.value
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                }`}>
                {e.label}
              </button>
            ))}
          </div>
        </div>

        {/* Practice items */}
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">What I Practiced</p>

          {sessionForm.items.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2 bg-gray-900 rounded-lg px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium">{item.title}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <CategoryBadge value={item.category} />
                  <span className="text-xs text-gray-500">{item.duration_minutes} min</span>
                  {item.chart_id && (
                    <span className="text-xs text-indigo-400">
                      {charts.find(c => c.id === item.chart_id)?.title || "Chart"}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => removeItem(idx)} className="text-gray-600 hover:text-red-400 mt-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          {/* Add item */}
          <div className="border border-gray-700 rounded-xl p-3 space-y-2">
            <input className={inputCls} placeholder="What did you practice? (e.g. Major scales, Giant Steps…)"
              value={newItem.title} onChange={e => setNewItem(p => ({ ...p, title: e.target.value }))}
              onKeyDown={e => { if (e.key === "Enter") addItem(); }} />
            <div className="grid grid-cols-2 gap-2">
              <select className={inputCls} value={newItem.category} onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input type="number" className={inputCls} placeholder="Minutes" min="1" value={newItem.duration_minutes}
                onChange={e => setNewItem(p => ({ ...p, duration_minutes: e.target.value }))} />
            </div>
            {charts.length > 0 && (
              <select className={inputCls} value={newItem.chart_id} onChange={e => setNewItem(p => ({ ...p, chart_id: e.target.value }))}>
                <option value="">Link to chart (optional)</option>
                {charts.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
            <button onClick={addItem} disabled={!newItem.title.trim()}
              className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white py-2 rounded-lg text-sm flex items-center justify-center gap-1.5 transition-colors">
              <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className={labelCls}>Session Notes</label>
          <textarea className={inputCls + " h-24 resize-none"} placeholder="Observations, breakthroughs, things to focus on next time…"
            value={sessionForm.session_notes}
            onChange={e => setSessionForm(p => ({ ...p, session_notes: e.target.value }))} />
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════
  // NEW GOAL VIEW
  // ═══════════════════════════════════════════════════════════════
  if (view === "goal") return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 sticky top-0 z-20 border-b border-gray-800">
        <button onClick={() => setView("hub")} className="text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
        <h1 className="flex-1 font-semibold text-white">New Practice Goal</h1>
        <button onClick={saveGoal} disabled={savingGoal || !goalForm.title.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors">
          <Check className="w-4 h-4" /> Save
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <label className={labelCls}>Goal *</label>
          <input className={inputCls} placeholder="e.g. Learn Autumn Leaves in all 12 keys"
            value={goalForm.title} onChange={e => setGoalForm(p => ({ ...p, title: e.target.value }))} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Category</label>
            <select className={inputCls} value={goalForm.category} onChange={e => setGoalForm(p => ({ ...p, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Target Date</label>
            <input type="date" className={inputCls} value={goalForm.target_date}
              onChange={e => setGoalForm(p => ({ ...p, target_date: e.target.value }))} />
          </div>
        </div>
        {charts.length > 0 && (
          <div>
            <label className={labelCls}>Linked Chart (optional)</label>
            <select className={inputCls} value={goalForm.chart_id} onChange={e => setGoalForm(p => ({ ...p, chart_id: e.target.value }))}>
              <option value="">— None —</option>
              {charts.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={labelCls}>Notes</label>
          <textarea className={inputCls + " h-20 resize-none"} placeholder="What does achieving this goal look like?"
            value={goalForm.notes} onChange={e => setGoalForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════
  // HUB VIEW (main)
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="max-w-xl mx-auto px-4 pt-4 pb-6">
      {/* Header */}
      <div className="flex items-center justify-end mb-5">
        <div className="flex gap-2">
          <button onClick={() => { setGoalForm(emptyGoal); setView("goal"); }}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors">
            <Target className="w-3.5 h-3.5" /> Goal
          </button>
          <button onClick={() => { setSessionForm(emptySession); setView("log"); }}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors">
            <Check className="w-3.5 h-3.5" /> Log
          </button>
          <button onClick={() => navigate(createPageUrl(`WorkEventDetail?event_type=Practice`))}
            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-500 text-white px-3 py-1.5 rounded-xl text-sm font-medium transition-colors">
            <Calendar className="w-3.5 h-3.5" /> Schedule
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Flame className={`w-4 h-4 ${streak > 0 ? "text-orange-400" : "text-gray-600"}`} />
          </div>
          <p className={`text-2xl font-bold ${streak > 0 ? "text-orange-400" : "text-gray-600"}`}>{streak}</p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">Day Streak</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-2xl font-bold text-indigo-400">{Math.round(monthMins / 60)}<span className="text-sm font-normal">h</span></p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">This Month</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Target className="w-4 h-4 text-green-400" />
          </div>
          <p className="text-2xl font-bold text-green-400">{activeGoals.length}</p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">Active Goals</p>
        </div>
      </div>

      {/* Contribution grid */}
      <div className="bg-gray-800 rounded-xl p-4 mb-5">
        <p className="text-xs text-gray-500 mb-3 uppercase tracking-wide font-medium">Last 35 Days</p>
        <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(35, 1fr)" }}>
          {grid.map((day, i) => {
            let bg = "bg-gray-700";
            if (day.mins >= 120) bg = "bg-indigo-500";
            else if (day.mins >= 60)  bg = "bg-indigo-600/70";
            else if (day.mins >= 30)  bg = "bg-indigo-700/60";
            else if (day.mins > 0)    bg = "bg-indigo-800/60";
            const isToday = day.date === today;
            return (
              <div key={i} title={`${day.date}: ${fmtDuration(day.mins)}`}
                className={`aspect-square rounded-sm ${bg} ${isToday ? "ring-1 ring-white/40" : ""}`} />
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 mt-2 justify-end">
          <span className="text-[10px] text-gray-600">Less</span>
          {["bg-gray-700","bg-indigo-800/60","bg-indigo-700/60","bg-indigo-600/70","bg-indigo-500"].map((c,i) => (
            <div key={i} className={`w-2.5 h-2.5 rounded-sm ${c}`} />
          ))}
          <span className="text-[10px] text-gray-600">More</span>
        </div>
      </div>

      {/* Goals */}
      <div className="bg-gray-800 rounded-xl overflow-hidden mb-4">
        <button
          onClick={() => setExpandGoals(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-green-400" />
            <span className="text-sm font-semibold text-white">Goals</span>
            {activeGoals.length > 0 && (
              <span className="text-xs bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full font-medium">
                {activeGoals.length} active
              </span>
            )}
          </div>
          {expandGoals ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </button>

        {expandGoals && (
          <div className="px-4 pb-4 space-y-2">
            {goals.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No goals yet — tap "Goal" to add one.</p>
            ) : (
              <>
                {/* Active goals */}
                {activeGoals.map(g => {
                  const linkedChart = g.chart_id ? charts.find(c => c.id === g.chart_id) : null;
                  return (
                    <div key={g.id} className="flex items-start gap-3 bg-gray-900 rounded-xl px-3 py-3">
                      <button onClick={() => toggleGoal(g)}
                        className="w-5 h-5 rounded-full border-2 border-gray-600 hover:border-green-400 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium leading-snug">{g.title}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <CategoryBadge value={g.category} />
                          {linkedChart && <span className="text-xs text-indigo-400">{linkedChart.title}</span>}
                          {g.target_date && (
                            <span className="text-xs text-gray-500">by {g.target_date}</span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => deleteGoal(g.id)} className="text-gray-700 hover:text-red-400 flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}

                {/* Completed goals (collapsed) */}
                {doneGoals.length > 0 && (
                  <div className="pt-1 border-t border-gray-700">
                    <p className="text-xs text-gray-600 mb-2">{doneGoals.length} completed</p>
                    {doneGoals.map(g => (
                      <div key={g.id} className="flex items-center gap-3 px-3 py-2 opacity-50">
                        <button onClick={() => toggleGoal(g)}
                          className="w-5 h-5 rounded-full bg-green-500/30 border-2 border-green-500 flex items-center justify-center flex-shrink-0">
                          <Check className="w-3 h-3 text-green-400" />
                        </button>
                        <p className="text-sm text-gray-400 line-through flex-1">{g.title}</p>
                        <button onClick={() => deleteGoal(g.id)} className="text-gray-700 hover:text-red-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Upcoming Scheduled Practice Sessions */}
      {upcoming.length > 0 && (
        <div className="bg-gray-800 rounded-xl overflow-hidden mb-4">
          <button
            onClick={() => setExpandUpcoming(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-semibold text-white">Coming Up</span>
              <span className="text-xs bg-teal-500/20 text-teal-400 border border-teal-500/30 px-1.5 py-0.5 rounded-full font-medium">
                {upcoming.length}
              </span>
            </div>
            {expandUpcoming ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
          </button>

          {expandUpcoming && (
            <div className="px-4 pb-4 space-y-2">
              {upcoming.map(ev => {
                const linkedGoal = ev.practice_goal_id ? goals.find(g => g.id === ev.practice_goal_id) : null;
                const daysUntil  = differenceInCalendarDays(parseISO(ev.date), parseISO(today));
                return (
                  <button
                    key={ev.id}
                    onClick={() => navigate(createPageUrl(`WorkEventDetail?id=${ev.id}`))}
                    className="w-full text-left bg-gray-900 rounded-xl px-3 py-3 flex items-start gap-3 hover:bg-gray-800 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-teal-900/40 border border-teal-700/40 flex-shrink-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] text-teal-400 font-medium leading-none">
                        {format(parseISO(ev.date), "MMM").toUpperCase()}
                      </span>
                      <span className="text-sm font-bold text-teal-300 leading-tight">
                        {format(parseISO(ev.date), "d")}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{ev.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-gray-500">
                          {daysUntil === 0 ? "Today" : daysUntil === 1 ? "Tomorrow" : `In ${daysUntil} days`}
                        </span>
                        {ev.start_time && (
                          <span className="text-xs text-gray-500">· {ev.start_time}{ev.end_time ? `–${ev.end_time}` : ""}</span>
                        )}
                        {(ev.duration_hours || ev.practice_plan) && (
                          <span className="text-xs text-teal-500">
                            {ev.duration_hours ? `${ev.duration_hours}h planned` : ""}
                          </span>
                        )}
                        {linkedGoal && (
                          <span className="text-xs text-green-400 flex items-center gap-0.5">
                            <Target className="w-2.5 h-2.5" />{linkedGoal.title}
                          </span>
                        )}
                      </div>
                      {ev.practice_plan && (
                        <p className="text-xs text-gray-500 mt-1 truncate">{ev.practice_plan}</p>
                      )}
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-600 flex-shrink-0 mt-1" />
                  </button>
                );
              })}

              {/* Quick-add a new scheduled session */}
              <button
                onClick={() => navigate(createPageUrl(`WorkEventDetail?date=${today}&event_type=Practice`))}
                className="w-full flex items-center justify-center gap-2 border border-dashed border-teal-700/50 text-teal-500 hover:border-teal-500 hover:text-teal-400 rounded-xl py-2.5 text-sm transition-colors"
              >
                <Plus className="w-4 h-4" /> Schedule Another Session
              </button>
            </div>
          )}
        </div>
      )}

      {/* No upcoming — show schedule CTA */}
      {upcoming.length === 0 && (
        <button
          onClick={() => navigate(createPageUrl(`WorkEventDetail?date=${today}&event_type=Practice`))}
          className="w-full flex items-center gap-3 bg-teal-900/20 border border-dashed border-teal-700/40 hover:border-teal-600 rounded-xl px-4 py-3 mb-4 text-left transition-colors group"
        >
          <div className="w-8 h-8 rounded-lg bg-teal-900/50 flex items-center justify-center flex-shrink-0 group-hover:bg-teal-900">
            <Calendar className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-teal-300">Schedule a Practice Session</p>
            <p className="text-xs text-gray-500">Plan your next session on the calendar</p>
          </div>
          <ArrowRight className="w-4 h-4 text-teal-600 group-hover:text-teal-400" />
        </button>
      )}

      {/* Recent Sessions */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setExpandSessions(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-semibold text-white">Recent Sessions</span>
            <span className="text-xs text-gray-600">{sessions.length} total</span>
          </div>
          {expandSessions ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </button>

        {expandSessions && (
          <div className="px-4 pb-4 space-y-2">
            {recentSessions.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No sessions yet — tap "Log Session" to start.</p>
            ) : (
              recentSessions.map(s => {
                const energy = ENERGY.find(e => e.value === s.energy_rating);
                return (
                  <div key={s.id} className="bg-gray-900 rounded-xl px-3 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{s.date}</span>
                        <span className="text-xs text-gray-500">{fmtDuration(s.duration_minutes)}</span>
                        {energy && <span className="text-xs">{energy.label}</span>}
                      </div>
                      <button onClick={() => deleteSession(s.id)} className="text-gray-700 hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {(s.items || []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {(s.items || []).map((item, idx) => (
                          <span key={idx} className="text-xs text-gray-400 bg-gray-800 border border-gray-700 px-2 py-0.5 rounded-full">
                            {item.title}
                            {item.duration_minutes ? ` · ${item.duration_minutes}m` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                    {s.session_notes && (
                      <p className="text-xs text-gray-500 leading-relaxed mt-1">{s.session_notes}</p>
                    )}
                  </div>
                );
              })
            )}
            {sessions.length > 5 && (
              <p className="text-xs text-gray-600 text-center pt-1">Showing last 5 of {sessions.length} sessions</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
