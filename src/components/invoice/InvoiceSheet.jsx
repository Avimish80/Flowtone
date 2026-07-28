import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Plus, X, ChevronRight, ExternalLink, Lock } from "lucide-react";
import { currencySymbol } from "@/utils";

/**
 * InvoiceSheet — the invoice editor, shaped like the invoice.
 *
 * The previous screen rendered the document twice: a summary hero AND a form
 * below it, each showing the line items, the total, the due date and the
 * status actions. This is one surface, ordered and worded like the printed
 * page (From → Billed to → dates → items → subtotal/tax/total → notes →
 * payment), with every block tappable to edit in place.
 *
 * It is NOT a scaled A4 canvas: the templates lay out at 820px against a 343px
 * phone column, which would put body text at ~5px and every tap target far
 * below the 44px minimum. Same structure and vocabulary, real type sizes, and
 * the true A4 render is one tap away via DocumentPreview.
 *
 * Presentational only — every mutation is a handler owned by DocumentDetail.
 */

const CURRENCIES = ["GBP", "USD", "EUR", "AUD", "CAD"];

function fmtDay(date) {
  if (!date) return "";
  try { return format(parseISO(date), "d MMM yyyy"); } catch { return date; }
}

// Section heading inside the sheet.
function Label({ children, className = "", style }) {
  return <span className={`doc-label ${className}`} style={style}>{children}</span>;
}

// A block of the document that opens its own editor when tapped.
function Row({ onClick, disabled, children, className = "", style }) {
  if (disabled || !onClick) return <div className={className} style={style}>{children}</div>;
  return (
    <button type="button" onClick={onClick} className={`doc-row ${className}`} style={style}>
      {children}
    </button>
  );
}

