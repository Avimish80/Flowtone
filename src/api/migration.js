/**
 * migration.js — One-time schema migration from old data model to new.
 *
 * Old model:
 *   - Separate Invoice and Estimate tables
 *   - WorkEvent has client_name, invoice_id, estimate_id (denormalized + bidirectional FKs)
 *   - Records use created_date
 *
 * New model:
 *   - Unified Document table (document_type: 'invoice' | 'estimate')
 *   - WorkEvent has only client_id (no client_name, no invoice_id/estimate_id)
 *   - Document owns work_event_id (one-directional)
 *   - Records use created_at / updated_at
 *   - New tables: Payment, DocumentActivityLog, BusinessProfile
 *   - AppSettings gets numbering fields
 */

const MIGRATION_KEY = "musician_os_migration_version";
const CURRENT_VERSION = 1;

function getStore(entityName) {
  const raw = localStorage.getItem(`musician_os_${entityName}`);
  return raw ? JSON.parse(raw) : [];
}

function setStore(entityName, records) {
  localStorage.setItem(`musician_os_${entityName}`, JSON.stringify(records));
}

/**
 * Migrate Invoice and Estimate records into a unified Document table.
 * Preserves all original IDs so existing foreign keys remain valid.
 */
function migrateDocuments() {
  const oldInvoices = getStore("Invoice");
  const oldEstimates = getStore("Estimate");
  const existingDocuments = getStore("Document");

  // Skip if already migrated (Document table has records and old tables are still there)
  if (existingDocuments.length > 0) return;
  if (oldInvoices.length === 0 && oldEstimates.length === 0) return;

  const documents = [];

  for (const inv of oldInvoices) {
    const { created_date: _cd, invoice_number: _in, ...invClean } = inv;
    documents.push({
      ...invClean,
      document_type: "invoice",
      document_number: inv.invoice_number || "",
      // Map old status to new lifecycle
      status: mapInvoiceStatus(inv.status),
      // Ensure proper field names
      subtotal: inv.subtotal || 0,
      total: inv.subtotal || 0, // Will be recalculated with tax/discount later
      line_items: inv.line_items || [],
      client_id: inv.client_id || "",
      client_email: inv.client_email || "",
      work_event_id: inv.work_event_id || "",
      is_standalone: !inv.work_event_id,
      is_locked: inv.status === "sent" || inv.status === "paid",
      locked_at: inv.status === "sent" || inv.status === "paid" ? inv.sent_date || null : null,
      discount_type: null,
      discount_value: 0,
      discount_amount: 0,
      tax_rate: 0,
      tax_amount: 0,
      paid_amount: inv.status === "paid" ? (inv.subtotal || 0) : 0,
      paid_date: inv.status === "paid" ? (inv.sent_date || inv.created_date || null) : null,
      payment_method: "",
      payment_terms_days: 30,
      converted_from_id: "",
      unlocked_reason: "",
      notes: inv.notes || "",
      currency: inv.currency || "GBP",
      due_date: inv.due_date || "",
      valid_until: "",
      sent_date: inv.sent_date || "",
      accepted_date: "",
      created_at: inv.created_at || inv.created_date || new Date().toISOString(),
      updated_at: inv.updated_at || new Date().toISOString(),
    });
  }

  for (const est of oldEstimates) {
    const { created_date: _cd, estimate_number: _en, invoice_number: _in, ...estClean } = est;
    documents.push({
      ...estClean,
      document_type: "estimate",
      document_number: est.estimate_number || est.invoice_number || "",
      status: mapEstimateStatus(est.status),
      subtotal: est.subtotal || 0,
      total: est.subtotal || 0,
      line_items: est.line_items || [],
      client_id: est.client_id || "",
      client_email: est.client_email || "",
      work_event_id: est.work_event_id || "",
      is_standalone: !est.work_event_id,
      is_locked: est.status === "sent" || est.status === "accepted",
      locked_at: est.status === "sent" ? est.sent_date || null : null,
      discount_type: null,
      discount_value: 0,
      discount_amount: 0,
      tax_rate: 0,
      tax_amount: 0,
      paid_amount: 0,
      paid_date: null,
      payment_method: "",
      payment_terms_days: 30,
      converted_from_id: "",
      unlocked_reason: "",
      notes: est.notes || "",
      currency: est.currency || "GBP",
      due_date: "",
      valid_until: est.valid_until || est.due_date || "",
      sent_date: est.sent_date || "",
      accepted_date: est.accepted_date || "",
      created_at: est.created_at || est.created_date || new Date().toISOString(),
      updated_at: est.updated_at || new Date().toISOString(),
    });
  }

  setStore("Document", documents);
  console.log(`[migration] Migrated ${oldInvoices.length} invoices + ${oldEstimates.length} estimates → ${documents.length} documents`);
}

function mapInvoiceStatus(old) {
  switch (old) {
    case "draft": return "draft";
    case "sent": return "sent";
    case "paid": return "paid";
    case "cancelled": return "cancelled";
    case "void": return "void";
    default: return "draft";
  }
}

function mapEstimateStatus(old) {
  switch (old) {
    case "draft": return "draft";
    case "sent": return "sent";
    case "accepted": return "accepted";
    case "rejected": return "rejected";
    case "converted": return "converted";
    default: return "draft";
  }
}

