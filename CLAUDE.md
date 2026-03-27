# CLAUDE.md — Project Context for AI Assistant

> Read this file at the start of every session before touching any code.

---

## What this project is

**Flowtone** — a mobile-first musician OS / business management app built for Avi Mishali (a professional musician in London). It's a React SPA that runs entirely in the browser with no backend — all data lives in `localStorage`.

**Repo:** https://github.com/Avimish80/Flowtone
**Live URL:** Already deployed on Vercel — check the repo's Vercel integration for the public URL.
**Local dev:** `npm run dev` → `http://localhost:3000` (also exposed on LAN via `--host`)

---

## Tech stack

| Layer | What |
|---|---|
| Framework | React 18, Vite 6 |
| Styling | Tailwind CSS (dark theme, `gray-900` base) |
| Routing | React Router v6, `createPageUrl(name)` → `'/' + name` |
| Icons | lucide-react |
| UI primitives | shadcn/ui (Radix-based) in `src/components/ui/` |
| Data | `localStorage` via `appClient` entity wrapper |
| State | `useState` / `useMemo` / `useEffect`, `usePageState` for sessionStorage-persisted page state |

---

## Data layer

Everything goes through `src/api/appClient.js`. Storage keys are `musician_os_<EntityName>`.

**Entities:**
- `WorkEvent` — gigs, lessons, rehearsals, sessions
- `Document` — invoices + estimates (`document_type: "invoice" | "estimate"`)
- `Client` — venues, agents, students, bands, other
- `Payment` — payment records linked to documents
- `BusinessProfile` — business name, logo, payment instructions
- `AppSettings` — currency, tax year, notification prefs, invoice template
- `DocumentActivityLog` — audit trail for invoices

**Key helpers on `appClient.helpers`:**
- `getNextDocumentNumber(type)` — auto-increment INV/EST numbers
- `recordPayment({document_id, amount, ...})` — marks paid + creates Payment record
- `logDocumentActivity(id, action, fromStatus, toStatus)`
- `unlockDocument(id, reason)`
- `convertEstimateToInvoice(id)`

**Utility:** `currencySymbol(currency)` and `createPageUrl(name)` from `src/utils/index.ts`

---

## App structure — pages

| Route | File | Purpose |
|---|---|---|
| `/` | `Dashboard.jsx` | Home — next event, this week, overdue alerts, quick actions |
| `/Finance` | `Invoices.jsx` | Invoice list + finance dashboard tiles |
| `/DocumentDetail` | `DocumentDetail.jsx` | Invoice/estimate detail + edit |
| `/CalendarView` | `CalendarView.jsx` | Month calendar + day panel |
| `/WorkEvents` | `WorkEvents.jsx` | Events list |
| `/WorkEventDetail` | `WorkEventDetail.jsx` | Event detail |
| `/Clients` | `Clients.jsx` | Client list |
| `/ClientDetail` | `ClientDetail.jsx` | Client detail |
| `/AppSettings` | `AppSettings.jsx` | Settings, demo data loader, export |
| `/Charts` | `Charts.jsx` | Income charts |
| `/Practice` | `Practice.jsx` | Practice log |
| `/Equipment` | `Equipment.jsx` | Gear list |
| `/DrivingMode` | `DrivingMode.jsx` | Hands-free driving view |
| `/EmailInbox` | `EmailInbox.jsx` | Gmail integration inbox |

---

## Key components

- `src/components/SortDropdown.jsx` — reusable sort picker, minimal icon-only trigger
- `src/components/AIAssistant/` — AI chat assistant
- `src/components/NotificationPrefsEditor.jsx` — notification settings
- `src/hooks/usePageState.js` — sessionStorage-persisted state (survives nav, resets on refresh)
- `src/hooks/useGoBack.js` — smart back navigation
- `src/lib/invoiceTemplates.js` — print/PDF invoice templates
- `src/lib/gmailClient.js` — Gmail OAuth integration

---

## Finance page (`Invoices.jsx`) — current design

