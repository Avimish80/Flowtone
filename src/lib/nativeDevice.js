// Native iPhone access (Calendar + Reminders via EventKit) for the Capacitor
// iOS build. Every function is a safe no-op on the web, so callers can use
// these unconditionally and gate UI on isNativeApp().
import { Capacitor } from "@capacitor/core";
import { CapacitorCalendar } from "@ebarooni/capacitor-calendar";
import { format } from "date-fns";

export const isNativeApp = () => Capacitor.isNativePlatform();

// → { calendar: "granted"|"denied"|"prompt", reminders: ... }
export async function getDeviceAccess() {
  if (!isNativeApp()) return { calendar: "unavailable", reminders: "unavailable" };
  const { result } = await CapacitorCalendar.checkAllPermissions();
  return { calendar: result.readCalendar, reminders: result.readReminders };
}

export async function requestCalendarAccess() {
  if (!isNativeApp()) return "unavailable";
  const { result } = await CapacitorCalendar.requestFullCalendarAccess();
  return result;
}

export async function requestRemindersAccess() {
  if (!isNativeApp()) return "unavailable";
  const { result } = await CapacitorCalendar.requestFullRemindersAccess();
  return result;
}

// Events from every calendar on the phone (iCloud, Google, Exchange, ...)
// between two Dates, normalised to Flowtone's date/time strings.
export async function listDeviceEvents(from, to) {
  if (!isNativeApp()) return [];
  const { result } = await CapacitorCalendar.listEventsInRange({ from: from.getTime(), to: to.getTime() });
  return result
    .map((e) => ({
      id: e.id,
      title: e.title,
      calendar_id: e.calendarId,
      date: format(new Date(e.startDate), "yyyy-MM-dd"),
      start_time: e.isAllDay ? "" : format(new Date(e.startDate), "HH:mm"),
      end_time: e.isAllDay ? "" : format(new Date(e.endDate), "HH:mm"),
      is_all_day: e.isAllDay,
      is_recurring: e.isPartOfSeries,
      location: e.location || "",
      notes: e.description || "",
    }))
    .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
}

export async function listDeviceCalendars() {
  if (!isNativeApp()) return [];
  const { result } = await CapacitorCalendar.listCalendars();
  return result.map((c) => ({ id: c.id, title: c.title, color: c.color, account: c.source?.title || c.accountName || "" }));
}

// Reminders across all lists. Pass includeCompleted to also get done ones.
export async function listDeviceReminders({ includeCompleted = false } = {}) {
  if (!isNativeApp()) return [];
  const { result: lists } = await CapacitorCalendar.getRemindersLists();
  if (!lists.length) return [];
  const { result } = await CapacitorCalendar.getRemindersFromLists({ listIds: lists.map((l) => l.id) });
  const listName = Object.fromEntries(lists.map((l) => [l.id, l.title]));
  return result
    .filter((r) => includeCompleted || !r.isCompleted)
    .map((r) => ({
      id: r.id,
      title: r.title || "",
      list: listName[r.listId] || "",
      due: r.dueDate ? new Date(r.dueDate).toISOString() : null,
      notes: r.notes || "",
      is_completed: r.isCompleted,
    }));
}

// Adds a reminder to the default Reminders list. due is a Date (optional).
export async function createDeviceReminder({ title, notes, due }) {
  if (!isNativeApp()) return null;
  const { id } = await CapacitorCalendar.createReminder({
    title,
    notes,
    dueDate: due ? due.getTime() : undefined,
  });
  return id;
}
