# Flowtone design audit: "too much purple"

6 November 2026. Audit and decision only; no app source was changed.
Board with real before/after screens: `audits/design/redesign-board.html` (open it in a browser; it loads Tailwind from the CDN).

## The verdict in three sentences

1. The purple comes from one colour doing every job: buttons, links, icons, pills, hero cards, borders, the header label, the nav, and an assistant button that glows all the time. All of it is the same blue-violet, on a navy-tinted black, right next to the blue that means "sent" and "confirmed", so the whole app reads purple and nothing stands out.
2. The new look, **Graphite**: neutral graphite surfaces, white "ink" for the one main action on a screen and for the selected tab, grey for everything decorative, and colour kept only for meaning (green paid, red overdue, amber needs attention, blue sent or confirmed). Hero cards stay big; they stop being purple.
3. About a day of work: step 1 is three central files and removes most of the purple everywhere at once; step 2 is a mechanical pass over about 50 files; steps 3 and 4 are small.

---

## 1. How I looked

- Preview mode, launch config `preview-design` (port 3021), iPhone-size viewport (375 x 812), dark mode. Avi's real data was not used; nothing was saved anywhere but the preview's own browser storage.
- The "Load Connected Demo Data" button no longer exists in Settings (VERIFIED: `grep -i "demo" src/pages/AppSettings.jsx` finds only the sample-invoice preview). I loaded the app's own generator `generateBusyMusicianData` from `src/lib/busyMusicianTestData.js` in the preview tab instead: 33 clients, 480 events, 162 invoices.
- Screens walked (VERIFIED, screenshots): Dashboard, Calendar, Events list, event detail, Finance, invoice detail, client detail, Missions (empty in preview), AI assistant panel, Settings, More sheet, Practice. Light mode: Dashboard only.
- Accent counts: a script over `src/**/*.js(x)`, leaving out `src/pages/public/` and `src/lib/invoiceTemplates.js` (out of scope).
- The board's "Now" screens are the app's real rendered markup, captured headless from the same preview. Its "New" screens are that same markup with the new palette and the class rules in section 4 applied by a script on the board. It shows what the plan produces, not a mock-up.

## 2. Diagnosis

### 2.1 It is the amount, the hue and the background, together

**Amount (main cause).** 609 `indigo-*` utilities in 51 files (VERIFIED, script). Red, the next most-used hue, has 162. Measured on the rendered screens (VERIFIED, DOM count of elements carrying an indigo class above the fold): event detail 19, Dashboard 13, Settings 12, client detail 10, Calendar 9, Events list 7, Finance 5. Practice shows 23, mostly the purple heat-map squares.

What the accent does today (VERIFIED, script; "icon" counts only icons written on one line, so the real icon count is higher):

| Job | Count | Examples |
|---|---|---|
| Text: links, labels, active tab, subtitles | 119 | "See all", "+ New", nav active `text-indigo-400`, "AI-powered musician OS" |
| Hover and press states | 107 | `hover:bg-indigo-500`, `hover:text-indigo-300` |
| Solid fills: buttons, badges, dots, toggles | 105 | Directions, + New, Add, Month, today circle, FAB, Toggle on |
| Tinted fills: chips, pills, panels | 75 | "Session" / "Venue" pills, Email chip, header section pill, AI suggestion buttons |
| Borders | 72 | hero borders `border-indigo-700/30`, chip borders |
| Icon tint | 64+ | every section icon on event detail, hero info icons, Settings section icons, header logo |
| Focus rings and borders | 43 | inputs |
| Selected-state rings | 12 | Finance tile filter `ring-indigo-500` |
| Gradients | 6 | the hero cards `from-indigo-900/80 to-gray-900` (Dashboard, event, client) |
| Shadows and glow | 6 + 2 inline | user chat bubble, AI avatar, the assistant button's pulsing glow |

Only the first three jobs need a colour. Icons, pills, borders, hero gradients and the header label are decoration, and they are about half of all uses.

**Hue.** The accent is stock Tailwind indigo (`#4f46e5`, `src/index.css:18`). On a dark background indigo reads violet, and its tints (`/20`, `/30`) turn into lavender and plum. Nothing else in the app is that hue, so it owns the screen.

**Background.** Every surface is Tailwind `gray`, which is blue-tinted: the page is `#030712` (`bg-gray-950`), cards `#111827` / `#1f2937`. A navy page under violet accents makes the whole app feel purple even in empty areas. The iPhone status bar is tinted dark indigo too: `<meta name="theme-color" content="#1e1b4b">` (`index.html:14`, VERIFIED, that is `indigo-950`).

