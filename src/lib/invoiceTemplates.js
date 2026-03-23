/**
 * invoiceTemplates.js
 * Generates a complete, self-contained HTML invoice for printing / emailing.
 * Call generateInvoiceHTML(doc, profile, settings, templateId) → HTML string.
 * Open in a new window and call window.print() for PDF export.
 */

function fmt(sym, amount) {
  return `${sym}${(Number(amount) || 0).toFixed(2)}`;
}

function fmtDate(str) {
  if (!str) return "";
  try { return new Date(str).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
  catch { return str; }
}

function lineItemsTable(items, sym, tableStyle = "classic") {
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

function totalsBlock(doc, sym, alignRight = true) {
  const align = alignRight ? "margin-left:auto;" : "";
  const rows = [];
  rows.push(`<tr><td>Subtotal</td><td>${fmt(sym, doc.subtotal)}</td></tr>`);
  if (doc.discount_amount > 0)
    rows.push(`<tr><td>Discount</td><td>−${fmt(sym, doc.discount_amount)}</td></tr>`);
  if (doc.tax_amount > 0)
    rows.push(`<tr style="color:#64748b"><td>Tax (${doc.tax_rate || 0}%)</td><td>${fmt(sym, doc.tax_amount)}</td></tr>`);

  return `
  <table style="border-collapse:collapse;font-size:13px;${align}margin-top:16px;min-width:220px;">
    ${rows.join("")}
    <tr style="font-size:16px;font-weight:700;border-top:2px solid #0f172a;">
      <td style="padding-top:8px;">Total</td>
      <td style="padding-top:8px;text-align:right;">${fmt(sym, doc.total || doc.subtotal)}</td>
    </tr>
    ${doc.status === "paid" ? `<tr style="color:#16a34a;font-size:12px;">
      <td style="padding-top:4px;">Paid${doc.paid_date ? ` on ${fmtDate(doc.paid_date)}` : ""}</td>
      <td></td>
    </tr>` : ""}
  </table>`;
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
  return `<div style="margin-top:24px;padding:14px 16px;background:#f8fafc;border-radius:8px;font-size:12px;color:#475569;line-height:1.7;border:1px solid #e2e8f0;">
    <strong style="color:#1e293b;font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Payment Details</strong><br>
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
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Helvetica Neue',Arial,sans-serif; color:#1e293b; background:#fff; padding:40px 48px; max-width:800px; margin:0 auto; }
  @media print { body { padding:20px; } }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:40px; }
  .from { font-size:12px; color:#64748b; line-height:1.6; }
  .from strong { display:block; font-size:16px; color:#0f172a; margin-bottom:4px; }
  .meta-right { text-align:right; }
  .doc-type { font-size:28px; font-weight:800; letter-spacing:-0.5px; color:#0f172a; }
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

<div class="footer">${totalsBlock(doc, sym, true)}</div>

${paymentBlock(profile)}

${doc.notes ? `<div class="notes"><strong>Notes</strong><br>${doc.notes}</div>` : ""}

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
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Helvetica Neue',Arial,sans-serif; color:#1e293b; background:#fff; max-width:800px; margin:0 auto; }
  @media print { body { margin:0; } }
  .accent-bar { height:8px; background:linear-gradient(90deg,#4f46e5,#818cf8); }
  .main { padding:40px 48px; }
  @media print { .main { padding:24px; } }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:36px; }
  .from { font-size:12px; color:#64748b; line-height:1.7; }
  .biz-name { font-size:18px; font-weight:700; color:#0f172a; margin-bottom:6px; }
  .right-block { text-align:right; }
  .doc-badge { display:inline-block; background:#4f46e5; color:#fff; font-size:12px; font-weight:600;
    text-transform:uppercase; letter-spacing:.08em; padding:5px 14px; border-radius:20px; }
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

  <div class="footer-row">${totalsBlock(doc, sym, true)}</div>

  ${paymentBlock(profile)}

  ${doc.notes ? `<div class="notes"><strong>Notes</strong><br>${doc.notes}</div>` : ""}
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
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Helvetica Neue',Arial,sans-serif; color:#1e293b; background:#fff; max-width:800px; margin:0 auto; }
  @media print { body { margin:0; } }
  .header { background:#0f172a; padding:36px 48px; display:flex; justify-content:space-between; align-items:center; }
  @media print { .header { padding:24px; } }
  .biz { color:#fff; }
  .biz-name { font-size:20px; font-weight:700; margin-bottom:4px; }
  .biz-detail { font-size:11px; color:#94a3b8; line-height:1.7; }
  .doc-meta { text-align:right; }
  .doc-type { font-size:32px; font-weight:900; letter-spacing:-1px; color:#fff; }
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

  <div class="footer-row">${totalsBlock(doc, sym, true)}</div>

  ${paymentBlock(profile)}

  ${doc.notes ? `<div class="notes"><strong>Notes</strong><br>${doc.notes}</div>` : ""}
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
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Georgia,'Times New Roman',serif; color:#1e293b; background:#fff;
    padding:56px 64px; max-width:800px; margin:0 auto; }
  @media print { body { padding:32px; } }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:48px; }
  .biz-name { font-size:22px; font-weight:700; letter-spacing:-0.5px; color:#0f172a; margin-bottom:6px; }
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

<div class="totals" style="display:flex;justify-content:flex-end;">${totalsBlock(doc, sym, true)}</div>

<hr class="rule-light">

${paymentBlock(profile)}

${doc.notes ? `<div class="notes"><strong>Notes</strong><br>${doc.notes}</div>` : ""}

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
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Helvetica Neue',Arial,sans-serif; color:#1e293b; background:#fff;
    max-width:800px; margin:0 auto; }
  @media print { body { margin:0; } }
  .header {
    background:linear-gradient(135deg,#1e1b4b 0%,#312e81 50%,#4c1d95 100%);
    padding:40px 48px; position:relative; overflow:hidden;
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

  <div class="footer-row" style="margin-top:16px;">${totalsBlock(doc, sym, true)}</div>

  ${paymentBlock(profile)}

  ${doc.notes ? `<div class="notes"><strong>Notes</strong><br>${doc.notes}</div>` : ""}
</div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ──────────────────────────────────────────────────────────────────────
export const TEMPLATE_DEFS = [
  { id: 1, name: "Classic",  desc: "Traditional layout — clean and professional" },
  { id: 2, name: "Modern",   desc: "Indigo accent bar — fresh and contemporary" },
  { id: 3, name: "Bold",     desc: "Dark header band — strong and striking" },
  { id: 4, name: "Minimal",  desc: "Ultra-clean — serif type, no decoration" },
  { id: 5, name: "Studio",   desc: "Deep purple gradient — made for musicians" },
];

/**
 * @param {object} doc       – Document entity from localStorageEngine
 * @param {object} profile   – BusinessProfile entity
 * @param {object} settings  – AppSettings entity
 * @param {number} templateId – 1-5
 * @returns {string} complete HTML
 */
export function generateInvoiceHTML(doc, profile, settings, templateId = 1) {
  const fns = { 1: templateClassic, 2: templateModern, 3: templateBold, 4: templateMinimal, 5: templateStudio };
  const fn = fns[templateId] || templateClassic;
  return fn(doc, profile, settings);
}

/**
 * Opens a new window with the rendered invoice and auto-triggers print.
 */
export function printInvoice(doc, profile, settings, templateId = 1) {
  const html = generateInvoiceHTML(doc, profile, settings, templateId);
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
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