/**
 * Clean up WorkEvent records:
 * - Remove denormalized client_name (keep client_id)
 * - Remove bidirectional invoice_id / estimate_id
 * - Rename created_date → created_at, add updated_at
 */
function migrateWorkEvents() {
  const events = getStore("WorkEvent");
  if (events.length === 0) return;

  let migrated = false;
  const updated = events.map((ev) => {
    // Check if already migrated (has created_at and no invoice_id)
    if (ev.created_at && !("invoice_id" in ev) && !("estimate_id" in ev) && !("client_name" in ev)) {
      return ev;
    }
    migrated = true;
    const clean = { ...ev };
    // Remove bidirectional FK fields
    delete clean.invoice_id;
    delete clean.estimate_id;
    // Remove denormalized client_name (we keep client_id)
    delete clean.client_name;
    // Migrate timestamps
    if (!clean.created_at) {
      clean.created_at = clean.created_date || new Date().toISOString();
    }
    if (!clean.updated_at) {
      clean.updated_at = new Date().toISOString();
    }
    delete clean.created_date;
    return clean;
  });

  if (migrated) {
    setStore("WorkEvent", updated);
    console.log(`[migration] Cleaned up ${events.length} work events`);
  }
}

/**
 * Migrate Client records: add timestamps
 */
function migrateClients() {
  const clients = getStore("Client");
  if (clients.length === 0) return;

  let migrated = false;
  const updated = clients.map((c) => {
    if (c.created_at) return c;
    migrated = true;
    const clean = { ...c };
    clean.created_at = clean.created_date || new Date().toISOString();
    clean.updated_at = new Date().toISOString();
    delete clean.created_date;
    return clean;
  });

  if (migrated) {
    setStore("Client", updated);
    console.log(`[migration] Updated ${clients.length} client records`);
  }
}

/**
 * Migrate Equipment records: add timestamps
 */
function migrateEquipment() {
  const items = getStore("Equipment");
  if (items.length === 0) return;

  let migrated = false;
  const updated = items.map((e) => {
    if (e.created_at) return e;
    migrated = true;
    const clean = { ...e };
    clean.created_at = clean.created_date || new Date().toISOString();
    clean.updated_at = new Date().toISOString();
    delete clean.created_date;
    return clean;
  });

  if (migrated) {
    setStore("Equipment", updated);
    console.log(`[migration] Updated ${items.length} equipment records`);
  }
}

/**
 * Ensure AppSettings has the new numbering + tax fields.
 */
function migrateAppSettings() {
  const settings = getStore("AppSettings");
  const existing = settings[0] || {};

  const defaults = {
    default_currency: "GBP",
    default_payment_terms_days: 30,
    default_nav_app: "google_maps",
    invoice_number_prefix: "INV-",
    invoice_number_next: 1,
    estimate_number_prefix: "EST-",
    estimate_number_next: 1,
    default_tax_rate: 0,
  };

  let needsUpdate = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (existing[key] == null) {
      existing[key] = value;
      needsUpdate = true;
    }
  }

  if (!existing.id) {
    existing.id = crypto.randomUUID();
    needsUpdate = true;
  }
  if (!existing.created_at) {
    existing.created_at = existing.created_date || new Date().toISOString();
    delete existing.created_date;
    needsUpdate = true;
  }
  if (!existing.updated_at) {
    existing.updated_at = new Date().toISOString();
    needsUpdate = true;
  }

  if (needsUpdate) {
    setStore("AppSettings", [existing]);
    console.log("[migration] Updated AppSettings with numbering fields");
  }
}

/**
 * Ensure BusinessProfile exists (empty template).
 */
function ensureBusinessProfile() {
  const profiles = getStore("BusinessProfile");
  if (profiles.length > 0) return;

  setStore("BusinessProfile", [{
    id: crypto.randomUUID(),
    business_name: "",
    contact_name: "",
    email: "",
    phone: "",
    address_line_1: "",
    address_line_2: "",
    city: "",
    postcode: "",
    country: "GB",
    tax_id: "",
    bank_name: "",
    bank_account_name: "",
    bank_sort_code: "",
    bank_account_number: "",
    bank_iban: "",
    payment_instructions: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }]);
  console.log("[migration] Created empty BusinessProfile");
}

/**
 * Ensure Payment and DocumentActivityLog tables exist (empty arrays).
 */
function ensureNewTables() {
  if (localStorage.getItem("musician_os_Payment") === null) {
    setStore("Payment", []);
  }
  if (localStorage.getItem("musician_os_DocumentActivityLog") === null) {
    setStore("DocumentActivityLog", []);
  }
}

/**
 * Run the full migration. Idempotent — safe to call multiple times.
 */
export function runMigration() {
  const currentVersion = Number(localStorage.getItem(MIGRATION_KEY) || 0);
  if (currentVersion >= CURRENT_VERSION) {
    return; // Already up-to-date
  }

  console.log(`[migration] Running migration v${CURRENT_VERSION}...`);

  try {
    migrateDocuments();
    migrateWorkEvents();
    migrateClients();
    migrateEquipment();
    migrateAppSettings();
    ensureBusinessProfile();
    ensureNewTables();

    localStorage.setItem(MIGRATION_KEY, String(CURRENT_VERSION));
    console.log(`[migration] Migration v${CURRENT_VERSION} complete`);
  } catch (err) {
    console.error("[migration] Migration failed:", err);
    // Don't set version — will retry on next load
  }
}
