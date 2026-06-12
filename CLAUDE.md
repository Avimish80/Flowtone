# CLAUDE.md — Complete Project Context

> **Read this entire file at the start of every session.** It documents everything built, every API, every design decision, and every pattern used in Flowtone.

---

## Project identity

**App name:** Flowtone (was "Musician OS" / "Defiant Harmony Flow App")
**Owner:** Avi Mishali — professional musician based in London
**Purpose:** Mobile-first business OS for musicians — events, invoicing, clients, calendar, finance dashboard, AI assistant, driving mode, notifications
**Repo:** https://github.com/Avimish80/Flowtone
**Deployed:**
- Frontend: Vercel (auto-deploys on push to `main`). Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`
- Express server (`server/`): Railway at `https://flowtone-production.up.railway.app` (also auto-deploys on push)
- Database + auth: Supabase (project `jducrkssrtzhjpymldrw`) — Postgres with RLS, email OTP sign-in, custom SMTP via Resend
- Billing: Stripe (server routes in `server/routes/billing.js`; access gating in `server/lib/access.js`)

**Local dev:** `npm run dev` → `http://localhost:3000`, also on LAN via `http://192.168.0.8:3000` (phone testing). Local `.env` has the Supabase keys, so local dev signed-in sessions share the same cloud data as production.

---

## Tech stack

| Layer | What |
|---|---|
| Framework | React 18, Vite 6 |
| Styling | Tailwind CSS — dark theme, `bg-gray-950` app shell, `bg-gray-900` cards/header |
| Routing | React Router v6 — `createPageUrl(name)` = `'/' + name.replace(/ /g, '-')` |
| Icons | lucide-react |
| UI primitives | shadcn/ui (Radix-based) in `src/components/ui/` |
| Data storage | **Dual-mode:** Supabase Postgres (production — all 14 entities, `user_id` + RLS) or `localStorage` (preview mode only, when Supabase env vars are missing) |
| Data API | `src/api/appClient.js` wraps `src/api/localStorageEngine.js` (despite the filename, it routes to Supabase in cloud mode; entity→table mapping in `src/api/entityMetadata.js`) |
| Auth | Supabase email OTP (code-only, no magic link — links break the iOS PWA). Sign-in vs signup split via `shouldCreateUser`. `src/lib/AuthContext.jsx` + `src/components/auth/AuthGate.jsx` |
| State | `useState` / `useMemo` / `useEffect` in components |
| Persistent page state | `usePageState(key, default)` — sessionStorage, survives nav but clears on tab close |
| AI assistant | `src/components/AIAssistant/` — floating button + panel |
| Push notifications | `src/lib/pushManager.js` — scheduled via server in `server/` folder |
| Gmail | `src/lib/gmailClient.js` — OAuth, send emails, inbox |
| Invoice printing | `src/lib/invoiceTemplates.js` + `appClient.functions.invoke("generateAndSendInvoice", ...)` |

---

## Data layer — complete reference

### Storage
**Cloud mode (production + local dev with `.env`):** every entity reads/writes its Supabase table (`work_events`, `documents`, `clients`, …) with the signed-in user's `user_id`. Unknown fields go into a `payload` JSONB column (`splitRecord`/`hydrateRow` in `localStorageEngine.js`). Data syncs across devices. Schema: `supabase/migrations/20260410_backend_first_launch.sql`.

**Preview mode (Supabase env vars missing):** data stored as `localStorage.getItem("musician_os_<EntityName>")` — JSON arrays, device-local.

### `localStorageEngine.js` — CRUD API
```js
createLocalEntity(name) → {
  list(sortField?, limit?)     // sortField: "field" asc, "-field" desc
  filter(queryObj, sortField?) // exact match on all queryObj fields
  create(data)                 // auto-adds id (UUID), created_at, updated_at
  update(id, data)             // merges, updates updated_at
  delete(id)
}
```

### All entities (registered in `appClient.js`)
```
AppSettings, BusinessProfile, Chart, Client, Document,
DocumentActivityLog, EmailMessage, Equipment, Payment,
PracticeGoal, PracticeSession, Reminder, Setlist, WorkEvent
```

### Entity field reference

