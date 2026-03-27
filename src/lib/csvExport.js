export function toCSV(rows, headers) {
  const escape = (v) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

export function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportClients(appClient) {
  const clients = await appClient.entities.Client.list();
  const headers = ["name", "email", "phone", "client_type", "notes"];
  return toCSV(clients, headers);
}

export async function exportEvents(appClient) {
  const events = await appClient.entities.WorkEvent.list();
  const headers = ["title", "date", "start_time", "end_time", "event_type", "status", "location_address", "fee", "notes"];
  return toCSV(events, headers);
}

export async function exportInvoices(appClient) {
  const docs = await appClient.entities.Document.list();
  const invoices = docs.filter(d => d.document_type === "invoice");
  const headers = ["document_number", "title", "status", "total", "due_date", "notes"];
  return toCSV(invoices, headers);
}

/**
 * Export ALL app data as a single comprehensive CSV file.
 * Format: each entity type is a section with a marker row.
 * Testers can back up and restore their entire app state.
 */
export async function exportFullApp(appClient) {
  const sections = [];

  // Get all entities
  const [
    clients, events, documents, payments, practiceGoals, practiceSessions,
    charts, equipment, reminders, settings, businessProfile, emailMessages, documentActivityLogs
  ] = await Promise.all([
    appClient.entities.Client.list().catch(() => []),
    appClient.entities.WorkEvent.list().catch(() => []),
    appClient.entities.Document.list().catch(() => []),
    appClient.entities.Payment.list().catch(() => []),
    appClient.entities.PracticeGoal.list().catch(() => []),
    appClient.entities.PracticeSession.list().catch(() => []),
    appClient.entities.Chart.list().catch(() => []),
    appClient.entities.Equipment.list().catch(() => []),
    appClient.entities.Reminder.list().catch(() => []),
    appClient.entities.AppSettings.list().catch(() => []),
    appClient.entities.BusinessProfile.list().catch(() => []),
    appClient.entities.EmailMessage.list().catch(() => []),
    appClient.entities.DocumentActivityLog.list().catch(() => []),
  ]);

  // Helper to create a section
  const addSection = (label, records, keyFields) => {
    if (records.length === 0) return;
    const headers = keyFields;
    const markerRow = { __ENTITY__: label, ...Object.fromEntries(headers.map(h => [h, ""])) };
    sections.push([markerRow, ...records]);
  };

  // Add each entity type as a section
  addSection("CLIENT", clients, ["id", "name", "email", "phone", "client_type", "city", "default_currency", "default_fee", "notes", "late_payment_flag"]);
  addSection("WORK_EVENT", events, ["id", "title", "event_type", "date", "start_time", "end_time", "status", "client_id", "location_address", "base_price", "total_price", "currency", "notes"]);
  addSection("DOCUMENT", documents, ["id", "document_type", "document_number", "title", "client_id", "work_event_id", "status", "currency", "subtotal", "discount_amount", "tax_amount", "total", "due_date", "paid_date", "notes"]);
  addSection("PAYMENT", payments, ["id", "document_id", "amount", "payment_date", "payment_method", "notes"]);
  addSection("PRACTICE_GOAL", practiceGoals, ["id", "title", "description", "completed", "target_date"]);
  addSection("PRACTICE_SESSION", practiceSessions, ["id", "date", "duration_minutes", "notes", "goal_id", "work_event_id", "energy_rating"]);
  addSection("CHART", charts, ["id", "title", "artist", "style", "key", "tempo", "notes"]);
  addSection("EQUIPMENT", equipment, ["id", "name", "category", "condition", "serial_number", "notes"]);
  addSection("REMINDER", reminders, ["id", "title", "due_date", "completed"]);
  addSection("APP_SETTINGS", settings, ["currency", "tax_year_start_month", "invoice_number_prefix", "invoice_number_next", "estimate_number_prefix", "estimate_number_next", "tax_rate"]);
  addSection("BUSINESS_PROFILE", businessProfile, ["business_name", "logo_url", "address", "phone", "email", "website"]);

  // Flatten all sections into one big list
  const allRows = [];
  for (const section of sections) {
    allRows.push(...section);
  }

  if (allRows.length === 0) return "No data to export";

  // Headers are all keys from first row (marker row sets them)
  const allKeys = new Set();
  for (const row of allRows) {
    Object.keys(row).forEach(k => allKeys.add(k));
  }
  const headers = Array.from(allKeys);

  return toCSV(allRows, headers);
}