**Tile layout:**
```
Row 1: [Outstanding (amber glow if overdue)]  [Sent (blue)]
Row 2: [Overdue] [Paid] [Drafts] [Void]   ← 4 small tiles
```
- Tiles are **data-driven** — amber/red glow appears only when overdue invoices exist
- Filter keys: `"all"` `"outstanding"` `"sent"` `"overdue"` `"paid"` `"draft"` `"cancelled"`
- `"outstanding"` = all sent invoices; `"overdue"` = sent + past due date
- Toolbar: minimal text links — `All years ↕ Select + New`
- Bulk select bar: Send (blue) · Mark Paid (green) · Delete (red)

---

## Invoice detail page (`DocumentDetail.jsx`) — current design

**Sticky nav bar:** `← Invoice` | **[Status pill centred]** | Print · Email · Save

**Card layout (unified card):**
```
Row 1: [Title input — flex-1]          [Due: date-picker]
                                        (or "Paid: date" when status=paid — green)
Row 2: [Mark sent] [Mark paid] [Cancel]    (right-aligned, subtle pill buttons)
Row 3: Event link with × (or Client name with ×)
       OR: [Event tile] [Client tile]  ← shown for ALL unlinked invoices
─────────────────────────────────────────
Line items (tap any row to edit inline)
[Add item…]  [£ price]  [+]
─────────────────────────────────────────
Total: £X,XXX.XX
```

**Below card:** Notes textarea → DETAILS (collapsible toggle) → Delete

**Details section contains:** Discount, Tax Rate, Currency, Invoice#, Paid date (if paid)

**Key behaviours:**
- `handleGoBack()` auto-saves before navigating back
- `safeDateValue(v)` normalises stored dates to `yyyy-MM-dd`, returns `""` for invalid/corrupt dates
- When `status === "paid"` → "Due [date]" slot becomes "Paid [date]" in green
- Event/Client tile picker shown for ALL invoices without a link (not just new ones)
- Status pill only appears in nav bar — NOT duplicated inside the card

---

## Calendar (`CalendarView.jsx`)

- Opens with today's day panel visible by default (`useState(new Date())`)
- "Today" button reopens the day panel if closed

---

## Demo data (`AppSettings.jsx` → "Load Connected Demo Data")

Loads a full busy 2-week schedule (relative to today):
- **10 clients:** 2 venues (Blue Note, Ronnie Scott's), 1 agent, 6 students, 1 corporate
- **25 events:** daily lessons + 5 big gigs (Wedding £2,200 / Goldman Sachs £950 / KPMG £1,200 / Ronnie Scott's £600 / Birthday party £700) + rehearsals + sessions
- **17 invoices:** 3 paid, 2 overdue, 4 sent, 8 draft — all linked to events and clients
- All events have real London addresses, proper times, base_price + total_price set

---

## Design language

- **Dark theme only:** `bg-gray-900` base, `gray-800` cards, `gray-700` borders
- **Rounded cards:** `rounded-2xl` for main cards, `rounded-xl` for smaller elements
- **Typography:** `text-[10px]` labels, `text-xs` secondary, `text-sm` body, `text-base/lg` headings
- **Colours:** indigo for primary actions, green for paid/success, red for overdue/danger, amber/yellow for warnings
- **Minimal UI:** toolbar buttons are text links (`text-xs text-gray-500`), not chunky buttons
- **No page titles** inside pages — the nav breadcrumb handles context
- **Status pills:** `rounded-full border capitalize` — sized `text-xs px-3 py-1.5` to match action buttons

---

## What NOT to do

- Don't suggest deploying to Vercel — **it's already deployed**
- Don't explain how to run `npm run dev` — it's already running
- Don't create a new git remote — `origin` is already `https://github.com/Avimish80/Flowtone.git`
- Don't add a `vercel.json` — Vercel auto-detects Vite
- Don't add TypeScript — the project uses `.jsx` files with `jsconfig.json`
- Don't use `find`/`grep` bash commands — use the Grep/Glob tools instead
- Don't add emojis to source code files
- Don't create README or docs files unless asked