**WorkEvent**
```js
{
  title, event_type,          // "Gig" | "Lesson" | "Rehearsal" | "Session" | "Practice"
  status,                     // "lead" | "confirmed" | "completed" | "cancelled"
  date,                       // "yyyy-MM-dd"
  start_time, end_time,       // "HH:mm"
  client_id,
  location_address,
  base_price, total_price,    // numbers
  currency,                   // "GBP" | "USD" | "EUR" | "AUD" | "CAD"
  adjustments,                // array of {label, amount}
  equipment_checklist,        // array of {name, checked}
  notes,
  is_recurring, recurrence_id, recurrence_index, recurrence_rule,
  google_calendar_event_id,
  base_price_locked,
}
```

**Document** (invoices + estimates)
```js
{
  document_type,      // "invoice" | "estimate"
  document_number,    // "INV-0001"
  title,
  client_id, client_email, client_name,
  work_event_id,      // linked event (optional)
  status,             // invoice: "draft"|"sent"|"paid"|"cancelled"|"void"
                      // estimate: "draft"|"sent"|"accepted"|"rejected"|"converted"
  currency,
  line_items,         // [{description, quantity, unit_price, total}]
  subtotal, discount_type, discount_value, discount_amount,
  tax_rate, tax_amount, total,
  due_date,           // "yyyy-MM-dd"
  valid_until,        // estimates only
  paid_date, paid_amount, payment_method,
  notes,
  is_locked, locked_at, unlocked_reason,
  is_standalone,      // true = no event linked
  converted_from_id,  // for invoice converted from estimate
  sent_date,
  payment_terms_days,
}
```

**Client**
```js
{
  name, client_type,  // "venue"|"agent"|"student"|"band"|"other"
  emails,             // array of strings
  phones,             // array of strings
  city,
  default_currency, default_fee, default_payment_terms_days,
  billing_address, notes,
  late_payment_flag,  // bool
  email_filter_tag,
}
```

**Payment**
```js
{ document_id, amount, payment_date, payment_method, reference, notes }
```

**BusinessProfile**
```js
{ business_name, logo_url, address, phone, email, website, payment_instructions, vat_number }
```

**AppSettings**
```js
{
  currency, tax_year_start_month,
  invoice_number_prefix, invoice_number_next,
  estimate_number_prefix, estimate_number_next,
  invoice_template,       // 1 | 2 | 3
  notification_level,     // "minimal" | "standard" | "full"
  notification_prefs,     // detailed prefs object
  tax_rate,
}
```

### `appClient.helpers` — all helper functions
```js
getNextDocumentNumber(documentType)           // "invoice"|"estimate" → "INV-0001"
calculateDocumentTotals(doc)                  // → {subtotal, discount_amount, tax_amount, total}
convertEstimateToInvoice(estimateId)          // creates invoice, marks estimate "converted"
recordPayment({document_id, amount, payment_date, payment_method, reference, notes})
  // creates Payment, updates paid_amount, auto-marks paid if fully paid
logDocumentActivity(documentId, action, oldStatus, newStatus, details)
lockDocument(documentId)
unlockDocument(documentId, reason)
buildClientMap()                              // → {client_id: client_record}
ensureClient({name, email, address})          // find-or-create by name
```

### `appClient.functions.invoke(fnName, args)`
```js
"generateAndSendInvoice"   // {document_id, send_email, recipient_email} — generates PDF or sends
"createRecurringEvents"    // {event_id} — spawns recurring series from recurrence_rule
"syncToGoogleCalendar"     // {event_id}
```

### Utility functions (`src/utils/index.ts`)
```js
createPageUrl(pageName)          // → "/PageName" (spaces → hyphens)
currencySymbol(code)             // "GBP" → "£", "USD" → "$", etc.
formatMoney(amount, currency)    // → "£1,234.56"
```

---

## App structure — all pages + routing

| Route | File | Nav group | Purpose |
|---|---|---|---|
| `/` | `Dashboard.jsx` | Home | Next event, this week, overdue alerts, quick stats |
| `/Finance` | `Finance.jsx` → renders `Invoices.jsx` | Finance | Finance dashboard + invoice list |
| `/Invoices` | `Invoices.jsx` | Finance | (same as Finance) |
| `/DocumentDetail` | `DocumentDetail.jsx` | Finance | Invoice/estimate create + edit |
| `/InvoiceDetail` | `InvoiceDetail.jsx` | Finance | Legacy route |
| `/EstimateDetail` | `EstimateDetail.jsx` | Finance | Estimates |
| `/Estimates` | `Estimates.jsx` | Finance | Estimates list |
| `/CalendarView` | `CalendarView.jsx` | Calendar | Month view + day panel |
| `/WorkEvents` | `WorkEvents.jsx` | Events | Events list |
| `/WorkEventDetail` | `WorkEventDetail.jsx` | Events | Event detail — tabbed sections |
| `/Clients` | `Clients.jsx` | Clients | Client list |
| `/ClientDetail` | `ClientDetail.jsx` | Clients | Client detail + history |
| `/Charts` | `Charts.jsx` | Library | Music charts/setlists |
| `/ChartDetail` | `ChartDetail.jsx` | Library | Chart detail |
| `/Practice` | `Practice.jsx` | Practice | Practice log + goals |
| `/Equipment` | `Equipment.jsx` | Gear | Equipment/gear list |
| `/DrivingMode` | `DrivingMode.jsx` | Drive | Hands-free driving view |
| `/EmailInbox` | `EmailInbox.jsx` | Inbox | Gmail inbox |
| `/AppSettings` | `AppSettings.jsx` | Settings | Settings + demo data + export |