**Collision with status blue.** "Sent" (Finance) and "confirmed" (events, calendar dots) are `blue-400/500`. Indigo sits right beside them, so blue status and purple chrome merge into one blue-violet wash, and the blue loses its meaning (VERIFIED on Calendar: purple "today" and purple buttons above rows of blue dots).

### 2.2 Worst screens

1. **Event detail** (`src/pages/WorkEventDetail.jsx` + `src/components/workevent/*`): purple gradient hero, purple border, purple "Session" pill, purple Email chip, purple info icons, then six section headers each with a purple icon (Practice's is teal). 19 accent elements above the fold.
2. **Dashboard** (`src/pages/Dashboard.jsx`): the hero is the first thing you see and it is a purple card with a purple button; the assistant button pulses purple under it.
3. **Client detail** (`src/pages/ClientDetail.jsx`): the same purple hero.
4. **AI assistant panel** (`src/components/AIAssistant/AIAssistantPanel.jsx`): purple avatar, purple subtitle, purple user bubble, purple suggestion buttons.
5. **Missions and the AI briefing** (`src/pages/Missions.jsx` 43 uses, `src/components/AIDashboardBriefing.jsx` 40 uses, the two heaviest files): every action button is the same tinted purple pill (`bg-indigo-600/25 border-indigo-500/30 text-indigo-300`), repeated about ten times per file. INFERRED from code: Missions was empty in preview and the briefing needs the live AI, so I could not see them rendered.
6. **Calendar**: four purple fills at once (Month, +, today, Add).

Finance is the best screen: it is already mostly status colour.

### 2.3 Other design problems seen (short)

- **Always-on glow breaks Avi's own rule.** The assistant button pulses an indigo glow forever (`src/components/AIAssistant/AIAssistantButton.jsx:47-50`, VERIFIED in code and on screen). The rule is "glow only when something is urgent" (memory note `dashboard-redesign-merged-hero.md`).
- **Light mode: white button labels turn black.** `src/index.css` has `html:not(.dark) .text-white { color: #0f172a !important }`, which also hits text on purple buttons. VERIFIED on Dashboard in light mode: the "Directions" label is near-black on dark indigo.
- **Hard-coded indigo that ignores the theme system** (so the Pro accent themes miss them too): `AIAssistantButton.jsx:48-49` (glow), `AIAssistantPanel.jsx:475` (send button `#4f46e5`), `onboarding/OnboardingInput.jsx:83`, `ErrorBoundary.jsx:73`, `tour/CoachMarks.jsx:82`, `auth/AuthGate.jsx:26` (purple radial glow behind sign-in), `index.html:34,38` (boot splash: indigo-to-fuchsia gradient and indigo spinner, the only literal purple-pink in the app), `index.html:14` (theme-color), `public/icon*.svg` (app icon). The AI panel input also hard-codes stock grey hexes in inline styles (`AIAssistantPanel.jsx` around 440-470).
- **The assistant button covers content**: it sits over the right end of list rows (prices on Finance, status pills on Dashboard and Events). VERIFIED in screenshots.
- **Too many incidental hues**: Practice uses teal for its main button and icons (68 teal uses app-wide), the AI "done" card is teal, Practice's heat map is purple. Colour stops meaning anything when every domain gets its own.
- **Finance tiles truncate**: the Overdue tile shows "£200...." at phone width. VERIFIED.
- **Events toolbar mixes four button styles** (icon box, bare icon, grey pill, purple pill) against the "minimal text links" rule in `CLAUDE.md`. VERIFIED.
- `CLAUDE.md`'s invoice-detail section is out of date: the invoice is now a white paper sheet (`.doc-sheet` in `src/index.css`), not the dark card described there.

---

## 3. Decision: Graphite

A neutral, near-black app where white "ink" marks what you can do and colour marks what needs you. It is the "quiet unless it needs attention" rule Avi already set for glows and Settings, applied to colour. Why this and not another hue:

- Every hue is already taken by a status: green paid, red overdue, amber attention, blue sent or confirmed. Any coloured accent sits next to one of them and blurs it. A neutral accent is the only one that cannot be mistaken for a status, and it makes the status colours pop.
- It keeps what Avi likes: big hero cards, clickable rows, dark first. The heroes become graphite with a hairline border and a faint top highlight instead of a purple gradient.
- It is the cheapest big change: the ramps are already behind CSS variables, so step 1 is central.

### 3.1 Palette

**Surfaces: remap Tailwind `gray` to a neutral graphite ramp** (values are Tailwind zinc). This removes the navy cast from every screen without touching a component.

| gray | now | new (R G B) | used for |
|---|---|---|---|
| 50 | 249 250 251 | 250 250 250 | |
| 100 | 243 244 246 | 244 244 245 | |
| 200 | 229 231 235 | 228 228 231 | strong secondary text |
| 300 | 209 213 219 | 212 212 216 | secondary text |
| 400 | 156 163 175 | 161 161 170 | icons, muted labels |
| 500 | 107 114 128 | 113 113 122 | hints, inactive tabs |
| 600 | 75 85 99 | 82 82 91 | |
| 700 | 55 65 81 | 63 63 70 | dividers, segmented selection |
| 800 | 31 41 55 | 39 39 42 | raised surfaces, chips |
| 900 | 17 24 39 | 24 24 27 | cards, header, nav |
| 950 | 3 7 18 | 9 9 11 | page |

**Ink: a new token for the main action** (two values, flips in light mode):

```css
:root            { --ink: 244 244 245; --ink-fg: 9 9 11; }     /* dark: near-white fill, near-black label */
html:not(.dark)  { --ink: 24 24 27;   --ink-fg: 255 255 255; } /* light: near-black fill, white label */
```

**Accent ramp: the new default replaces stock indigo in `src/index.css` `:root`.** It catches every `indigo-*` class not yet converted. It is split by job: 50 to 400 are only ever used as text and icon colours on dark (so they are light), 500 to 950 only as fills and borders (so they are dark enough to carry white text).

```css
:root {
  --accent-50: 255 255 255;
  --accent-100: 250 250 250;
  --accent-200: 244 244 245;
  --accent-300: 228 228 231;
  --accent-400: 212 212 216;
  --accent-500: 113 113 122;
  --accent-600: 82 82 91;
  --accent-700: 63 63 70;
  --accent-800: 52 52 56;
  --accent-900: 39 39 42;
  --accent-950: 24 24 27;
}
```

With step 1 alone, today's purple buttons (`bg-indigo-600 text-white`) become graphite buttons with white labels (contrast about 7.7:1), purple text becomes light grey, and purple tints become grey tints. Step 2 then makes the main actions white ink.

**Status colours: unchanged, and reserved.** Green (`green-400/500`) paid and completed; red (`red-300/400/500`) overdue and errors; amber/yellow (`amber-*`, `yellow-*`) needs attention and outstanding; blue (`blue-400/500`) sent and confirmed. They are never used for decoration, and the accent never uses those hues.

### 3.2 Rules (who gets the accent)

| Job | Rule | Classes |
|---|---|---|
| Main action | One per screen, ink fill | `bg-ink text-ink-fg hover:bg-ink/90 active:bg-ink/80` |
| Assistant's suggested "yes" | Ink: it is the main action in the panel | same |
| Secondary action | Neutral | `bg-white/10 text-gray-100 hover:bg-white/15` (or `bg-gray-800`) |
| Selected bottom tab, today in calendar | Ink | tab: `text-ink`; today: `bg-ink text-ink-fg` |
| Segmented control (Month/Week/Day, Open/Resolved) | Grey, iOS style | selected `bg-gray-700 text-white`, others `text-gray-400` |
| Toggle on | Ink track, dark knob | track `bg-ink`, knob `bg-gray-950` |
| Links ("See all", "+ New") | Ink text | `text-ink` |
| Focus | Ink ring | `focus:ring-ink/40`, `focus:border-gray-400` |
| Filter tile active (Finance) | Ink ring | `ring-2 ring-ink/70` |
| Icons | Always grey, never coloured unless they show a status | `text-gray-400` (or `text-gray-500` when quieter) |
| Type pills, chips | Neutral | `bg-white/10 text-gray-200` |
| Borders on cards and heroes | Hairline | `border-white/10` or `border-gray-700/60` |
| Header section label | Plain text, no pill | `text-gray-400` |
| Hero cards | Graphite, keep size and clickable rows | `bg-gradient-to-br from-gray-800/80 to-gray-900 border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]` |
| User chat bubble | Graphite | `bg-gray-700 text-white` |
| AI avatar | Neutral | `bg-white/10 border-white/10`, icon `text-gray-400` |
| Assistant button | Ink, no glow, no ring | `bg-ink text-ink-fg`; an amber dot (`bg-amber-400 ring-2 ring-gray-950`) only when the assistant has a suggestion waiting |
| Unread notification count | Red badge (it needs attention) | `bg-red-500 text-white` |
| Gradients | Only the hero highlight above; no coloured gradients |  |
| Glows and coloured shadows | None, except status-driven ones that already exist (Finance amber when overdue) | remove all `shadow-indigo-*` |
| Practice teal | Treat teal like any decoration: grey icons, ink button | |

### 3.3 Alternates (same rules, only the ink changes)

- **Brass** (warm, jazz-club): `--ink: 214 180 116; --ink-fg: 28 21 10;` accent ramp 50 to 950: `252 248 238 / 246 238 218 / 236 222 186 / 224 202 150 / 214 180 116 / 184 148 86 / 150 118 64 / 118 92 50 / 88 69 38 / 60 47 27 / 36 28 16`. Risk: nearer to amber "attention", so brass only on main buttons and the selected tab.
- **Teal** (cool, colourful): `--ink: 94 234 212; --ink-fg: 4 47 46;` accent ramp = Tailwind teal 50 to 950. Risk: close to green "paid" and to Practice's teal; green status text needs checking screen by screen.

Both are shown at the bottom of the board.

---

## 4. Implementation plan (biggest visible change first)

### Step 1: central swap (3 files, about 1 hour). Removes most of the purple on every screen.

1. `src/index.css`
   - Replace the `:root` accent ramp (lines 12-22) with the Graphite ramp in 3.1.
   - Add `--ink` / `--ink-fg` to `:root`, and the light-mode pair under `html:not(.dark)`.
   - Light-mode overrides (lines about 230-300): `[class*="from-indigo-900"]` and the `bg-indigo-*` rules can stay (they read the variables). Change the hard-coded light surfaces `#eef2f7` / `#f8fafc` / `#e8eef4` (blue-grey) to neutral `#f4f4f5` / `#fafafa` / `#e4e4e7` so light mode matches.
2. `tailwind.config.js`
   - Add `gray` as a fixed graphite ramp (Tailwind `zinc` values, 3.1), or point it at `--gray-*` variables if a future theme needs it.
   - Add `ink: { DEFAULT: 'rgb(var(--ink) / <alpha-value>)', fg: 'rgb(var(--ink-fg) / <alpha-value>)' }`.
3. `src/lib/ThemeContext.jsx`
   - New default id `graphite` (no `data-accent` attribute). Keep `indigo` as an optional "Indigo (classic)" theme with the old ramp under `[data-accent='indigo']`.
   - **Migration, important:** the app writes `mos_accent` on every start, so Avi's phone has `"indigo"` saved and would stay purple after the change. Treat a stored `"indigo"` as `"graphite"` once (for example read a new key `mos_accent_v2`, defaulting to `graphite`).
4. `index.html:14` theme-color `#1e1b4b` to `#09090b`.

After step 1: no purple left except hard-coded hexes (step 3); main buttons are graphite rather than white (step 2).

### Step 2: class pass (about 50 files, about half a day). Makes the hierarchy right.

Mechanical, rule by rule from 3.2, and can be scripted with careful review: solid `bg-indigo-600/500` buttons become `bg-ink text-ink-fg` (drop `text-white` on them: this also fixes the light-mode black-label bug); icon `text-indigo-*` becomes `text-gray-400`; tinted `bg-indigo-*/NN` becomes `bg-white/10`; `border-indigo-*` becomes `border-white/10`; hero gradients swap to the graphite hero; all `shadow-indigo-*` go. Then a manual look at each screen for "one ink button per screen" (demote the others to secondary).

Files by number of `indigo-*` utilities (VERIFIED, script), in suggested order (most visible first):

| Order | File | Uses | Notes |
|---|---|---|---|
| 1 | `src/Layout.jsx` | 10 | header label pill, logo, nav active tab, notification badge (to red) |
| 2 | `src/components/AIAssistant/AIAssistantButton.jsx` | 5 | ink, remove glow keyframes and ring, add suggestion dot |
| 3 | `src/pages/Dashboard.jsx` | 24 | hero |
| 4 | `src/pages/WorkEventDetail.jsx` | 35 | hero, section icons |
| 5 | `src/components/workevent/EventInfoSection.jsx` | 18 | |
| 6 | `src/components/workevent/RecurrenceSection.jsx` | 14 | |
| 7 | `src/components/workevent/EventFinancialsSection.jsx` | 10 | |
| 8 | `src/pages/ClientDetail.jsx` | 29 | hero |
| 9 | `src/components/AIAssistant/AIAssistantPanel.jsx` | 28 | avatar, bubbles, suggestion buttons; inline hexes at about 440-475 |
| 10 | `src/components/AIDashboardBriefing.jsx` | 40 | ten copies of the same tinted pill: extract one component |
| 11 | `src/pages/Missions.jsx` | 43 | same pill repeated; type-colour map lines 28-37 to grey |
| 12 | `src/pages/MissionDetail.jsx` | 14 | |
| 13 | `src/pages/CalendarView.jsx` | 20 | segmented control to grey, one ink button |
| 14 | `src/pages/Invoices.jsx` | 14 | filter ring, "+ New" |
| 15 | `src/pages/DocumentDetail.jsx` | 35 | app chrome around the paper sheet only; leave `.doc-sheet` |
| 16 | `src/pages/AppSettings.jsx` | 22 | section icons; Appearance picker gets the new theme list |
| 17 | `src/components/NotificationPrefsEditor.jsx` | 2 | `Toggle` (used across Settings) |
| 18 | `src/pages/Practice.jsx` | 21 | heat map to a grey ramp; teal to rules |
| 19 | `src/pages/WorkEvents.jsx`, `Clients.jsx`, `Charts.jsx`, `ChartDetail.jsx`, `Equipment.jsx` | 9, 6, 9, 14, 13 | |
| 20 | `src/pages/Leads.jsx`, `LeadDetail.jsx`, `Packages.jsx`, `FeeRules.jsx`, `FeeCatchUp.jsx`, `SheetImport.jsx`, `EmailInbox.jsx`, `DrivingMode.jsx` | 10, 10, 9, 8, 6, 12, 6, 1 | |
| 21 | `src/components/settings/DeviceCalendarLink.jsx`, `DeviceAccessRow.jsx` | 17, 4 | |
| 22 | `src/components/auth/AuthGate.jsx` | 17 | plus the radial glow at line 26 |
| 23 | `src/components/onboarding/OnboardingFlow.jsx`, `OnboardingBubbles.jsx`, `OnboardingInput.jsx`, `OnboardingGate.jsx` | 11, 11, 1, 1 | |
| 24 | the rest: `SmartCSVImport.jsx` 9, `workevent/CSVImportModal.jsx` 9, `invoices/InvoiceImportModal.jsx` 6, `client/InvoiceLessonsModal.jsx` 6, `tour/CoachMarks.jsx` 5, `notifications/NotificationsPanel.jsx` 5, `workevent/EventEquipmentSection.jsx` 3, `SortDropdown.jsx` 2, `App.jsx`, `AddressAutocomplete.jsx`, `workevent/EventEmailSection.jsx`, `AIAssistant/RichText.jsx`, `client/ClientFinancialSummary.jsx` 1 each | | |

Total 609 uses in 51 files.

### Step 3: hard-coded colours (about 1 hour)

`AIAssistantButton.jsx:47-50`, `AIAssistantPanel.jsx:475` (and its inline grey hexes), `OnboardingInput.jsx:83`, `ErrorBoundary.jsx:73`, `tour/CoachMarks.jsx:82`, `auth/AuthGate.jsx:26`, `index.html:34,38` (boot splash: graphite tile with a white note, white spinner top). App icon `public/icon*.svg`: a white note on graphite; existing home-screen icons only change after re-adding. `DocumentDetail.jsx:737` and `LeadDetail.jsx:362` are client-facing printed and emailed HTML: leave them to the invoice-template work, out of scope here.

### Step 4: small fixes found on the way (optional, under an hour each)

Light-mode `.text-white` override (fixed by step 2, check it); Finance Overdue tile truncation; assistant button covering row ends (add bottom padding to lists, or move the button above the nav's right edge); Events toolbar to the minimal text-link style.

### How the Pro accent themes carry over

The mechanism stays: `[data-accent='x']` blocks in `src/index.css` that set the accent ramp, now also setting `--ink` and `--ink-fg`. After step 2 the accent touches far fewer places (main buttons, selected tab, links, focus), so a theme recolours exactly the things that should carry brand colour and nothing else.

Recommended list: **Graphite** (default, free), **Brass**, **Teal**, **Indigo (classic)**. Drop Jade, Gold and Crimson: each one copies a status colour (Jade is "paid" green, Gold is "attention" amber, Crimson is "overdue" red), so with them a main button looks like a warning. Map saved values: `jade` to `teal`, `gold` to `brass`, `crimson` to `graphite`. Pro is not enforced yet (`CLAUDE.md` handoff), so no billing change is needed.

## 5. What I could not check

- Avi's real-data app (`local-web-loopback`, port 3011) was not opened; everything was seen on demo data in preview mode. The palette is data-independent, but screens that only fill with real or AI data (Missions list, the AI briefing on Dashboard, notifications panel) were read from code, not seen.
- Light mode: only Dashboard was looked at.
- The board renders screens from captured markup, so anything driven by JavaScript after load (animations, hover) is static there.
