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
