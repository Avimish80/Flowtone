/**
 * invoiceTemplates.js
 * Generates a complete, self-contained HTML invoice for printing / emailing.
 * Call generateInvoiceHTML(doc, profile, settings, templateId) → HTML string.
 * Open in a new window and call window.print() for PDF export.
 */

function fmt(sym, amount) {
  return `${sym}${(Number(amount) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(str) {
  if (!str) return "";
  try { return new Date(str).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
  catch { return str; }
}

// Modern type + global niceties shared by every template.
// Inter loads for on-screen/print preview; system stack is the email/offline fallback.
function headStyles() {
  return `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  :root { --ink:#0f172a; --muted:#64748b; --faint:#94a3b8; --hair:#e8ecf3; }
  * { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { font-family:'Inter','Helvetica Neue',Arial,sans-serif; color:var(--ink);
    background:#fff; -webkit-font-smoothing:antialiased; }
  .num { font-variant-numeric:tabular-nums; }`;
}

// Big, friendly "Amount Due / Total" closing line + thank-you note.
function thankYouFooter(accent, profile, text) {
  const name = profile?.contact_name || profile?.business_name || "";
  const line = (text && String(text).trim()) || "Thank you for the music.";
  return `<div style="margin-top:44px;padding-top:22px;border-top:1px solid var(--hair);
    display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap;">
    <div style="font-size:17px;font-weight:700;color:${accent};letter-spacing:-0.2px;">${esc(line)}</div>
    <div style="font-size:11px;color:var(--faint);">${name ? "— " + esc(name) : ""}</div>
  </div>`;
}

// Escape user-entered text (footer line) so it can't inject markup.
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Personal template config: the ONLY things that may vary ──────────
// Everything else (A4 shape, line-item table, totals, bill-to/from,
// payment block) is fixed. Both the Finance editor and the AI action
// run their input through sanitizeCustom() so values stay on the rails.
export const HEADER_STYLES = ["band", "minimal", "centered"];
export const FONT_CHOICES = ["sans", "serif"];
export const ACCENT_PRESETS = ["#4f46e5", "#0f172a", "#0d9488", "#b91c1c", "#c2410c", "#7c3aed", "#be185d"];

export const DEFAULT_CUSTOM = {
  accent_color: "#4f46e5",
  header_style: "band",
  font: "sans",
  footer_text: "Thank you for the music.",
  show_logo: true,
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function sanitizeCustom(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const accent = typeof r.accent_color === "string" && HEX_RE.test(r.accent_color.trim())
    ? r.accent_color.trim().toLowerCase() : DEFAULT_CUSTOM.accent_color;
  return {
    accent_color: accent,
    header_style: HEADER_STYLES.includes(r.header_style) ? r.header_style : DEFAULT_CUSTOM.header_style,
    font: FONT_CHOICES.includes(r.font) ? r.font : DEFAULT_CUSTOM.font,
    footer_text: typeof r.footer_text === "string" ? r.footer_text.slice(0, 160) : DEFAULT_CUSTOM.footer_text,
    show_logo: r.show_logo === undefined ? true : !!r.show_logo,
  };
}

// Diagonal PAID stamp, only when the doc is settled.
function paidStamp(doc) {
  if (doc.status !== "paid") return "";
  return `<div style="position:absolute;top:48px;right:48px;transform:rotate(-14deg);
    border:3px solid #16a34a;color:#16a34a;font-weight:900;font-size:22px;letter-spacing:3px;
    padding:6px 18px;border-radius:10px;opacity:0.85;font-family:'Inter',sans-serif;">PAID</div>`;
}

function lineItemsTable(items, sym, tableStyle = "classic", accent = "#4f46e5") {
  const rows = (items || []).map(item => {
    const total = (item.quantity || 0) * (item.unit_price || 0);
    return `<tr>
      <td>${item.description || ""}</td>
      <td class="num">${item.quantity ?? 1}</td>
      <td class="num">${fmt(sym, item.unit_price)}</td>
      <td class="num">${fmt(sym, total)}</td>
    </tr>`;
  }).join("");

  const baseStyles = `
    width:100%; border-collapse:collapse; font-size:13px; margin-top:16px;
  `;

  const styles = {
    classic: `
      <style>
        .items-table th { background:#f1f5f9; color:#475569; text-transform:uppercase;
          letter-spacing:0.05em; font-size:11px; padding:8px 12px; text-align:left; }
        .items-table th.num, .items-table td.num { text-align:right; }
        .items-table td { padding:10px 12px; border-bottom:1px solid #e2e8f0; color:#334155; }
        .items-table tr:last-child td { border-bottom:none; }
      </style>`,
    modern: `
      <style>
        .items-table th { background:#4f46e5; color:#fff; font-size:11px;
          text-transform:uppercase; letter-spacing:0.05em; padding:10px 14px; text-align:left; border:none; }
        .items-table th.num, .items-table td.num { text-align:right; }
        .items-table td { padding:10px 14px; border-bottom:1px solid #e0e7ff; color:#1e293b; }
        .items-table tbody tr:nth-child(even) td { background:#f5f3ff; }
        .items-table tr:last-child td { border-bottom:none; }
      </style>`,
    bold: `
      <style>
        .items-table th { background:#0f172a; color:#e2e8f0; font-size:11px;
          text-transform:uppercase; letter-spacing:0.06em; padding:10px 14px; text-align:left; }
        .items-table th.num, .items-table td.num { text-align:right; }
        .items-table td { padding:10px 14px; border-bottom:1px solid #f1f5f9; color:#1e293b; }
        .items-table tbody tr:hover td { background:#f8fafc; }
        .items-table tr:last-child td { border-bottom:none; }
      </style>`,
    minimal: `
      <style>
        .items-table th { font-size:11px; text-transform:uppercase; letter-spacing:0.07em;
          padding:6px 0; text-align:left; color:#94a3b8; border-bottom:2px solid #0f172a; }
        .items-table th.num, .items-table td.num { text-align:right; }
        .items-table td { padding:9px 0; border-bottom:1px solid #e2e8f0; color:#334155; font-size:13px; }
        .items-table tr:last-child td { border-bottom:none; }
      </style>`,
    studio: `
      <style>
        .items-table th { background:linear-gradient(135deg,#312e81,#4f46e5); color:#fff;
          font-size:11px; text-transform:uppercase; letter-spacing:0.05em;
          padding:10px 14px; text-align:left; }
        .items-table th.num, .items-table td.num { text-align:right; }
        .items-table td { padding:10px 14px; border-bottom:1px solid #ede9fe; color:#1e293b; }
        .items-table tbody tr:nth-child(even) td { background:#faf5ff; }
        .items-table tr:last-child td { border-bottom:none; }
      </style>`,
  };

  styles.personal = `
    <style>
      .items-table th { background:color-mix(in srgb, ${accent} 10%, white); color:${accent};
        font-size:11px; text-transform:uppercase; letter-spacing:.05em; padding:10px 14px; text-align:left; }
      .items-table th.num, .items-table td.num { text-align:right; }
      .items-table td { padding:11px 14px; border-bottom:1px solid #eef2f7; color:#1e293b; }
      .items-table tr:last-child td { border-bottom:none; }
    </style>`;

  return `${styles[tableStyle] || styles.classic}
  <table class="items-table" style="${baseStyles}">
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit Price</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function totalsBlock(doc, sym, accent = "#4f46e5") {
  const isInvoice = doc.document_type === "invoice";
  const isPaid = doc.status === "paid";
  const minorRow = (label, val, extra = "") =>
    `<div style="display:flex;justify-content:space-between;gap:32px;font-size:13px;color:var(--muted);padding:3px 0;${extra}">
      <span>${label}</span><span class="num">${val}</span></div>`;

  const minor = [minorRow("Subtotal", fmt(sym, doc.subtotal))];
  if (doc.discount_amount > 0) minor.push(minorRow("Discount", "−" + fmt(sym, doc.discount_amount)));
  if (doc.tax_amount > 0) minor.push(minorRow(`Tax (${doc.tax_rate || 0}%)`, fmt(sym, doc.tax_amount)));

  const totalLabel = isPaid ? "Amount Paid" : isInvoice ? "Amount Due" : "Total";
  const heroColor = isPaid ? "#16a34a" : accent;
  const heroBg = isPaid ? "rgba(22,163,74,0.08)" : `color-mix(in srgb, ${accent} 7%, white)`;
  const heroBorder = isPaid ? "rgba(22,163,74,0.25)" : `color-mix(in srgb, ${accent} 22%, white)`;

  return `
  <div style="margin-left:auto;margin-top:16px;min-width:280px;max-width:320px;">
    ${minor.join("")}
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:24px;
      margin-top:12px;padding:14px 18px;border-radius:14px;
      background:${heroBg};border:1px solid ${heroBorder};">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:${heroColor};">${totalLabel}</span>
      <span class="num" style="font-size:26px;font-weight:800;letter-spacing:-0.5px;color:${heroColor};">${fmt(sym, doc.total || doc.subtotal)}</span>
    </div>
    ${isPaid && doc.paid_date ? `<div style="text-align:right;font-size:11px;color:#16a34a;margin-top:6px;">Settled on ${fmtDate(doc.paid_date)}</div>` : ""}
  </div>`;
}

function paymentBlock(profile) {
  const lines = [];
  if (profile?.bank_name) lines.push(`Bank: ${profile.bank_name}`);
  if (profile?.bank_account_name) lines.push(`Account name: ${profile.bank_account_name}`);
  if (profile?.bank_sort_code) lines.push(`Sort code: ${profile.bank_sort_code}`);
  if (profile?.bank_account_number) lines.push(`Account: ${profile.bank_account_number}`);
  if (profile?.bank_iban) lines.push(`IBAN: ${profile.bank_iban}`);
  if (profile?.payment_instructions) lines.push(profile.payment_instructions);
  if (!lines.length) return "";
  return `<div style="margin-top:24px;padding:16px 18px;background:#f8fafc;border-radius:12px;font-size:12px;color:#475569;line-height:1.7;border:1px solid #eef2f7;">
    <strong style="color:#1e293b;font-size:10px;text-transform:uppercase;letter-spacing:.08em;">Payment Details</strong><br>
    ${lines.join("<br>")}
  </div>`;
}

function logoTag(logo, maxH = 56) {
  if (!logo) return "";
  return `<img src="${logo}" alt="logo" style="max-height:${maxH}px;max-width:180px;object-fit:contain;display:block;">`;
}

const CURRENCIES = { GBP:"£", USD:"$", EUR:"€", AUD:"A$", CAD:"C$" };

// ──────────────────────────────────────────────────────────────────────
//  TEMPLATE 1 — CLASSIC
// ──────────────────────────────────────────────────────────────────────
function templateClassic(doc, profile, settings) {
  const sym = CURRENCIES[doc.currency] || doc.currency + " ";
  const isInvoice = doc.document_type === "invoice";
  const typeLabel = isInvoice ? "INVOICE" : "ESTIMATE";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${typeLabel} ${doc.document_number || ""}</title>
<style>
  ${headStyles()}
  body { padding:48px; max-width:800px; margin:0 auto; position:relative; }
  @media print { body { padding:24px; } }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:40px; }
  .from { font-size:12px; color:#64748b; line-height:1.6; }
  .from strong { display:block; font-size:16px; color:#0f172a; margin-bottom:4px; }
  .meta-right { text-align:right; }
  .doc-type { font-size:30px; font-weight:900; letter-spacing:-1px;
    background:linear-gradient(135deg,#4f46e5,#7c3aed); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .doc-number { font-size:13px; color:#64748b; margin-top:4px; }
  .meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:12px; font-size:12px; }
  .meta-grid span { color:#64748b; } .meta-grid strong { color:#1e293b; }
  .divider { border:none; border-top:1px solid #e2e8f0; margin:24px 0; }
  .bill-to label { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; }
  .bill-to strong { display:block; font-size:14px; color:#0f172a; margin-top:4px; }
  .bill-to p { font-size:12px; color:#64748b; margin-top:2px; }
  .footer { margin-top:40px; display:flex; justify-content:flex-end; }
  .notes { margin-top:24px; font-size:12px; color:#64748b; line-height:1.6; }
  .notes strong { color:#1e293b; }
</style></head><body>

${paidStamp(doc)}
<div class="header">
  <div>
    ${logoTag(profile?.logo)}
    <div class="from" style="margin-top:${profile?.logo ? "12px" : "0"}">
      <strong>${profile?.business_name || ""}</strong>
      ${profile?.address_line_1 ? profile.address_line_1 + "<br>" : ""}
      ${profile?.city ? profile.city + (profile?.postcode ? ", " + profile.postcode : "") + "<br>" : ""}
      ${profile?.email ? profile.email + "<br>" : ""}
      ${profile?.tax_id ? "Tax ID: " + profile.tax_id : ""}
    </div>
  </div>
  <div class="meta-right">
    <div class="doc-type">${typeLabel}</div>
    <div class="doc-number">${doc.document_number || ""}</div>
    <div class="meta-grid">
      <span>${isInvoice ? "Issue Date" : "Date"}:</span>
      <strong>${fmtDate(doc.issue_date || doc.created_at || new Date().toISOString())}</strong>
      ${isInvoice && doc.due_date ? `<span>Due Date:</span><strong>${fmtDate(doc.due_date)}</strong>` : ""}
      ${!isInvoice && doc.valid_until ? `<span>Valid Until:</span><strong>${fmtDate(doc.valid_until)}</strong>` : ""}
    </div>
  </div>
</div>

<hr class="divider">

<div class="bill-to">
  <label>Bill To</label>
  <strong>${doc.client_name || doc.title || ""}</strong>
  ${doc.client_email ? `<p>${doc.client_email}</p>` : ""}
</div>

${lineItemsTable(doc.line_items, sym, "classic")}

<div class="footer">${totalsBlock(doc, sym, "#4f46e5")}</div>

${paymentBlock(profile)}

${doc.notes ? `<div class="notes"><strong>Notes</strong><br>${doc.notes}</div>` : ""}

${thankYouFooter("#4f46e5", profile)}

</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────
//  TEMPLATE 2 — MODERN (indigo accent bar)
// ──────────────────────────────────────────────────────────────────────
function templateModern(doc, profile, settings) {
  const sym = CURRENCIES[doc.currency] || doc.currency + " ";
  const isInvoice = doc.document_type === "invoice";
  const typeLabel = isInvoice ? "Invoice" : "Estimate";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${typeLabel} ${doc.document_number || ""}</title>
<style>
  ${headStyles()}
  body { max-width:800px; margin:0 auto; }
  @media print { body { margin:0; } }
  .accent-bar { height:10px; background:linear-gradient(90deg,#4f46e5,#818cf8,#c084fc); }
  .main { padding:44px 48px; position:relative; }
  @media print { .main { padding:24px; } }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:36px; }
  .from { font-size:12px; color:#64748b; line-height:1.7; }
  .biz-name { font-size:19px; font-weight:800; color:#0f172a; margin-bottom:6px; letter-spacing:-0.3px; }
  .right-block { text-align:right; }
  .doc-badge { display:inline-block; background:linear-gradient(135deg,#4f46e5,#7c3aed); color:#fff; font-size:12px; font-weight:700;
    text-transform:uppercase; letter-spacing:.1em; padding:6px 16px; border-radius:20px; }
  .doc-number { color:#64748b; font-size:13px; margin-top:8px; }
  .meta { font-size:12px; color:#64748b; margin-top:8px; line-height:1.8; }
  .meta strong { color:#1e293b; }
  .section-label { font-size:10px; text-transform:uppercase; letter-spacing:.07em;
    color:#818cf8; font-weight:600; margin-bottom:4px; }
  .bill-section { background:#f5f3ff; border-radius:10px; padding:16px 20px; margin:20px 0; }
  .bill-name { font-size:15px; font-weight:600; color:#1e293b; }
  .bill-detail { font-size:12px; color:#64748b; margin-top:3px; }
  .footer-row { display:flex; justify-content:flex-end; margin-top:8px; }
  .notes { margin-top:24px; padding:14px 16px; background:#f8fafc; border-radius:8px;
    font-size:12px; color:#64748b; line-height:1.6; border-left:3px solid #818cf8; }
  .notes strong { color:#1e293b; }
</style></head><body>

<div class="accent-bar"></div>
<div class="main">
  ${paidStamp(doc)}
  <div class="header">
    <div>
      ${logoTag(profile?.logo, 52)}
      <div class="biz-name" style="margin-top:${profile?.logo ? "12px" : "0"}">${profile?.business_name || ""}</div>
      <div class="from">
        ${profile?.address_line_1 ? profile.address_line_1 + "<br>" : ""}
        ${profile?.city ? profile.city + (profile?.postcode ? " " + profile.postcode : "") + "<br>" : ""}
        ${profile?.email || ""}
      </div>
    </div>
    <div class="right-block">
      <div class="doc-badge">${typeLabel}</div>
      <div class="doc-number">${doc.document_number || ""}</div>
      <div class="meta">
        <strong>Date:</strong> ${fmtDate(doc.created_at || new Date().toISOString())}<br>
        ${isInvoice && doc.due_date ? `<strong>Due:</strong> ${fmtDate(doc.due_date)}<br>` : ""}
        ${!isInvoice && doc.valid_until ? `<strong>Valid Until:</strong> ${fmtDate(doc.valid_until)}<br>` : ""}
        ${doc.currency ? `<strong>Currency:</strong> ${doc.currency}` : ""}
      </div>
    </div>
  </div>

  <div class="bill-section">
    <div class="section-label">Billed To</div>
    <div class="bill-name">${doc.client_name || doc.title || ""}</div>
    ${doc.client_email ? `<div class="bill-detail">${doc.client_email}</div>` : ""}
  </div>

  ${lineItemsTable(doc.line_items, sym, "modern")}

  <div class="footer-row">${totalsBlock(doc, sym, "#4f46e5")}</div>

  ${paymentBlock(profile)}

  ${doc.notes ? `<div class="notes"><strong>Notes</strong><br>${doc.notes}</div>` : ""}

  ${thankYouFooter("#4f46e5", profile)}
</div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────
//  TEMPLATE 3 — BOLD (dark header)
// ──────────────────────────────────────────────────────────────────────
function templateBold(doc, profile, settings) {
  const sym = CURRENCIES[doc.currency] || doc.currency + " ";
  const isInvoice = doc.document_type === "invoice";
  const typeLabel = isInvoice ? "INVOICE" : "ESTIMATE";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${typeLabel} ${doc.document_number || ""}</title>
<style>
  ${headStyles()}
  body { max-width:800px; margin:0 auto; position:relative; }
  @media print { body { margin:0; } }
  .header { background:linear-gradient(120deg,#0f172a 0%,#1e1b4b 60%,#312e81 100%); padding:40px 48px; display:flex; justify-content:space-between; align-items:center; }
  @media print { .header { padding:24px; } }
  .biz { color:#fff; }
  .biz-name { font-size:21px; font-weight:800; margin-bottom:4px; letter-spacing:-0.3px; }
  .biz-detail { font-size:11px; color:#94a3b8; line-height:1.7; }
  .doc-meta { text-align:right; }
  .doc-type { font-size:34px; font-weight:900; letter-spacing:-1.5px; color:#fff; }
  .doc-number { font-size:13px; color:#94a3b8; margin-top:4px; }
  .doc-dates { font-size:11px; color:#94a3b8; margin-top:8px; line-height:1.8; }
  .doc-dates strong { color:#e2e8f0; }
  .body { padding:40px 48px; }
  @media print { .body { padding:24px; } }
  .bill-row { display:flex; gap:40px; margin-bottom:32px; }
  .bill-box { flex:1; }
  .bill-label { font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:#94a3b8; margin-bottom:4px; }
  .bill-name { font-size:15px; font-weight:600; color:#0f172a; }
  .bill-email { font-size:12px; color:#64748b; }
  .footer-row { display:flex; justify-content:flex-end; margin-top:8px; }
  .notes { margin-top:24px; padding:14px 16px; border-left:4px solid #0f172a;
    font-size:12px; color:#64748b; line-height:1.6; background:#f8fafc; }
  .notes strong { color:#0f172a; }
</style></head><body>

${paidStamp(doc)}
<div class="header">
  <div class="biz">
    ${profile?.logo ? `<img src="${profile.logo}" alt="logo" style="max-height:48px;max-width:160px;object-fit:contain;filter:brightness(0)invert(1);display:block;margin-bottom:10px;">` : ""}
    <div class="biz-name">${profile?.business_name || ""}</div>
    <div class="biz-detail">
      ${profile?.address_line_1 ? profile.address_line_1 + "<br>" : ""}
      ${profile?.city ? profile.city + (profile?.postcode ? " " + profile.postcode : "") + "<br>" : ""}
      ${profile?.email ? profile.email + "<br>" : ""}
      ${profile?.tax_id ? "Tax ID: " + profile.tax_id : ""}
    </div>
  </div>
  <div class="doc-meta">
    <div class="doc-type">${typeLabel}</div>
    <div class="doc-number">${doc.document_number || ""}</div>
    <div class="doc-dates">
      <strong>Date:</strong> ${fmtDate(doc.created_at || new Date().toISOString())}<br>
      ${isInvoice && doc.due_date ? `<strong>Due:</strong> ${fmtDate(doc.due_date)}` : ""}
      ${!isInvoice && doc.valid_until ? `<strong>Valid Until:</strong> ${fmtDate(doc.valid_until)}` : ""}
    </div>
  </div>
</div>

<div class="body">
  <div class="bill-row">
    <div class="bill-box">
      <div class="bill-label">Billed To</div>
      <div class="bill-name">${doc.client_name || doc.title || ""}</div>
      ${doc.client_email ? `<div class="bill-email">${doc.client_email}</div>` : ""}
    </div>
    <div class="bill-box">
      <div class="bill-label">From</div>
      <div class="bill-name">${profile?.contact_name || profile?.business_name || ""}</div>
      ${profile?.email ? `<div class="bill-email">${profile.email}</div>` : ""}
    </div>
  </div>

  ${lineItemsTable(doc.line_items, sym, "bold")}

  <div class="footer-row">${totalsBlock(doc, sym, "#4f46e5")}</div>

  ${paymentBlock(profile)}

  ${doc.notes ? `<div class="notes"><strong>Notes</strong><br>${doc.notes}</div>` : ""}

  ${thankYouFooter("#4f46e5", profile)}
</div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────
//  TEMPLATE 4 — MINIMAL
// ──────────────────────────────────────────────────────────────────────
function templateMinimal(doc, profile, settings) {
  const sym = CURRENCIES[doc.currency] || doc.currency + " ";
  const isInvoice = doc.document_type === "invoice";
  const typeLabel = isInvoice ? "Invoice" : "Estimate";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${typeLabel} ${doc.document_number || ""}</title>
<style>
  ${headStyles()}
  body { font-family:Georgia,'Times New Roman',serif; color:#1e293b;
    padding:56px 64px; max-width:800px; margin:0 auto; position:relative; }
  @media print { body { padding:32px; } }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:48px; }
  .biz-name { font-size:24px; font-weight:700; letter-spacing:-0.5px; color:#0f172a; margin-bottom:6px; }
  .biz-detail { font-size:12px; color:#64748b; line-height:1.8; font-family:'Helvetica Neue',sans-serif; }
  .doc-right { text-align:right; font-family:'Helvetica Neue',sans-serif; }
  .doc-type { font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:#94a3b8; margin-bottom:4px; }
  .doc-number { font-size:24px; font-weight:300; color:#0f172a; }
  .meta { font-size:12px; color:#64748b; margin-top:8px; line-height:1.8; }
  .meta strong { color:#0f172a; }
  .rule { border:none; border-top:1px solid #1e293b; margin:32px 0; }
  .rule-light { border:none; border-top:1px solid #e2e8f0; margin:24px 0; }
  .bill-label { font-size:10px; text-transform:uppercase; letter-spacing:.1em;
    color:#94a3b8; margin-bottom:6px; font-family:'Helvetica Neue',sans-serif; }
  .bill-name { font-size:15px; color:#0f172a; }
  .bill-email { font-size:12px; color:#64748b; font-family:'Helvetica Neue',sans-serif; }
  .totals { margin-top:32px; }
  .notes { margin-top:32px; font-size:12px; color:#64748b; font-family:'Helvetica Neue',sans-serif; line-height:1.7; }
  .notes strong { color:#0f172a; }
</style></head><body>

${paidStamp(doc)}
<div class="header">
  <div>
    ${logoTag(profile?.logo, 48)}
    <div class="biz-name" style="margin-top:${profile?.logo ? "14px" : "0"}">${profile?.business_name || ""}</div>
    <div class="biz-detail">
      ${profile?.address_line_1 ? profile.address_line_1 + "<br>" : ""}
      ${profile?.city ? profile.city + (profile?.postcode ? ", " + profile.postcode : "") + "<br>" : ""}
      ${profile?.email || ""}
    </div>
  </div>
  <div class="doc-right">
    <div class="doc-type">${typeLabel}</div>
    <div class="doc-number">${doc.document_number || ""}</div>
    <div class="meta">
      <strong>Date</strong><br>${fmtDate(doc.created_at || new Date().toISOString())}<br>
      ${isInvoice && doc.due_date ? `<strong>Due</strong><br>${fmtDate(doc.due_date)}` : ""}
    </div>
  </div>
</div>

<hr class="rule">

<div class="bill-label">Billed To</div>
<div class="bill-name">${doc.client_name || doc.title || ""}</div>
${doc.client_email ? `<div class="bill-email">${doc.client_email}</div>` : ""}

${lineItemsTable(doc.line_items, sym, "minimal")}

<div class="totals" style="display:flex;justify-content:flex-end;">${totalsBlock(doc, sym, "#0f172a")}</div>

<hr class="rule-light">

${paymentBlock(profile)}

${doc.notes ? `<div class="notes"><strong>Notes</strong><br>${doc.notes}</div>` : ""}

${thankYouFooter("#0f172a", profile)}

</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────
//  TEMPLATE 5 — STUDIO (music-themed, purple gradient)
// ──────────────────────────────────────────────────────────────────────
function templateStudio(doc, profile, settings) {
  const sym = CURRENCIES[doc.currency] || doc.currency + " ";
  const isInvoice = doc.document_type === "invoice";
  const typeLabel = isInvoice ? "Invoice" : "Estimate";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${typeLabel} ${doc.document_number || ""}</title>
<style>
  ${headStyles()}
  body { max-width:800px; margin:0 auto; position:relative; }
  @media print { body { margin:0; } }
  .header {
    background:linear-gradient(135deg,#1e1b4b 0%,#4c1d95 55%,#7c3aed 100%);
    padding:44px 48px; position:relative; overflow:hidden;
  }
  @media print { .header { padding:24px; } }
  .header::before {
    content:"𝅘𝅥𝅮";
    position:absolute; right:40px; top:50%; transform:translateY(-50%);
    font-size:120px; opacity:0.06; color:#fff; line-height:1;
  }
  .header-inner { display:flex; justify-content:space-between; align-items:flex-start; position:relative; }
  .biz-name { font-size:20px; font-weight:700; color:#fff; margin-bottom:4px; }
  .biz-detail { font-size:11px; color:#c4b5fd; line-height:1.7; }
  .doc-right { text-align:right; }
  .doc-type { font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:#c4b5fd; }
  .doc-number { font-size:26px; font-weight:800; color:#fff; margin-top:2px; }
  .doc-dates { font-size:11px; color:#c4b5fd; margin-top:6px; line-height:1.8; }
  .doc-dates strong { color:#e9d5ff; }
  .body { padding:40px 48px; }
  @media print { .body { padding:24px; } }
  .bill-bar { display:flex; gap:48px; background:#faf5ff; border-radius:12px;
    padding:18px 24px; margin-bottom:28px; border-left:4px solid #7c3aed; }
  .bill-label { font-size:10px; text-transform:uppercase; letter-spacing:.08em;
    color:#7c3aed; margin-bottom:4px; }
  .bill-name { font-size:14px; font-weight:600; color:#1e293b; }
  .bill-detail { font-size:12px; color:#64748b; }
  .footer-row { display:flex; justify-content:flex-end; }
  .notes { margin-top:24px; padding:14px 18px; background:#faf5ff; border-radius:10px;
    font-size:12px; color:#64748b; line-height:1.6; }
  .notes strong { color:#1e293b; }
</style></head><body>

${paidStamp(doc)}
<div class="header">
  <div class="header-inner">
    <div>
      ${profile?.logo ? `<img src="${profile.logo}" alt="logo" style="max-height:48px;max-width:160px;object-fit:contain;filter:brightness(0)invert(1);display:block;margin-bottom:10px;">` : ""}
      <div class="biz-name">${profile?.business_name || ""}</div>
      <div class="biz-detail">
        ${profile?.address_line_1 ? profile.address_line_1 + "<br>" : ""}
        ${profile?.city ? profile.city + (profile?.postcode ? " " + profile.postcode : "") + "<br>" : ""}
        ${profile?.email || ""}
      </div>
    </div>
    <div class="doc-right">
      <div class="doc-type">${typeLabel}</div>
      <div class="doc-number">${doc.document_number || ""}</div>
      <div class="doc-dates">
        <strong>Date:</strong> ${fmtDate(doc.created_at || new Date().toISOString())}<br>
        ${isInvoice && doc.due_date ? `<strong>Due:</strong> ${fmtDate(doc.due_date)}` : ""}
        ${!isInvoice && doc.valid_until ? `<strong>Valid:</strong> ${fmtDate(doc.valid_until)}` : ""}
      </div>
    </div>
  </div>
</div>

<div class="body">
  <div class="bill-bar">
    <div>
      <div class="bill-label">Billed To</div>
      <div class="bill-name">${doc.client_name || doc.title || ""}</div>
      ${doc.client_email ? `<div class="bill-detail">${doc.client_email}</div>` : ""}
    </div>
    ${profile?.business_name ? `<div>
      <div class="bill-label">From</div>
      <div class="bill-name">${profile?.contact_name || profile?.business_name || ""}</div>
      ${profile?.email ? `<div class="bill-detail">${profile.email}</div>` : ""}
    </div>` : ""}
  </div>

  ${lineItemsTable(doc.line_items, sym, "studio")}

  <div class="footer-row" style="margin-top:16px;">${totalsBlock(doc, sym, "#7c3aed")}</div>

  ${paymentBlock(profile)}

  ${doc.notes ? `<div class="notes"><strong>Notes</strong><br>${doc.notes}</div>` : ""}

  ${thankYouFooter("#7c3aed", profile)}
</div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────
//  TEMPLATE 6 — PERSONAL (user/AI-customisable within fixed rails)
// ──────────────────────────────────────────────────────────────────────
function templatePersonal(doc, profile, settings) {
  const sym = CURRENCIES[doc.currency] || doc.currency + " ";
  const c = sanitizeCustom(settings?.invoice_custom);
  const isInvoice = doc.document_type === "invoice";
  const typeLabel = isInvoice ? "Invoice" : "Estimate";
  const accent = c.accent_color;
  const headFont = c.font === "serif" ? "Georgia,'Times New Roman',serif" : "'Inter','Helvetica Neue',Arial,sans-serif";
  const showLogo = c.show_logo && !!profile?.logo;

  const fromLines = `
    ${profile?.address_line_1 ? profile.address_line_1 + "<br>" : ""}
    ${profile?.city ? profile.city + (profile?.postcode ? " " + profile.postcode : "") + "<br>" : ""}
    ${profile?.email || ""}`;

  // Header — three presets, identity only (dates live in the bill row)
  let header;
  if (c.header_style === "band") {
    header = `
    <div style="background:linear-gradient(120deg, ${accent}, color-mix(in srgb, ${accent} 55%, #000));
      padding:40px 48px;display:flex;justify-content:space-between;align-items:center;gap:24px;">
      <div style="color:#fff;">
        ${showLogo ? `<img src="${profile.logo}" alt="logo" style="max-height:46px;max-width:160px;object-fit:contain;filter:brightness(0) invert(1);display:block;margin-bottom:10px;">` : ""}
        <div style="font-family:${headFont};font-size:21px;font-weight:800;letter-spacing:-0.3px;">${profile?.business_name || ""}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.82);line-height:1.7;margin-top:4px;">${fromLines}</div>
      </div>
      <div style="text-align:right;color:#fff;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.12em;opacity:0.85;">${typeLabel}</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-0.5px;">${doc.document_number || ""}</div>
      </div>
    </div>`;
  } else if (c.header_style === "centered") {
    header = `
    <div style="padding:48px 48px 0;text-align:center;">
      ${showLogo ? `<img src="${profile.logo}" alt="logo" style="max-height:50px;max-width:200px;object-fit:contain;margin:0 auto 12px;display:block;">` : ""}
      <div style="font-family:${headFont};font-size:24px;font-weight:800;letter-spacing:-0.4px;color:#0f172a;">${profile?.business_name || ""}</div>
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:${accent};font-weight:600;margin-top:6px;">${typeLabel} · ${doc.document_number || ""}</div>
      <div style="font-size:11px;color:#64748b;line-height:1.7;margin-top:8px;">${fromLines}</div>
      <div style="height:3px;width:64px;margin:22px auto 0;background:${accent};border-radius:2px;"></div>
    </div>`;
  } else { // minimal
    header = `
    <div style="padding:48px 48px 0;display:flex;justify-content:space-between;align-items:flex-start;gap:24px;">
      <div>
        ${showLogo ? `<img src="${profile.logo}" alt="logo" style="max-height:46px;max-width:170px;object-fit:contain;display:block;margin-bottom:10px;">` : ""}
        <div style="font-family:${headFont};font-size:22px;font-weight:800;letter-spacing:-0.4px;color:#0f172a;">${profile?.business_name || ""}</div>
        <div style="font-size:11px;color:#64748b;line-height:1.7;margin-top:4px;">${fromLines}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:${accent};font-weight:600;">${typeLabel}</div>
        <div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:2px;">${doc.document_number || ""}</div>
      </div>
    </div>
    <div style="margin:22px 48px 0;height:3px;background:${accent};border-radius:2px;"></div>`;
  }

  const lbl = `font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;`;
  const billRow = `
    <div style="display:flex;justify-content:space-between;gap:32px;margin-bottom:28px;flex-wrap:wrap;">
      <div>
        <div style="${lbl}">Billed To</div>
        <div style="font-size:15px;font-weight:600;color:#0f172a;margin-top:4px;">${doc.client_name || doc.title || ""}</div>
        ${doc.client_email ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">${doc.client_email}</div>` : ""}
      </div>
      <div style="text-align:right;">
        <div style="${lbl}">${isInvoice ? "Invoice Date" : "Date"}</div>
        <div style="font-size:13px;color:#0f172a;margin-top:4px;">${fmtDate(doc.created_at || new Date().toISOString())}</div>
        ${isInvoice && doc.due_date ? `<div style="${lbl}margin-top:8px;">Due</div><div style="font-size:13px;color:#0f172a;margin-top:4px;">${fmtDate(doc.due_date)}</div>` : ""}
        ${!isInvoice && doc.valid_until ? `<div style="${lbl}margin-top:8px;">Valid Until</div><div style="font-size:13px;color:#0f172a;margin-top:4px;">${fmtDate(doc.valid_until)}</div>` : ""}
      </div>
    </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${typeLabel} ${doc.document_number || ""}</title>
<style>
  ${headStyles()}
  body { max-width:800px; margin:0 auto; position:relative; }
  @media print { body { margin:0; } }
  .content { padding:36px 48px 44px; }
  @media print { .content { padding:28px 24px; } [style*="120deg"], .band { padding:24px !important; } }
  .notes { margin-top:24px; padding:14px 18px; background:#f8fafc; border-radius:12px;
    font-size:12px; color:#64748b; line-height:1.6; border-left:3px solid ${accent}; }
  .notes strong { color:#1e293b; }
</style></head><body>

${paidStamp(doc)}
${header}
<div class="content">
  ${billRow}
  ${lineItemsTable(doc.line_items, sym, "personal", accent)}
  <div style="display:flex;justify-content:flex-end;">${totalsBlock(doc, sym, accent)}</div>
  ${paymentBlock(profile)}
  ${doc.notes ? `<div class="notes"><strong>Notes</strong><br>${doc.notes}</div>` : ""}
  ${thankYouFooter(accent, profile, c.footer_text)}
</div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ──────────────────────────────────────────────────────────────────────
export const TEMPLATE_DEFS = [
  { id: 1, name: "Classic",  desc: "Clean and professional, with a gradient title" },
  { id: 2, name: "Modern",   desc: "Vivid accent bar — fresh and contemporary" },
  { id: 3, name: "Bold",     desc: "Deep gradient header — strong and striking" },
  { id: 4, name: "Minimal",  desc: "Ultra-clean serif — quiet and refined" },
  { id: 5, name: "Studio",   desc: "Purple gradient with a music motif — made for musicians" },
  { id: 6, name: "Personal", desc: "Your own — set colour, header, font and footer (or ask the AI)" },
];

/**
 * @param {object} doc       – Document entity from localStorageEngine
 * @param {object} profile   – BusinessProfile entity
 * @param {object} settings  – AppSettings entity
 * @param {number} templateId – 1-5
 * @returns {string} complete HTML
 */
export function generateInvoiceHTML(doc, profile, settings, templateId = 1) {
  const fns = { 1: templateClassic, 2: templateModern, 3: templateBold, 4: templateMinimal, 5: templateStudio, 6: templatePersonal };
  const fn = fns[templateId] || templateClassic;
  return fn(doc, profile, settings);
}

/**
 * Prints the rendered invoice via a hidden iframe.
 *
 * We deliberately do NOT use window.open: in an iOS standalone PWA that
 * replaces the entire app with the invoice and leaves the user with no way
 * back (stuck on the PDF). An iframe keeps the app mounted — the print/share
 * sheet appears on top, and dismissing it returns the user exactly where they
 * were.
 */
export function printInvoice(doc, profile, settings, templateId = 1) {
  const html = generateInvoiceHTML(doc, profile, settings, templateId);

  const existing = document.getElementById("flowtone-print-frame");
  if (existing) existing.remove();

  const iframe = document.createElement("iframe");
  iframe.id = "flowtone-print-frame";
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    // Small delay lets fonts settle before the print snapshot
    setTimeout(() => {
      win.onafterprint = () => setTimeout(() => iframe.remove(), 500);
      try { win.focus(); win.print(); } catch { /* ignore */ }
    }, 300);
    // Safety net: never let the hidden frame linger if afterprint never fires
    setTimeout(() => {
      if (document.getElementById("flowtone-print-frame")) iframe.remove();
    }, 120000);
  };

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}

/**
 * Builds a mailto: link with invoice summary in the body.
 */
export function buildMailtoLink(doc, profile, settings, recipientEmail) {
  const sym = CURRENCIES[doc.currency] || doc.currency + " ";
  const isInvoice = doc.document_type === "invoice";
  const typeLabel = isInvoice ? "Invoice" : "Estimate";
  const to = recipientEmail || doc.client_email || "";
  const subject = encodeURIComponent(
    `${typeLabel} ${doc.document_number || ""} – ${doc.title || profile?.business_name || ""}`
  );
  const total = fmt(sym, doc.total || doc.subtotal);
  const due = isInvoice && doc.due_date ? `\nDue date: ${fmtDate(doc.due_date)}` : "";
  const payLine = profile?.bank_account_number
    ? `\n\nPayment details:\nBank: ${profile.bank_name || ""}\nAccount: ${profile.bank_account_number}${profile.bank_sort_code ? "\nSort code: " + profile.bank_sort_code : ""}`
    : "";
  const body = encodeURIComponent(
    `Hi,\n\nPlease find attached your ${typeLabel.toLowerCase()} ${doc.document_number || ""} for ${total}.${due}${payLine}\n\nIf you have any questions, please don't hesitate to get in touch.\n\nKind regards,\n${profile?.contact_name || profile?.business_name || ""}`
  );
  return `mailto:${to}?subject=${subject}&body=${body}`;
}
