/**
 * invoiceTemplates.js
 * Generates a complete, self-contained HTML invoice for printing / emailing.
 * Call generateInvoiceHTML(doc, profile, settings, templateId) → HTML string.
 *
 * Design rules that every template obeys:
 *  - Five type sizes only (micro / fine / body / lead / hero). Nothing else.
 *  - Three weights only (400 / 500 / 700).
 *  - No gradients, no zebra striping, no drop shadows. Hairlines and space.
 *  - One accent colour, used in at most three places per document.
 *  - Money is always tabular-figure aligned.
 *
 * Every template is customisable — colour, header treatment, body font and
 * sign-off line. Each keeps its identity in the BODY (how line items are
 * presented, how the total is set, whether there is a side rail), so changing
 * a header never collapses two templates into the same document. "Personal"
 * additionally unlocks the body choices the others keep fixed.
 *
 * Customisation is stored per template under AppSettings.invoice_custom as
 * { "<templateId>": {…} }, so tuning Atelier does not disturb Statement.
 */

// ── Formatting ───────────────────────────────────────────────────────
function fmt(sym, amount) {
  return `${sym}${(Number(amount) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Quantities are counts, not money — "1" reads correctly, "1.00" reads like a bug.
function fmtQty(q) {
  const n = Number(q ?? 1);
  if (!Number.isFinite(n)) return "1";
  return Number.isInteger(n) ? String(n) : n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

function fmtDate(str) {
  if (!str) return "";
  try { return new Date(str).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
  catch { return str; }
}

// Escape every piece of user-entered text before it reaches the document.
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Preserve author line breaks in free-text blocks (notes, payment instructions).
function escMultiline(s) {
  return esc(s).replace(/\r?\n/g, "<br>");
}

// Accent tints are rgba over white paper rather than color-mix(), which is
// unsupported in older print engines and silently renders transparent.
function tint(hex, alpha) {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return `rgba(20,23,28,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const CURRENCIES = { GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$" };
const symbolFor = (code) => CURRENCIES[code] || (code ? code + " " : "£");

const issueDateOf = (doc) => doc.issue_date || doc.created_at || new Date().toISOString();
const typeLabelOf = (doc) => (doc.document_type === "invoice" ? "Invoice" : "Estimate");

function totalLabelOf(doc) {
  if (doc.status === "paid") return "Paid in full";
  return doc.document_type === "invoice" ? "Amount due" : "Total";
}

// ── Customisation vocabulary ─────────────────────────────────────────
export const HEADER_STYLES = ["band", "minimal", "centered"];

export const HEADER_LABELS = {
  band: "Block",
  minimal: "Hairline",
  centered: "Centred",
};

// System stacks only. An earlier build pulled Inter from Google Fonts inside
// the print iframe, which snapshots after ~200ms — the webfont regularly lost
// that race and the document printed in a fallback anyway. Everything below is
// already resident on the devices Flowtone runs on.
export const FONT_CHOICES = ["sans", "grotesk", "geometric", "serif", "mono"];

export const FONT_STACKS = {
  sans: `-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Inter,"Helvetica Neue",Arial,sans-serif`,
  grotesk: `"Helvetica Neue",Helvetica,"Inter",Arial,"Liberation Sans",sans-serif`,
  geometric: `"Avenir Next","Avenir",Futura,"Century Gothic","Trebuchet MS",sans-serif`,
  serif: `"Hoefler Text","Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif`,
  mono: `ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace`,
};

export const FONT_LABELS = {
  sans: "Sans",
  grotesk: "Grotesk",
  geometric: "Geometric",
  serif: "Serif",
  mono: "Mono",
};

// Muted, document-grade tones. Saturated colours are what make an invoice look
// like a template, so they are deliberately not on the menu — the custom picker
// is still there for anyone who insists.
export const ACCENT_PRESETS = [
  "#14171c", // Ink
  "#1c3a5e", // Oxford
  "#1e4436", // Forest
  "#6d2434", // Claret
  "#8a6a3c", // Bronze
  "#4a5462", // Slate
];

export const ACCENT_LABELS = {
  "#14171c": "Ink",
  "#1c3a5e": "Oxford",
  "#1e4436": "Forest",
  "#6d2434": "Claret",
  "#8a6a3c": "Bronze",
  "#4a5462": "Slate",
};

// Body choices the other templates keep fixed as part of their identity.
// Personal unlocks them — that is what makes it the personal one now that
// colour, header, font and sign-off are available everywhere.
export const ITEMS_STYLES = ["table", "editorial", "slim", "tinted"];
export const ITEMS_LABELS = {
  table: "Columns",
  editorial: "Editorial",
  slim: "Slim",
  tinted: "Filled",
};

export const TOTALS_STYLES = ["stack", "band"];
export const TOTALS_LABELS = { stack: "Stacked", band: "Full width" };

export const DENSITIES = ["relaxed", "compact"];
export const DENSITY_LABELS = { relaxed: "Relaxed", compact: "Compact" };

export const DEFAULT_FOOTER_TEXT = "Thank you for the music.";

// Each template's own starting point. These are what gave every template "its
// own colour"; they are now defaults rather than hardcoded values.
export const TEMPLATE_DEFAULTS = {
  1: { accent_color: "#14171c", header_style: "minimal",  font: "sans",      items_style: "table",     totals_style: "stack", density: "relaxed" },
  2: { accent_color: "#14171c", header_style: "centered", font: "serif",     items_style: "editorial", totals_style: "band",  density: "relaxed" },
  3: { accent_color: "#1c3a5e", header_style: "band",     font: "sans",      items_style: "tinted",    totals_style: "stack", density: "relaxed" },
  4: { accent_color: "#1e4436", header_style: "minimal",  font: "sans",      items_style: "slim",      totals_style: "stack", density: "relaxed" },
  6: { accent_color: "#1c3a5e", header_style: "band",     font: "geometric", items_style: "table",     totals_style: "stack", density: "relaxed" },
};

// Kept for callers that want a plain default object.
export const DEFAULT_CUSTOM = { ...TEMPLATE_DEFAULTS[2], footer_text: DEFAULT_FOOTER_TEXT, show_logo: true };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Clamps arbitrary input onto the rails. Both the Settings editor and the AI
 * action run through here, so neither can invent fields or change the parts of
 * the document that are not negotiable.
 */
export function sanitizeCustom(raw, templateId = 2) {
  const base = TEMPLATE_DEFAULTS[resolveTemplateId(templateId)] || TEMPLATE_DEFAULTS[2];
  const r = raw && typeof raw === "object" ? raw : {};
  const pick = (val, allowed, fallback) => (allowed.includes(val) ? val : fallback);
  return {
    accent_color: typeof r.accent_color === "string" && HEX_RE.test(r.accent_color.trim())
      ? r.accent_color.trim().toLowerCase() : base.accent_color,
    header_style: pick(r.header_style, HEADER_STYLES, base.header_style),
    font: pick(r.font, FONT_CHOICES, base.font),
    footer_text: typeof r.footer_text === "string" ? r.footer_text.slice(0, 160) : DEFAULT_FOOTER_TEXT,
    show_logo: r.show_logo === undefined ? true : !!r.show_logo,
    // Personal-only; harmless on the others, which pass their own values.
    items_style: pick(r.items_style, ITEMS_STYLES, base.items_style),
    totals_style: pick(r.totals_style, TOTALS_STYLES, base.totals_style),
    density: pick(r.density, DENSITIES, base.density),
  };
}

// Older builds stored one flat object, which was the Personal template's look.
const isLegacyFlat = (store) =>
  !!store && typeof store === "object" &&
  (typeof store.accent_color === "string" || typeof store.header_style === "string" || typeof store.footer_text === "string");

/** Reads the saved look for one template, falling back to its defaults. */
export function getTemplateCustom(settings, templateId) {
  const id = resolveTemplateId(templateId);
  const store = settings?.invoice_custom;
  let raw = null;
  if (store && typeof store === "object") {
    raw = isLegacyFlat(store) ? (id === 6 ? store : null) : (store[String(id)] || null);
  }
  return sanitizeCustom(raw, id);
}

/**
 * Returns the whole invoice_custom object with one template's look patched,
 * ready to write back to AppSettings. Migrates the legacy flat shape into the
 * Personal slot on first write.
 */
export function setTemplateCustom(settings, templateId, patch) {
  const id = resolveTemplateId(templateId);
  const store = settings?.invoice_custom;
  let next = {};
  if (store && typeof store === "object") {
    next = isLegacyFlat(store) ? { 6: sanitizeCustom(store, 6) } : { ...store };
  }
  next[String(id)] = sanitizeCustom({ ...(next[String(id)] || {}), ...patch }, id);
  return next;
}

// ── Shared shell ─────────────────────────────────────────────────────
function baseCSS(c) {
  const accent = c.accent_color;
  const compact = c.density === "compact";
  return `
  :root{
    --fs-micro:9.5px; --fs-fine:11.5px; --fs-body:13px; --fs-lead:16px; --fs-hero:30px;
    --ink:#14171c; --body:#434a55; --muted:#8b929d; --hair:#e4e7ec; --wash:#f6f7f9;
    --paid:#2f6b4f;
    --accent:${accent};
    --accent-06:${tint(accent, 0.06)};
    --accent-14:${tint(accent, 0.14)};
    --font-body:${FONT_STACKS[c.font] || FONT_STACKS.sans};
    --row:${compact ? "7px" : "11px"};
    --gap:${compact ? "18px" : "26px"};
  }
  *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{background:#fff;color:var(--body);font-family:var(--font-body);
    font-size:var(--fs-body);line-height:1.55;-webkit-font-smoothing:antialiased;
    -moz-osx-font-smoothing:grayscale}
  .sheet{max-width:820px;margin:0 auto;padding:40px 44px 52px;position:relative}
  .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
  .lbl{font-size:var(--fs-micro);text-transform:uppercase;letter-spacing:.16em;
    font-weight:600;color:var(--muted);display:block}
  .fine{font-size:var(--fs-fine);color:var(--muted);line-height:1.7}
  .lead{font-size:var(--fs-lead);color:var(--ink);font-weight:500;letter-spacing:-.01em}
  .hero{font-size:var(--fs-hero);color:var(--ink);font-weight:700;letter-spacing:-.022em;line-height:1.1}
  .rule{border:0;border-top:1px solid var(--hair)}
  .rule-ink{border:0;border-top:1px solid var(--ink)}
  .keep{page-break-inside:avoid;break-inside:avoid}
  a{color:inherit;text-decoration:none}

  /* Line items — one table, four presentations. */
  table.items{width:100%;border-collapse:collapse}
  table.items th{font-size:var(--fs-micro);text-transform:uppercase;letter-spacing:.16em;
    font-weight:600;color:var(--muted);text-align:left;padding:0 0 9px}
  table.items td{font-size:var(--fs-body);color:var(--body);padding:var(--row) 0;
    border-top:1px solid var(--hair);vertical-align:top}
  table.items th.r,table.items td.r{text-align:right}
  table.items td.desc{color:var(--ink)}
  table.items .sub{display:block;font-size:var(--fs-fine);color:var(--muted);margin-top:2px}

  @page{size:A4;margin:12mm}
  @media print{
    .sheet{padding:0;max-width:none}
    table.items{page-break-inside:auto}
    thead{display:table-header-group}
    tr{page-break-inside:avoid;break-inside:avoid}
  }`;
}

function page({ title, custom, css = "", body }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${baseCSS(custom)}${css}</style>
</head><body>${body}</body></html>`;
}

// ── Shared blocks ────────────────────────────────────────────────────

// Quiet settled marker. An earlier build used a rotated stamp with a 3px
// border, which was the most template-looking element in the document.
function paidMark(doc) {
  if (doc.status !== "paid") return "";
  const when = doc.paid_date ? " · " + fmtDate(doc.paid_date) : "";
  return `<div style="display:inline-block;border:1px solid var(--paid);color:var(--paid);
    font-size:var(--fs-micro);text-transform:uppercase;letter-spacing:.16em;font-weight:600;
    padding:5px 10px;">Paid${esc(when)}</div>`;
}

function fromLines(profile) {
  const bits = [];
  if (profile?.address_line_1) bits.push(esc(profile.address_line_1));
  if (profile?.address_line_2) bits.push(esc(profile.address_line_2));
  const cityLine = [profile?.city, profile?.postcode].filter(Boolean).join(" ");
  if (cityLine) bits.push(esc(cityLine));
  if (profile?.email) bits.push(esc(profile.email));
  if (profile?.phone) bits.push(esc(profile.phone));
  return bits.join("<br>");
}

function logoTag(logo, maxH = 44, invert = false) {
  if (!logo) return "";
  return `<img src="${esc(logo)}" alt="" style="max-height:${maxH}px;max-width:170px;
    object-fit:contain;display:block;${invert ? "filter:brightness(0) invert(1);" : ""}">`;
}

/**
 * The three header treatments, shared by every template.
 *
 * Templates keep their identity in the body — line-item presentation, totals
 * treatment, whether there is a side rail — so a header can be swapped without
 * two templates becoming the same document.
 *
 * "band" is a full-bleed block and carries its own padding, so callers place it
 * ABOVE .sheet. "centered" and "minimal" sit inside .sheet and take their
 * horizontal padding from it — giving them their own as well double-pads them
 * and leaves rules visibly inset from the content column.
 *
 * @param {object} o.grand  Atelier's roomier setting: more space, tracked wordmark
 */
function renderHeader({ style, doc, profile, custom, grand = false }) {
  const label = typeLabelOf(doc);
  const number = esc(doc.document_number || "");
  const showLogo = custom.show_logo && !!profile?.logo;
  const name = esc(profile?.business_name || "");

  if (style === "band") {
    return `
    <div class="keep" style="background:var(--accent);color:#fff;padding:${grand ? "34px 44px" : "30px 32px"};
      display:flex;justify-content:space-between;align-items:flex-start;gap:24px;">
      <div>
        ${showLogo ? logoTag(profile.logo, 38, true) : ""}
        <div style="font-size:var(--fs-lead);font-weight:700;letter-spacing:-.01em;
          margin-top:${showLogo ? "11px" : "0"};">${name}</div>
        <div style="font-size:var(--fs-fine);color:rgba(255,255,255,.72);line-height:1.7;margin-top:5px;">${fromLines(profile)}</div>
      </div>
      <div style="text-align:right;">
        <span class="lbl" style="color:rgba(255,255,255,.72);margin-bottom:4px;">${label}</span>
        <div class="num" style="font-size:var(--fs-lead);font-weight:700;">${number}</div>
      </div>
    </div>`;
  }

  if (style === "centered") {
    return `
    <header class="keep" style="text-align:center;">
      ${showLogo ? `<div style="display:flex;justify-content:center;margin-bottom:${grand ? "16px" : "14px"};">${logoTag(profile.logo, 46)}</div>` : ""}
      <div style="font-size:var(--fs-lead);color:var(--ink);letter-spacing:${grand ? ".28em" : ".22em"};
        text-transform:uppercase;font-weight:${grand ? "400" : "600"};">${name}</div>
      <div style="width:44px;height:2px;background:var(--accent);margin:${grand ? "16px" : "14px"} auto 0;"></div>
      <div class="fine" style="margin-top:${grand ? "14px" : "12px"};">${fromLines(profile)}</div>
      <div style="margin-top:${grand ? "34px" : "18px"};display:flex;justify-content:${grand ? "space-between" : "center"};
        align-items:flex-end;gap:20px;text-align:left;">
        ${grand ? `<div>
            <span class="lbl" style="margin-bottom:6px;">${label}</span>
            <div class="hero num">${number}</div>
          </div>
          ${paidMark(doc)}`
        : `<span class="lbl" style="color:var(--accent);">${label} · ${number}</span>`}
      </div>
      ${grand ? `<hr class="rule-ink" style="margin-top:14px;">` : ""}
    </header>`;
  }

  // minimal — name left, number right, one accent hairline
  return `
  <div>
    <div class="keep" style="display:flex;justify-content:space-between;align-items:flex-start;gap:32px;">
      <div>
        ${showLogo ? logoTag(profile.logo, 40) : ""}
        <div style="font-size:var(--fs-lead);color:var(--ink);font-weight:700;
          margin-top:${showLogo ? "12px" : "0"};">${name}</div>
        <div class="fine" style="margin-top:4px;">${fromLines(profile)}</div>
        ${profile?.tax_id ? `<div class="fine">Tax ID ${esc(profile.tax_id)}</div>` : ""}
      </div>
      <div style="text-align:right;">
        <span class="lbl" style="color:var(--accent);margin-bottom:4px;">${label}</span>
        <div class="lead num" style="font-weight:700;">${number}</div>
        ${doc.status === "paid" ? `<div style="margin-top:10px;">${paidMark(doc)}</div>` : ""}
      </div>
    </div>
    <div style="margin-top:18px;height:2px;background:var(--accent);"></div>
  </div>`;
}

/**
 * @param {string} variant  "table" (4 cols) | "editorial" (2 cols, qty inline)
 *                          | "tinted" (4 cols, accent header) | "slim" (3 cols)
 */
function itemsTable(items, sym, variant = "table") {
  const list = items || [];

  if (variant === "editorial") {
    const rows = list.map(item => {
      const qty = Number(item.quantity ?? 1);
      const unit = Number(item.unit_price) || 0;
      // A quantity of one adds nothing — high-end documents omit it.
      const sub = qty === 1 ? "" : `<span class="sub num">${fmtQty(qty)} × ${fmt(sym, unit)}</span>`;
      return `<tr>
        <td class="desc">${esc(item.description || "")}${sub}</td>
        <td class="r num">${fmt(sym, qty * unit)}</td>
      </tr>`;
    }).join("");
    return `<style>
        table.items td{padding:calc(var(--row) * 1.3) 0}
        table.items td.desc{font-size:var(--fs-lead);line-height:1.35}
        table.items td.r{font-size:var(--fs-body)}
      </style>
      <table class="items" style="margin-top:6px">
      <thead><tr><th>Description</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  if (variant === "slim") {
    const rows = list.map(item => {
      const qty = Number(item.quantity ?? 1);
      const unit = Number(item.unit_price) || 0;
      return `<tr>
        <td class="desc">${esc(item.description || "")}</td>
        <td class="r num">${fmtQty(qty)}</td>
        <td class="r num">${fmt(sym, qty * unit)}</td>
      </tr>`;
    }).join("");
    return `<table class="items" style="margin-top:6px">
      <thead><tr><th>Description</th><th class="r" style="width:52px">Qty</th>
        <th class="r" style="width:110px">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  const rows = list.map(item => {
    const qty = Number(item.quantity ?? 1);
    const unit = Number(item.unit_price) || 0;
    return `<tr>
      <td class="desc">${esc(item.description || "")}</td>
      <td class="r num">${fmtQty(qty)}</td>
      <td class="r num">${fmt(sym, unit)}</td>
      <td class="r num">${fmt(sym, qty * unit)}</td>
    </tr>`;
  }).join("");

  const tinted = variant === "tinted"
    ? `<style>
        table.items thead th{background:var(--accent-06);color:var(--accent);
          padding:9px 12px;border-bottom:1px solid var(--accent-14)}
        table.items td{padding:var(--row) 12px}
        table.items tbody tr:first-child td{border-top:0}
      </style>` : "";

  return `${tinted}<table class="items" style="margin-top:6px">
    <thead><tr><th>Description</th><th class="r" style="width:52px">Qty</th>
      <th class="r" style="width:104px">Unit</th><th class="r" style="width:116px">Amount</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// Minor rows (subtotal / discount / tax) — identical everywhere.
function minorRows(doc, sym) {
  const row = (label, val) =>
    `<div style="display:flex;justify-content:space-between;gap:28px;font-size:var(--fs-fine);
      color:var(--muted);padding:4px 0;">
      <span>${label}</span><span class="num">${val}</span></div>`;
  const out = [row("Subtotal", fmt(sym, doc.subtotal))];
  if (doc.discount_amount > 0) out.push(row("Discount", "−" + fmt(sym, doc.discount_amount)));
  if (doc.tax_amount > 0) out.push(row(`Tax ${doc.tax_rate || 0}%`, fmt(sym, doc.tax_amount)));
  return out.join("");
}

/**
 * @param {string} variant  "stack" — right-aligned column, rule above the figure
 *                          "band"  — full-width band with rules top and bottom
 */
function totalsBlock(doc, sym, variant = "stack") {
  const isPaid = doc.status === "paid";
  const heroColour = isPaid ? "var(--paid)" : "var(--accent)";
  const amount = fmt(sym, doc.total ?? doc.subtotal);

  if (variant === "band") {
    return `<div class="keep" style="margin-top:var(--gap);">
      <div style="display:flex;justify-content:flex-end;">
        <div style="min-width:260px;">${minorRows(doc, sym)}</div>
      </div>
      <div style="margin-top:14px;border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);
        padding:16px 0;display:flex;justify-content:space-between;align-items:baseline;gap:24px;">
        <span class="lbl" style="color:var(--ink);">${totalLabelOf(doc)}</span>
        <span class="hero num" style="color:${heroColour};">${amount}</span>
      </div>
    </div>`;
  }

  return `<div class="keep" style="margin-top:22px;margin-left:auto;min-width:270px;max-width:330px;">
    ${minorRows(doc, sym)}
    <div style="margin-top:10px;padding-top:13px;border-top:2px solid var(--accent);
      display:flex;justify-content:space-between;align-items:baseline;gap:20px;">
      <span class="lbl" style="color:var(--ink);">${totalLabelOf(doc)}</span>
      <span class="hero num" style="color:${heroColour};">${amount}</span>
    </div>
  </div>`;
}

function paymentLines(profile) {
  const lines = [];
  if (profile?.bank_name) lines.push(["Bank", profile.bank_name]);
  if (profile?.bank_account_name) lines.push(["Account name", profile.bank_account_name]);
  if (profile?.bank_sort_code) lines.push(["Sort code", profile.bank_sort_code]);
  if (profile?.bank_account_number) lines.push(["Account number", profile.bank_account_number]);
  if (profile?.bank_iban) lines.push(["IBAN", profile.bank_iban]);
  return lines;
}

/**
 * @param {string} variant  "columns" — label/value grid on bare paper
 *                          "panel"   — same grid inside a wash panel
 *                          "stacked" — single narrow column (sidebar)
 */
function paymentBlock(profile, variant = "columns") {
  const lines = paymentLines(profile);
  const note = profile?.payment_instructions;
  if (!lines.length && !note) return "";

  if (variant === "stacked") {
    const rows = lines.map(([k, v]) =>
      `<div style="margin-top:7px;"><span class="lbl">${esc(k)}</span>
        <span class="num" style="font-size:var(--fs-fine);color:var(--ink);">${esc(v)}</span></div>`).join("");
    return `<div style="margin-top:var(--gap);"><span class="lbl">Payment</span>${rows}
      ${note ? `<p class="fine" style="margin-top:9px;">${escMultiline(note)}</p>` : ""}</div>`;
  }

  const grid = lines.map(([k, v]) =>
    `<div><span class="lbl">${esc(k)}</span>
      <span class="num" style="font-size:var(--fs-fine);color:var(--ink);">${esc(v)}</span></div>`).join("");

  const inner = `
    <span class="lbl" style="margin-bottom:11px;">Payment details</span>
    ${lines.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:11px 26px;">${grid}</div>` : ""}
    ${note ? `<p class="fine" style="margin-top:${lines.length ? "12px" : "0"};">${escMultiline(note)}</p>` : ""}`;

  if (variant === "panel") {
    return `<div class="keep" style="margin-top:calc(var(--gap) + 4px);background:var(--wash);padding:18px 20px;">${inner}</div>`;
  }
  return `<div class="keep" style="margin-top:calc(var(--gap) + 4px);padding-top:18px;border-top:1px solid var(--hair);">${inner}</div>`;
}

function notesBlock(doc) {
  if (!doc.notes) return "";
  return `<div class="keep" style="margin-top:22px;">
    <span class="lbl" style="margin-bottom:6px;">Notes</span>
    <p class="fine" style="color:var(--body);max-width:62ch;">${escMultiline(doc.notes)}</p>
  </div>`;
}

function signOff(profile, text, { centred = false } = {}) {
  const line = (text && String(text).trim()) || DEFAULT_FOOTER_TEXT;
  const name = profile?.contact_name || profile?.business_name || "";
  return `<div style="margin-top:36px;padding-top:16px;border-top:1px solid var(--hair);${centred ? "text-align:center;" : ""}">
    <div style="font-size:var(--fs-fine);color:var(--ink);">${esc(line)}</div>
    ${name ? `<div class="fine" style="margin-top:3px;">${esc(name)}</div>` : ""}
  </div>`;
}

// Bill-to / dates row.
function partiesRow(doc, { showFrom = null } = {}) {
  const isInvoice = doc.document_type === "invoice";
  const cell = (label, value, sub = "") =>
    `<div><span class="lbl" style="margin-bottom:5px;">${label}</span>
      <div class="lead">${value}</div>
      ${sub ? `<div class="fine">${sub}</div>` : ""}</div>`;

  const dateCell = (label, value) =>
    `<div><span class="lbl" style="margin-bottom:5px;">${label}</span>
      <div style="font-size:var(--fs-body);color:var(--ink);">${value}</div></div>`;

  // Names need room to sit on one line; dates never do. Sizing them the same
  // is what makes "Chiltern House Events" break across two lines beside a
  // half-empty date column.
  const parties = [cell("Billed to", esc(doc.client_name || doc.title || ""), esc(doc.client_email || ""))];
  if (showFrom) parties.push(cell("From", esc(showFrom.name), esc(showFrom.email || "")));

  const dates = [dateCell(isInvoice ? "Issued" : "Date", fmtDate(issueDateOf(doc)))];
  if (isInvoice && doc.due_date) dates.push(dateCell("Due", fmtDate(doc.due_date)));
  if (!isInvoice && doc.valid_until) dates.push(dateCell("Valid until", fmtDate(doc.valid_until)));

  const wrap = (c, basis, min) => `<div style="flex:1 1 ${basis};min-width:${min};">${c}</div>`;

  // Bases are sized so the widest case — billed-to + from + issued + due —
  // still fits one line inside the 732px content column.
  return `<div class="keep" style="display:flex;gap:28px;flex-wrap:wrap;align-items:flex-start;
    padding:22px 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);">
    ${parties.map(c => wrap(c, "200px", "172px")).join("")}
    ${dates.map(c => wrap(c, "106px", "100px")).join("")}
  </div>`;
}

// ──────────────────────────────────────────────────────────────────────
//  TEMPLATE 1 — SIMPLE
//  Plain columns, bare paper, no fills. The unfussy invoice, done properly.
// ──────────────────────────────────────────────────────────────────────
function templateSimple(doc, profile, c) {
  const sym = symbolFor(doc.currency);
  const banded = c.header_style === "band";

  return page({
    title: `${typeLabelOf(doc)} ${doc.document_number || ""}`,
    custom: c,
    body: `${banded ? renderHeader({ style: "band", doc, profile, custom: c }) : ""}
<div class="sheet"${banded ? ' style="padding-top:28px;"' : ""}>
  ${banded ? "" : renderHeader({ style: c.header_style, doc, profile, custom: c })}
  <div style="margin-top:var(--gap);">${partiesRow(doc)}</div>
  <div style="margin-top:var(--gap);">${itemsTable(doc.line_items, sym, c.items_style)}</div>
  ${totalsBlock(doc, sym, c.totals_style)}
  ${paymentBlock(profile, "columns")}
  ${notesBlock(doc)}
  ${signOff(profile, c.footer_text, { centred: c.header_style === "centered" })}
</div>`,
  });
}

// ──────────────────────────────────────────────────────────────────────
//  TEMPLATE 2 — ATELIER
//  The high-end one. Wide margins, editorial line items, the amount set in
//  a full-width band. Accent appears exactly twice.
// ──────────────────────────────────────────────────────────────────────
function templateAtelier(doc, profile, c) {
  const sym = symbolFor(doc.currency);
  const isInvoice = doc.document_type === "invoice";
  const centred = c.header_style === "centered";
  const banded = c.header_style === "band";

  const meta = (k, v) => v
    ? `<div style="margin-left:38px;"><span class="lbl" style="margin-bottom:4px;">${k}</span>
        <div style="font-size:var(--fs-body);color:var(--ink);">${v}</div></div>`
    : "";

  return page({
    title: `${typeLabelOf(doc)} ${doc.document_number || ""}`,
    custom: c,
    css: `
      .sheet{padding:${banded ? "36px 66px 56px" : "64px 66px 56px"};max-width:800px}
      @media print{.sheet{padding:0}}
    `,
    body: `${banded ? renderHeader({ style: "band", doc, profile, custom: c, grand: true }) : ""}
<div class="sheet">
  ${banded ? "" : renderHeader({ style: c.header_style, doc, profile, custom: c, grand: centred })}

  <div class="keep" style="display:flex;justify-content:space-between;align-items:flex-start;
    gap:24px;flex-wrap:wrap;padding:24px 0 30px;">
    <div style="min-width:200px;">
      <span class="lbl" style="margin-bottom:6px;">${isInvoice ? "Billed to" : "Prepared for"}</span>
      <div class="lead" style="font-weight:400;">${esc(doc.client_name || doc.title || "")}</div>
      ${doc.client_email ? `<div class="fine">${esc(doc.client_email)}</div>` : ""}
    </div>
    <div style="display:flex;">
      ${meta(isInvoice ? "Issued" : "Date", fmtDate(issueDateOf(doc)))}
      ${isInvoice && doc.due_date ? meta("Due", fmtDate(doc.due_date)) : ""}
      ${!isInvoice && doc.valid_until ? meta("Valid until", fmtDate(doc.valid_until)) : ""}
    </div>
  </div>

  ${itemsTable(doc.line_items, sym, c.items_style)}
  ${totalsBlock(doc, sym, c.totals_style)}
  ${paymentBlock(profile, "columns")}
  ${notesBlock(doc)}
  ${signOff(profile, c.footer_text, { centred: true })}
</div>`,
  });
}

// ──────────────────────────────────────────────────────────────────────
//  TEMPLATE 3 — STATEMENT
//  Filled line-item header and a wash payment panel, then air. Confident
//  without the gradient-and-badge routine.
// ──────────────────────────────────────────────────────────────────────
function templateStatement(doc, profile, c) {
  const sym = symbolFor(doc.currency);
  const banded = c.header_style === "band";

  return page({
    title: `${typeLabelOf(doc)} ${doc.document_number || ""}`,
    custom: c,
    body: `${banded ? renderHeader({ style: "band", doc, profile, custom: c }) : ""}
<div class="sheet"${banded ? ' style="padding-top:28px;"' : ""}>
  ${banded ? "" : renderHeader({ style: c.header_style, doc, profile, custom: c })}

  <div style="margin-top:var(--gap);">${partiesRow(doc, {
    showFrom: profile?.contact_name ? { name: profile.contact_name, email: profile?.email } : null,
  })}</div>

  ${doc.status === "paid" && c.header_style !== "minimal" ? `<div style="margin-top:20px;">${paidMark(doc)}</div>` : ""}

  <div style="margin-top:var(--gap);">${itemsTable(doc.line_items, sym, c.items_style)}</div>
  ${totalsBlock(doc, sym, c.totals_style)}
  ${paymentBlock(profile, "panel")}
  ${notesBlock(doc)}
  ${signOff(profile, c.footer_text, { centred: c.header_style === "centered" })}
</div>`,
  });
}

// ──────────────────────────────────────────────────────────────────────
//  TEMPLATE 4 — COLUMN
//  Everything contextual lives in a left rail; the right column is only the
//  work and the money.
//
//  Note: the rail background covers its own flex cell, so on an invoice that
//  runs past one page the tint stops at the page break. Line-item counts that
//  long are rare here and the break still reads cleanly.
// ──────────────────────────────────────────────────────────────────────
function templateColumn(doc, profile, c) {
  const sym = symbolFor(doc.currency);
  const isInvoice = doc.document_type === "invoice";
  const label = typeLabelOf(doc);

  const railItem = (k, v, sub = "") => v
    ? `<div style="margin-top:22px;"><span class="lbl" style="margin-bottom:5px;">${k}</span>
        <div style="font-size:var(--fs-body);color:var(--ink);line-height:1.5;">${v}</div>
        ${sub ? `<div class="fine">${sub}</div>` : ""}</div>`
    : "";

  // The rail already carries the identity, so the header treatments apply to
  // the main column only.
  let head;
  if (c.header_style === "band") {
    head = `<div class="keep" style="background:var(--accent);color:#fff;padding:20px 22px;
      display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:24px;">
      <span class="lbl" style="color:rgba(255,255,255,.72);">${label}</span>
      <div class="num" style="font-size:var(--fs-lead);font-weight:700;">${esc(doc.document_number || "")}</div>
    </div>`;
  } else if (c.header_style === "centered") {
    head = `<div class="keep" style="text-align:center;padding-bottom:16px;border-bottom:1px solid var(--hair);">
      <span class="lbl" style="margin-bottom:6px;">${label}</span>
      <div class="hero num" style="color:var(--accent);">${esc(doc.document_number || "")}</div>
      <div style="width:44px;height:2px;background:var(--accent);margin:14px auto 0;"></div>
      ${doc.status === "paid" ? `<div style="margin-top:14px;">${paidMark(doc)}</div>` : ""}
    </div>`;
  } else {
    head = `<div class="keep" style="display:flex;justify-content:space-between;align-items:flex-end;gap:20px;
      padding-bottom:16px;border-bottom:1px solid var(--hair);">
      <div>
        <span class="lbl" style="margin-bottom:5px;">${label}</span>
        <div class="hero num" style="color:var(--accent);">${esc(doc.document_number || "")}</div>
      </div>
      ${paidMark(doc)}
    </div>`;
  }

  return page({
    title: `${label} ${doc.document_number || ""}`,
    custom: c,
    css: `
      .sheet{padding:0;max-width:860px}
      /* min-height makes the rail run the full sheet on a one-page invoice
         instead of stopping wherever its own content happens to end. */
      .row{display:flex;align-items:stretch;min-height:1120px}
      .rail{flex:0 0 228px;background:var(--wash);border-left:3px solid var(--accent);
        padding:38px 24px 40px}
      .main{flex:1;padding:38px 34px 44px;min-width:0}
      @media print{
        .sheet{padding:0}
        .row{min-height:256mm}
        .rail{flex-basis:200px;padding:0 20px 24px 20px}
        .main{padding:0 0 0 30px}
      }
    `,
    body: `<div class="sheet"><div class="row">
  <aside class="rail">
    ${c.show_logo ? logoTag(profile?.logo, 40) : ""}
    <div class="lead" style="font-weight:700;margin-top:${c.show_logo && profile?.logo ? "12px" : "0"};">${esc(profile?.business_name || "")}</div>
    <div class="fine" style="margin-top:5px;">${fromLines(profile)}</div>
    ${profile?.tax_id ? `<div class="fine">Tax ID ${esc(profile.tax_id)}</div>` : ""}

    ${railItem(isInvoice ? "Billed to" : "Prepared for", esc(doc.client_name || doc.title || ""), esc(doc.client_email || ""))}
    ${railItem(isInvoice ? "Issued" : "Date", fmtDate(issueDateOf(doc)))}
    ${isInvoice && doc.due_date ? railItem("Due", fmtDate(doc.due_date)) : ""}
    ${!isInvoice && doc.valid_until ? railItem("Valid until", fmtDate(doc.valid_until)) : ""}
    ${paymentBlock(profile, "stacked")}
  </aside>

  <section class="main">
    ${head}
    <div style="margin-top:24px;">${itemsTable(doc.line_items, sym, c.items_style)}</div>
    ${totalsBlock(doc, sym, c.totals_style)}
    ${notesBlock(doc)}
    ${signOff(profile, c.footer_text, { centred: c.header_style === "centered" })}
  </section>
</div></div>`,
  });
}

// ──────────────────────────────────────────────────────────────────────
//  TEMPLATE 6 — PERSONAL
//  Same shared controls as the others, plus the body choices they keep fixed:
//  line-item presentation, totals treatment, spacing and logo.
// ──────────────────────────────────────────────────────────────────────
function templatePersonal(doc, profile, c) {
  const sym = symbolFor(doc.currency);
  const banded = c.header_style === "band";

  return page({
    title: `${typeLabelOf(doc)} ${doc.document_number || ""}`,
    custom: c,
    body: `${banded ? renderHeader({ style: "band", doc, profile, custom: c }) : ""}
<div class="sheet"${banded ? ' style="padding-top:28px;"' : ""}>
  ${banded ? "" : renderHeader({ style: c.header_style, doc, profile, custom: c })}
  <div style="margin-top:var(--gap);">${partiesRow(doc)}</div>
  ${doc.status === "paid" && c.header_style !== "minimal" ? `<div style="margin-top:20px;">${paidMark(doc)}</div>` : ""}
  <div style="margin-top:var(--gap);">${itemsTable(doc.line_items, sym, c.items_style)}</div>
  ${totalsBlock(doc, sym, c.totals_style)}
  ${paymentBlock(profile, "columns")}
  ${notesBlock(doc)}
  ${signOff(profile, c.footer_text, { centred: c.header_style === "centered" })}
</div>`,
  });
}

// ──────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ──────────────────────────────────────────────────────────────────────
export const TEMPLATE_DEFS = [
  { id: 2, name: "Atelier",   desc: "Wide margins, editorial line items, one figure that matters." },
  { id: 1, name: "Simple",    desc: "Plain columns on bare paper. Nothing to distract from the numbers." },
  { id: 3, name: "Statement", desc: "Filled item header and a payment panel. Confident, not loud." },
  { id: 4, name: "Column",    desc: "Details in a side rail, the work and the total on their own." },
  { id: 6, name: "Personal",  desc: "Everything above, plus line items, totals and spacing." },
];

/** New accounts start on Atelier — it is the one that shows the app off. */
export const DEFAULT_TEMPLATE_ID = 2;

// Retired ids and what they now resolve to. 5 was Studio (purple gradient +
// music-note watermark); its closest successor is Atelier.
const LEGACY_TEMPLATE_IDS = { 5: 2 };

/**
 * Maps a stored invoice_template value onto an id that still exists.
 * Anything reading settings.invoice_template should go through this so the
 * label shown in Settings and the document actually printed cannot diverge.
 */
export function resolveTemplateId(id) {
  const n = Number(id);
  if (TEMPLATE_DEFS.some(t => t.id === n)) return n;
  return LEGACY_TEMPLATE_IDS[n] || DEFAULT_TEMPLATE_ID;
}

/**
 * @param {object} doc        – Document entity
 * @param {object} profile    – BusinessProfile entity
 * @param {object} settings   – AppSettings entity
 * @param {number} templateId – see TEMPLATE_DEFS
 * @returns {string} complete HTML
 */
export function generateInvoiceHTML(doc, profile, settings, templateId = DEFAULT_TEMPLATE_ID) {
  const id = resolveTemplateId(templateId);
  const custom = getTemplateCustom(settings, id);
  const fns = {
    1: templateSimple,
    2: templateAtelier,
    3: templateStatement,
    4: templateColumn,
    6: templatePersonal,
  };
  return fns[id](doc || {}, profile || {}, custom);
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
export function printInvoice(doc, profile, settings, templateId = DEFAULT_TEMPLATE_ID) {
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
    // Small delay lets layout settle before the print snapshot. Type is a
    // system stack, so there is no webfont to wait on.
    setTimeout(() => {
      win.onafterprint = () => setTimeout(() => iframe.remove(), 500);
      try { win.focus(); win.print(); } catch { /* ignore */ }
    }, 200);
    // Safety net: never let the hidden frame linger if afterprint never fires
    setTimeout(() => {
      if (document.getElementById("flowtone-print-frame")) iframe.remove();
    }, 120000);
  };

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}

/**
 * Builds the plain-text parts of an invoice email (recipient, subject, body),
 * shared by the mailto link and the native Web Share sheet so both read the same.
 */
export function buildInvoiceEmailParts(doc, profile, settings, recipientEmail) {
  const sym = symbolFor(doc.currency);
  const isInvoice = doc.document_type === "invoice";
  const typeLabel = typeLabelOf(doc);
  const to = recipientEmail || doc.client_email || "";
  const subject = `${typeLabel} ${doc.document_number || ""} – ${doc.title || profile?.business_name || ""}`;
  const total = fmt(sym, doc.total || doc.subtotal);
  const due = isInvoice && doc.due_date ? `\nDue date: ${fmtDate(doc.due_date)}` : "";
  const payLine = profile?.bank_account_number
    ? `\n\nPayment details:\nBank: ${profile.bank_name || ""}\nAccount: ${profile.bank_account_number}${profile.bank_sort_code ? "\nSort code: " + profile.bank_sort_code : ""}`
    : "";
  const body = `Hi,\n\nPlease find attached your ${typeLabel.toLowerCase()} ${doc.document_number || ""} for ${total}.${due}${payLine}\n\nIf you have any questions, please don't hesitate to get in touch.\n\nKind regards,\n${profile?.contact_name || profile?.business_name || ""}`;
  return { to, subject, body };
}

/**
 * Builds a mailto: link with invoice summary in the body.
 */
export function buildMailtoLink(doc, profile, settings, recipientEmail) {
  const { to, subject, body } = buildInvoiceEmailParts(doc, profile, settings, recipientEmail);
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