**Entry point:** `mainPage: "Dashboard"` in `src/pages.config.js`

---

## Layout (`src/Layout.jsx`)

**Top header:** `Musician OS / [Section Icon + Label]` + theme toggle (sun/moon)
- Section label comes from `SECTION_LABELS` map, icon from `SECTION_ICONS`
- `DocumentDetail` shows "Invoice" or "Quote" depending on `?type=` param

**Bottom nav (5 items):** Home · Calendar · Events · Finance · More
- "More" opens a slide-up panel with: Clients · Library · Practice · Gear · Drive Mode · Settings
- Active tab highlighted in indigo

**AI Assistant:** Floating button (bottom-right, above nav) → opens side panel
- Handles navigation commands, answers questions about data

**iPhone safe areas:** `env(safe-area-inset-top)` in header, `env(safe-area-inset-bottom)` in nav

**Push notifications:** Scheduled on every app open if push is active

---

## Finance page (`src/pages/Invoices.jsx`) — full design

### Tile layout
```
[All years ↕]  [Sort icon]  [Select]  [+ New]   ← minimal text links toolbar

Row 1 (2 cols):
  [OUTSTANDING — amber glow if any overdue]    [SENT — always blue]

Row 2 (4 cols):
  [OVERDUE]  [PAID]  [DRAFTS]  [VOID]
```

### Filter keys
| Key | Shows |
|---|---|
| `"all"` | Everything |
| `"outstanding"` | All `status === "sent"` |
| `"sent"` | Only `status === "sent"` (same data, separate tile) |
| `"overdue"` | `status === "sent"` AND `due_date < today` |
| `"paid"` | `status === "paid"` |
| `"draft"` | `status === "draft"` |
| `"cancelled"` | `status === "cancelled"` OR `status === "void"` |

### Tile colours (data-driven)
- **Outstanding**: amber glow (`from-amber-950/60`) + yellow text when overdue exist; neutral gray when none
- **Overdue**: red (`bg-red-950/60`) when count > 0; gray when zero
- **Paid**: always green
- Filter active = `ring-2 ring-indigo-500 scale-[1.03]`
- Tap same tile again to deactivate (toggle back to `"all"`)

### Toolbar
```jsx
// All minimal text links:
"All years" dropdown | ↕ SortDropdown (icon only) | "Select" | "+ New"
```

### Bulk select bar (when selectMode = true)
```
Send (blue) · Mark Paid (green) · Delete (red)
```

### Invoice list rows
- Left edge: coloured status bar (`bg-red-500` overdue / `bg-green-500` paid / `bg-blue-500` sent)
- "Mark Paid" quick button on right for sent/overdue
- Status badge + due date

---

## Invoice detail page (`src/pages/DocumentDetail.jsx`) — full design

### Sticky nav bar
```
← Invoice    [Overdue — centred, text-xs pill]    🖨 ✉  Save
```
- Status pill: `text-xs font-semibold px-3 py-1.5 rounded-full border` — same size as action buttons
- Back button calls `handleGoBack()` which auto-saves before navigating

### Unified card structure
```
┌─────────────────────────────────────────────────────────┐
│ [Title input — flex-1, text-base font-semibold]  Due [date-picker]
│                                                  (or Paid [date] in green when paid)
│ [Mark sent] [Mark paid] [Cancel]              (right-aligned)
│ · James Chen · ×   (client link, or event link with ExternalLink icon)
│ — OR —
│ [EVENT tile] [CLIENT tile]   (shown for ALL unlinked invoices)
├─────────────────────────────────────────────────────────┤
│ Line item description                          £XX.XX  ×
│ (tap row to edit inline → inputs appear, "Done" button)
│ Line item 2                                    £XX.XX  ×
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
│ Add item…                        [£  0.00]    [+]     │
├─────────────────────────────────────────────────────────┤
│ (subtotal / discount / tax rows if applicable)          │
│ Total                                      £X,XXX.00   │
└─────────────────────────────────────────────────────────┘
```

