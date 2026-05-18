// iCal (.ics) export utility
// Generates a standards-compliant VCALENDAR file from Flowtone WorkEvent records

// Escape special iCal characters in text fields
function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// Fold long lines at 75 chars (iCal spec requirement)
function fold(line) {
  if (line.length <= 75) return line;
  const chunks = [];
  let i = 0;
  chunks.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    chunks.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

// Format a date string (YYYY-MM-DD) + optional time string (HH:MM) as iCal datetime
function formatDt(dateStr, timeStr) {
  if (!dateStr) return null;
  const d = dateStr.replace(/-/g, "");
  if (!timeStr) return d; // all-day: YYYYMMDD
  const t = timeStr.replace(/:/g, "") + "00"; // HHMMSS
  return `${d}T${t}`;
}

// Map event status to iCal STATUS
function mapStatus(status) {
  if (status === "confirmed" || status === "completed") return "CONFIRMED";
  if (status === "cancelled") return "CANCELLED";
  return "TENTATIVE"; // lead
}

export function eventsToIcal(events) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Flowtone//Flowtone App//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Flowtone Events",
    "X-WR-TIMEZONE:Europe/London",
  ];

  for (const event of events) {
    if (!event.date) continue;

    const dtstart = formatDt(event.date, event.start_time);
    const dtend   = event.end_time
      ? formatDt(event.date, event.end_time)
      : event.start_time
        ? formatDt(event.date, addHours(event.start_time, event.event_type === "Lesson" ? 1 : 2))
        : event.date.replace(/-/g, ""); // all-day

    const isAllDay = !event.start_time;

    lines.push("BEGIN:VEVENT");
    lines.push(fold(`UID:${event.id}@flowtone`));

    if (isAllDay) {
      lines.push(fold(`DTSTART;VALUE=DATE:${dtstart}`));
      // DTEND for all-day should be day + 1
      lines.push(fold(`DTEND;VALUE=DATE:${nextDay(event.date)}`));
    } else {
      lines.push(fold(`DTSTART:${dtstart}`));
      lines.push(fold(`DTEND:${dtend}`));
    }

    lines.push(fold(`SUMMARY:${esc(event.title)}`));

    if (event.location_address) {
      lines.push(fold(`LOCATION:${esc(event.location_address)}`));
    }

    const descParts = [];
    if (event.event_type) descParts.push(`Type: ${event.event_type}`);
    if (event.status)     descParts.push(`Status: ${event.status}`);
    if (event.fee || event.total_price || event.base_price) {
      const amt = event.fee || event.total_price || event.base_price;
      descParts.push(`Fee: ${event.currency || "GBP"} ${amt}`);
    }
    if (event.notes) descParts.push(event.notes);
    if (descParts.length) {
      lines.push(fold(`DESCRIPTION:${esc(descParts.join("\\n"))}`));
    }

    lines.push(fold(`STATUS:${mapStatus(event.status)}`));

    const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    lines.push(fold(`DTSTAMP:${now}`));

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// Helper: add hours to HH:MM string
function addHours(timeStr, hours) {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h + hours;
  return `${String(total).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Helper: next calendar day from YYYY-MM-DD
function nextDay(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// Download the .ics file in the browser
export function downloadIcal(filename, icsContent) {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