export default function InvoiceSheet({
  doc, profile, clients, linkedEvent, sym: symProp,
  accent = "#1c3a5e",
  fontStack,
  isInvoice, typeLabel, docNumberPlaceholder,
  onChange, onDiscountOrTaxChange,
  lineItemProps,          // { newItem, setNewItem, addLineItem, removeLineItem, updateLineItem, editingItem, setEditingItem }
  onPickClient, onPickEvent, onUnlinkEvent,
  onOpenClientPicker, onOpenEventPicker,
  safeDateValue,
}) {
  const sym = symProp || currencySymbol(doc.currency);
  const locked = !!doc.is_locked;
  const [open, setOpen] = useState(null); // which block is expanded: 'meta' | 'client' | 'dates' | 'money' | 'notes'
  const toggle = (k) => setOpen(v => (v === k ? null : k));

  const {
    newItem, setNewItem, addLineItem, removeLineItem, updateLineItem,
    editingItem, setEditingItem,
  } = lineItemProps;

  const client = clients.find(c => c.id === (doc.client_id || linkedEvent?.client_id)) || null;
  const clientEmail = client?.emails?.find(Boolean) || doc.client_email || "";

  const money = (n) => `${sym}${(Number(n) || 0).toFixed(2)}`;
  const hasAdjustments = doc.discount_amount > 0 || doc.tax_amount > 0;

  const addressLines = [
    profile?.address_line_1,
    profile?.address_line_2,
    [profile?.city, profile?.postcode].filter(Boolean).join(" "),
    profile?.email,
  ].filter(Boolean);

  const payBits = [
    profile?.bank_name,
    profile?.bank_sort_code,
    profile?.bank_account_number,
  ].filter(Boolean);

  return (
    <div
      className="doc-sheet rounded-2xl overflow-hidden shadow-lg shadow-black/30"
      style={{ "--doc-accent": accent, "--doc-font": fontStack || "inherit" }}
    >
      <div className="px-5 pt-5 pb-6 space-y-5">

        {/* ── From / document identity ─────────────────────────────── */}
        <div className="grid grid-cols-[1fr_auto] items-start gap-4">
          <div className="min-w-0">
            <Label>From</Label>
            <p className="doc-lead mt-1 break-words" style={{ fontWeight: 700 }}>
              {profile?.business_name || "Your business"}
            </p>
            {addressLines.length > 0 && (
              <p className="doc-fine mt-0.5">
                {addressLines.map((l, i) => <span key={i}>{l}{i < addressLines.length - 1 && <br />}</span>)}
              </p>
            )}
          </div>
          <Row onClick={() => toggle("meta")} disabled={locked} className="block text-right -m-1 p-1">
            <Label>{typeLabel}</Label>
            <p className="doc-lead doc-num mt-1" style={{ fontWeight: 700 }}>
              {doc.document_number || docNumberPlaceholder || "—"}
              {!locked && <ChevronRight className="w-3.5 h-3.5 inline-block ml-0.5 -mt-0.5" style={{ color: "var(--doc-muted)" }} />}
            </p>
          </Row>
        </div>

        {open === "meta" && !locked && (
          <div className="rounded-xl p-3 space-y-3" style={{ background: "var(--paper-sunk)" }}>
            <div>
              <Label className="mb-1">{typeLabel} number</Label>
              <input
                className="w-full px-2 py-1.5 text-sm"
                style={{ background: "var(--paper)", borderColor: "var(--doc-hair)" }}
                placeholder="Auto-generated"
                value={doc.document_number || ""}
                onChange={e => onChange("document_number", e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-1">Currency</Label>
              <select
                className="w-full px-2 py-1.5 text-sm"
                style={{ background: "var(--paper)", borderColor: "var(--doc-hair)" }}
                value={doc.currency || "GBP"}
                onChange={e => onChange("currency", e.target.value)}
              >
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* ── Title ────────────────────────────────────────────────── */}
        <div>
          <Label className="mb-1">Description</Label>
          <input
            className="w-full px-2 py-1.5 -mx-2 text-base"
            style={{ fontWeight: 600 }}
            placeholder={`What is this ${typeLabel.toLowerCase()} for?`}
            value={doc.title || ""}
            onChange={e => onChange("title", e.target.value)}
            disabled={locked}
          />
        </div>

        <hr style={{ border: 0, borderTop: "1px solid var(--doc-hair)" }} />

        {/* ── Billed to + dates ────────────────────────────────────── */}
        <div className="grid grid-cols-[1fr_auto] items-start gap-4">
          <Row onClick={onOpenClientPicker} disabled={locked} className="block w-full text-left min-w-0 -m-1 p-1">
            <Label>Billed to</Label>
            {client ? (
              <>
                <p className="doc-lead mt-1 break-words">{client.name}</p>
                {clientEmail && (
                  <p className="doc-fine" style={{ overflowWrap: "anywhere" }}>{clientEmail}</p>
                )}
              </>
            ) : (
              <p className="doc-lead mt-1" style={{ color: "var(--doc-link)" }}>
                Choose a client <ChevronRight className="w-3.5 h-3.5 inline-block -mt-0.5" />
              </p>
            )}
          </Row>

          <Row onClick={() => toggle("dates")} disabled={locked} className="block text-right -m-1 p-1">
            <Label>{isInvoice ? (doc.status === "paid" ? "Paid" : "Due") : "Valid until"}</Label>
            <p className="mt-1 text-sm" style={{ color: "var(--doc-ink)" }}>
              {isInvoice
                ? (doc.status === "paid" ? fmtDay(safeDateValue(doc.paid_date)) || "—" : fmtDay(safeDateValue(doc.due_date)) || "Set a date")
                : fmtDay(safeDateValue(doc.valid_until)) || "Set a date"}
              {!locked && <ChevronRight className="w-3.5 h-3.5 inline-block ml-0.5 -mt-0.5" style={{ color: "var(--doc-muted)" }} />}
            </p>
          </Row>
        </div>

        {open === "dates" && !locked && (
          <div className="rounded-xl p-3 space-y-3" style={{ background: "var(--paper-sunk)" }}>
            <div>
              <Label className="mb-1">{isInvoice ? "Due date" : "Valid until"}</Label>
              <input
                type="date"
                className="w-full px-2 py-1.5 text-sm"
                style={{ background: "var(--paper)", borderColor: "var(--doc-hair)" }}
                value={safeDateValue(isInvoice ? doc.due_date : doc.valid_until)}
                onChange={e => onChange(isInvoice ? "due_date" : "valid_until", e.target.value)}
              />
            </div>
            {isInvoice && doc.status === "paid" && (
              <div>
                <Label className="mb-1">Date paid</Label>
                <input
                  type="date"
                  className="w-full px-2 py-1.5 text-sm"
                  style={{ background: "var(--paper)", borderColor: "var(--doc-hair)" }}
                  value={safeDateValue(doc.paid_date)}
                  onChange={e => onChange("paid_date", e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Linked event ─────────────────────────────────────────── */}
        {linkedEvent ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPickEvent?.(linkedEvent)}
              className="flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 min-w-0"
              style={{ background: "var(--paper-sunk)", color: "var(--doc-link)" }}
            >
              <span className="truncate">
                {linkedEvent.title}{linkedEvent.date ? ` · ${fmtDay(linkedEvent.date)}` : ""}
              </span>
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </button>
            {!locked && (
              <button type="button" onClick={onUnlinkEvent} aria-label="Unlink event"
                style={{ color: "var(--doc-muted)" }} className="flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : !locked && isInvoice ? (
          <button type="button" onClick={onOpenEventPicker}
            className="text-xs flex items-center gap-1" style={{ color: "var(--doc-link)" }}>
            <Plus className="w-3.5 h-3.5" /> Link an event
          </button>
        ) : null}

        {/* ── Line items ───────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between">
            <Label>Description</Label>
            <Label>Amount</Label>
          </div>

          <div className="mt-2">
            {(doc.line_items || []).length === 0 && (
              <p className="text-sm py-3" style={{ color: "var(--doc-muted)" }}>
                No items yet.
              </p>
            )}

            {(doc.line_items || []).map((item, idx) => (
              editingItem === idx && !locked ? (
                <div key={idx} className="py-2.5 space-y-2" style={{ borderTop: idx ? "1px solid var(--doc-hair)" : "none" }}>
                  <input
                    autoFocus
                    className="w-full px-2 py-1.5 text-sm"
                    style={{ background: "var(--paper-sunk)", borderColor: "var(--doc-hair)" }}
                    value={item.description}
                    onChange={e => updateLineItem(idx, "description", e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") setEditingItem(null); }}
                  />
                  {/* Qty/Unit and the actions get their own rows — five controls
                      on one line at 375px squeezed the unit field to "£ 12". */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <Label>Qty</Label>
                      <input
                        type="number" inputMode="decimal"
                        className="w-16 px-2 py-1.5 text-sm doc-num"
                        style={{ background: "var(--paper-sunk)", borderColor: "var(--doc-hair)" }}
                        value={item.quantity ?? 1}
                        onChange={e => updateLineItem(idx, "quantity", e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <Label>Unit</Label>
                      <div className="flex items-center flex-1 min-w-0 px-2 py-1.5 rounded-md"
                        style={{ background: "var(--paper-sunk)", border: "1px solid var(--doc-hair)" }}>
                        <span className="text-sm" style={{ color: "var(--doc-muted)" }}>{sym}</span>
                        <input
                          type="number" inputMode="decimal"
                          className="w-full min-w-0 text-sm doc-num px-1"
                          style={{ background: "transparent", border: 0 }}
                          value={item.unit_price}
                          onChange={e => updateLineItem(idx, "unit_price", e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") setEditingItem(null); }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-0.5">
                    <button type="button" onClick={() => removeLineItem(idx)}
                      className="text-xs" style={{ color: "#b91c1c" }}>
                      Remove
                    </button>
                    <button type="button" onClick={() => setEditingItem(null)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md text-white"
                      style={{ background: "var(--doc-link)" }}>
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <div key={idx} style={{ borderTop: idx ? "1px solid var(--doc-hair)" : "none" }}>
                <Row
                  onClick={() => setEditingItem(idx)}
                  disabled={locked}
                  className="w-full text-left flex items-start justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm" style={{ color: "var(--doc-ink)" }}>{item.description || "Item"}</p>
                    {Number(item.quantity) !== 1 && (
                      <p className="doc-fine doc-num sensitive">
                        {item.quantity} × {money(item.unit_price)}
                      </p>
                    )}
                  </div>
                  <span className="text-sm doc-num sensitive flex-shrink-0" style={{ color: "var(--doc-ink)", fontWeight: 600 }}>
                    {money((item.quantity || 1) * (item.unit_price || 0))}
                  </span>
                </Row>
                </div>
              )
            ))}
          </div>

          {!locked && (
            <div className="flex items-center gap-2 pt-2.5" style={{ borderTop: "1px solid var(--doc-hair)" }}>
              <input
                className="flex-1 min-w-0 px-2 py-1.5 text-sm"
                placeholder="Add an item…"
                value={newItem.description}
                onChange={e => setNewItem(p => ({ ...p, description: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") addLineItem(); }}
              />
              <div className="flex items-center w-24 flex-shrink-0 px-2 py-1.5 rounded-md"
                style={{ background: "var(--paper-sunk)", border: "1px solid var(--doc-hair)" }}>
                <span className="text-sm" style={{ color: "var(--doc-muted)" }}>{sym}</span>
                <input
                  type="number" inputMode="decimal"
                  className="w-full text-sm doc-num px-1"
                  style={{ background: "transparent", border: 0 }}
                  placeholder="0.00"
                  value={newItem.unit_price}
                  onChange={e => setNewItem(p => ({ ...p, unit_price: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") addLineItem(); }}
                />
              </div>
              <button
                type="button" onClick={addLineItem} disabled={!newItem.description}
                className="rounded-md p-1.5 flex-shrink-0 disabled:opacity-30 text-white"
                style={{ background: "var(--doc-link)" }}
                aria-label="Add item"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* ── Totals ───────────────────────────────────────────────── */}
        <div>
          {/* Subtotal shows whenever anything sits between it and the total.
              It used to be nested inside the discount branch, so a VAT-only
              invoice printed "Tax +£252" and "Total £1512" with the £1,260
              nowhere on screen — the arithmetic visibly did not add up. */}
          {hasAdjustments && (
            <div className="space-y-1 mb-2">
              <div className="flex justify-between text-xs" style={{ color: "var(--doc-muted)" }}>
                <span>Subtotal</span><span className="doc-num sensitive">{money(doc.subtotal)}</span>
              </div>
              {doc.discount_amount > 0 && (
                <div className="flex justify-between text-xs" style={{ color: "var(--doc-muted)" }}>
                  <span>Discount{doc.discount_type === "percentage" ? ` ${doc.discount_value}%` : ""}</span>
                  <span className="doc-num sensitive">−{money(doc.discount_amount)}</span>
                </div>
              )}
              {doc.tax_amount > 0 && (
                <div className="flex justify-between text-xs" style={{ color: "var(--doc-muted)" }}>
                  <span>Tax {doc.tax_rate || 0}%</span>
                  <span className="doc-num sensitive">{money(doc.tax_amount)}</span>
                </div>
              )}
            </div>
          )}

          <div style={{ borderTop: "2px solid var(--doc-accent)" }} className="pt-2.5 flex items-baseline justify-between gap-3">
            <Label style={{ color: "var(--doc-ink)" }}>
              {doc.status === "paid" ? "Paid in full" : isInvoice ? "Amount due" : "Total"}
            </Label>
            <span className="doc-num sensitive" style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--doc-ink)" }}>
              {money(doc.total ?? doc.subtotal)}
            </span>
          </div>

          {!locked && (
            <button type="button" onClick={() => toggle("money")}
              className="text-xs mt-2 underline underline-offset-2" style={{ color: "var(--doc-link)" }}>
              {open === "money" ? "Done" : "Discount & tax"}
            </button>
          )}
        </div>

        {open === "money" && !locked && (
          <div className="rounded-xl p-3 grid grid-cols-2 gap-3" style={{ background: "var(--paper-sunk)" }}>
            <div>
              <Label className="mb-1">Discount</Label>
              <div className="flex gap-1">
                <select
                  className="w-full px-2 py-1.5 text-sm"
                  style={{ background: "var(--paper)", borderColor: "var(--doc-hair)" }}
                  value={doc.discount_type || ""}
                  onChange={e => onDiscountOrTaxChange("discount_type", e.target.value || null)}
                >
                  <option value="">None</option>
                  <option value="percentage">%</option>
                  <option value="fixed">Fixed</option>
                </select>
                {doc.discount_type && (
                  <input
                    type="number" inputMode="decimal"
                    className="w-16 px-2 py-1.5 text-sm doc-num"
                    style={{ background: "var(--paper)", borderColor: "var(--doc-hair)" }}
                    value={doc.discount_value || ""}
                    onChange={e => onDiscountOrTaxChange("discount_value", parseFloat(e.target.value) || 0)}
                    placeholder={doc.discount_type === "percentage" ? "%" : sym}
                  />
                )}
              </div>
            </div>
            <div>
              <Label className="mb-1">Tax rate %</Label>
              <input
                type="number" inputMode="decimal"
                className="w-full px-2 py-1.5 text-sm doc-num"
                style={{ background: "var(--paper)", borderColor: "var(--doc-hair)" }}
                placeholder="0"
                value={doc.tax_rate || ""}
                onChange={e => onDiscountOrTaxChange("tax_rate", parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>
        )}

        <hr style={{ border: 0, borderTop: "1px solid var(--doc-hair)" }} />

        {/* ── Notes ────────────────────────────────────────────────── */}
        <div>
          <Label className="mb-1">Notes</Label>
          <textarea
            rows={2}
            className="w-full px-2 py-1.5 -mx-2 text-sm resize-none"
            placeholder="Anything the client should read…"
            value={doc.notes || ""}
            onChange={e => onChange("notes", e.target.value)}
            disabled={locked}
          />
        </div>

        {/* ── Payment details (from the business profile) ──────────── */}
        <div>
          <Label>Payment details</Label>
          {payBits.length || profile?.payment_instructions ? (
            <p className="doc-fine doc-num mt-1">
              {payBits.join(" · ")}
              {profile?.payment_instructions && (
                <>
                  {payBits.length > 0 && <br />}
                  <span style={{ fontVariantNumeric: "normal" }}>{profile.payment_instructions}</span>
                </>
              )}
            </p>
          ) : (
            <p className="doc-fine mt-1">
              Add your bank details in Settings → Business profile so they appear here.
            </p>
          )}
        </div>

        {locked && (
          <p className="doc-fine flex items-center gap-1.5 pt-1">
            <Lock className="w-3 h-3" /> Locked — unlock above to edit.
          </p>
        )}
      </div>
    </div>
  );
}