### Below the card
- **Notes / Payment Details** — textarea
- **DETAILS** — collapsible toggle (ChevronDown rotates 180° when open)
  - Inside: Discount (type + value), Tax Rate %, Currency, Invoice #, Paid date (if paid)
- **Delete Invoice** — red text link, expands to confirm

### Key behaviours
- `safeDateValue(v)` — normalises stored dates to `yyyy-MM-dd`; returns `""` for invalid/corrupt years (< 1970 or > 2100)
- `handleGoBack()` — saves doc to localStorage before navigating back
- `newItem.unit_price` starts as `""` (not `0`) to avoid pre-filled zero
- `addLineItem()` parses `parseFloat(newItem.unit_price) || 0`
- `updateLineItem(idx, field, value)` — inline edit updates + recalculates totals
- When `status === "paid"` → "Due [date]" slot becomes "Paid [date]" (green label + green border input)
- Event/Client tile picker: shown for ALL invoices missing both event and client (not just new ones)
- Events loaded for all invoice pages (`if (!isInvoice) return`)
- Status pill only in nav bar — NOT in card
- Locking: `is_locked = true` when sent; yellow banner with Unlock button; `handleUnlock()` requires reason

### Status action buttons (right-aligned in card header row 2)
| Status | Available actions |
|---|---|
| `draft` | Mark sent (blue) · Mark paid (green) · Cancel (gray) |
| `sent` | Mark paid (green) · Cancel (gray) |
| `paid` | Mark unpaid (gray) |
| `cancelled` / `void` | Reopen as draft (gray) |

### Status pill colours (`statusPillClass`)
| Status | Classes |
|---|---|
| Overdue (sent + past due) | `bg-red-950/60 border-red-700/40 text-red-300` |
| paid | `bg-green-950/40 border-green-700/30 text-green-400` |
| sent | `bg-blue-950/40 border-blue-700/30 text-blue-400` |
| cancelled / void | `bg-gray-800 border-gray-700 text-gray-500` |
| draft | `bg-gray-800/60 border-gray-700/40 text-gray-500` |

---

## Calendar (`src/pages/CalendarView.jsx`)

- `selectedDay` initialised to `new Date()` (not `null`) — today's day panel opens immediately
- `goToday()` sets both `current` (month) and `selectedDay` (panel) to today
- Day panel shows events for selected day below the month grid (no navigation away)

---

## WorkEvent detail (`src/pages/WorkEventDetail.jsx`)

Tabbed sections: **Info · Practice (if practice event) · Financials · Docs · Equipment · Navigate · Email**
- `openSection` state — only one section open at a time
- Creating new event: pre-fills `date` from `?date=` param, `event_type` from `?event_type=` param
- Auto-creates estimate when new event saved with a fee
- `base_price_locked = true` for confirmed/completed events

---

## Layout / design system

### Spacing & containers
- Max content width: `max-w-xl mx-auto` on detail pages
- Page padding: `p-4` or `px-4`
- Card: `rounded-2xl border border-gray-700/60 bg-gray-800/30`
- Smaller card: `rounded-xl`

### Typography scale
- Tiny labels: `text-[9px]` or `text-[10px]` uppercase tracking-wider
- Secondary / labels: `text-xs text-gray-400` or `text-gray-500`
- Body: `text-sm text-gray-300`
- Card body: `text-sm text-white`
- Section titles: `text-base font-semibold text-white`
- Large numbers: `text-2xl font-bold`

### Colours
- Primary action: `bg-indigo-600 hover:bg-indigo-500 text-white`
- Active/selected state: `ring-2 ring-indigo-500` or `text-indigo-400 bg-indigo-600/20`
- Success/paid: `green-400` / `green-500`
- Warning/overdue: `red-300` / `red-400` / `red-500`
- Caution: `amber` / `yellow`
- Muted: `text-gray-500` / `text-gray-600`

### Minimal toolbar buttons (Finance, etc.)
```jsx
className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 transition-colors"
```

### Status badges in lists
```jsx
className="text-[10px] font-medium px-2 py-0.5 rounded-full border"
// + status colour from invoiceStatusColors map
```

### SortDropdown trigger
```jsx
className="text-gray-500 hover:text-gray-300 flex items-center transition-colors"
// Icon only: <ArrowUpDown className="w-3.5 h-3.5" />
```

---

## Navigation patterns

```jsx
// Go to page
import { createPageUrl } from "@/utils";
navigate(createPageUrl("WorkEventDetail?id=" + event.id));

// Link component
<Link to={createPageUrl("ClientDetail?id=" + client.id)}>...</Link>

// Go back (with fallback)
const goBack = useGoBack("Finance");  // or "WorkEvents", "Clients"
```

---

## Notification system

- `src/lib/pushManager.js` — subscribes browser to push, sends scheduled notifications to `server/`
- `src/lib/notificationPrefs.js` — DEFAULT_PREFS for minimal/standard/full levels
- Scheduled on every app open from `Layout.jsx`
- Types: upcoming events, overdue invoices, practice reminders, etc.
- Settings: More → Settings → Notifications section

---

## Gmail integration

- `src/lib/gmailClient.js`
- `isGmailConnected()`, `getGmailEmail()`, `sendGmailEmail({to, subject, htmlBody})`
- OAuth token stored in localStorage under `gmail_tokens`
- Token captured from URL hash on callback: `#gmail_access=...&gmail_refresh=...&gmail_email=...`
- Quick Send banner appears on draft invoices with a client email when Gmail is connected

---

## Demo data (`AppSettings.jsx`)

Button: **"✨ Load Connected Demo Data"**

Creates (relative to today's date using `d(offset)`):
- **10 clients:** The Blue Note (venue), Ronnie Scott's (venue), Premier Events Agency (agent), Sophie Williams / Liam Harris / Ava Martinez / Noah Williams / Jake Thompson / Emily Foster (students), Barclays Corporate Events (corporate)
- **25 events** across 2 weeks: daily lessons + 5 big gigs (Wedding £2,200, Goldman Sachs dinner £950, KPMG Awards Night £1,200, Ronnie Scott's £600, Birthday party £700) + Jazz Quartet rehearsals + workshops
- **17 invoices:** 3 paid, 2 overdue (past due), 4 sent (awaiting payment), 8 draft — all linked to events and clients
- All have real London addresses, times, `base_price` + `total_price`

Other buttons: "Load Sample Events (47 gigs)" from CSV, "Load Sample Invoices (25)" from CSV, "Load Sample Lessons (12 students)"

---

## Commits history (summary of what was built)

| Commit | Changes |
|---|---|
| `10e9583` | Add CLAUDE.md |
| `b9d7b19` | Finance tiles redesign, invoice detail redesign, calendar today-panel, demo data overhaul |
| `de74ae0` | Finance swipeable tiles, connected demo data, AI scroll fix |
| `e7b282b` | Notification deep-links, Settings cleanup, Quick Send banner |
| `67a4e3f` | Notification system fixes, security hardening |
| `4887bd0` | Remove page titles, add header icons, remove Quotes tab |
| `9503bec` | Finance dashboard overview redesign |
| `dd0a0ff` | Event limits, sorting defaults, calendar filter UI |
| `99613c5` | Calendar filter panel, smart event taps, deep-linked invoice filter |

---

## What NOT to do

- **Don't suggest deploying to Vercel** — already deployed and connected to repo
- **Don't explain `npm run dev`** — already running
- **Don't add a `vercel.json`** — Vercel auto-detects Vite
- **Don't create a new git remote** — `origin` = `https://github.com/Avimish80/Flowtone.git`
- **Don't add TypeScript** — project uses `.jsx` with `jsconfig.json`
- **Don't use bash `grep`/`find`** — use the Grep/Glob tools
- **Don't add emojis to source code**
- **Don't create README/docs files** unless explicitly asked
- **Don't say data is localStorage-only** — production syncs everything to Supabase; localStorage is only the preview-mode fallback
- **Don't use `any` TypeScript types** — the `.ts` files use proper types
- **Don't duplicate state** — use `usePageState` for filter/sort/view state that should survive navigation
- **Don't put the status pill inside the invoice card** — it lives only in the nav bar

---

## Ongoing work / known patterns to continue

- The app is actively being refined session by session
- Avi's workflow: test on phone via local network, iterate on UI, push to GitHub
- AI assistant is already integrated and can be asked about the data
- Invoice flow: New → link event or client (tiles) → add line items → Save → Mark sent → Mark paid
- All finance colours are data-driven — they respond to real data states
- "Show all" / filter links follow the same minimal text style throughout
