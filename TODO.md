# Flowtone — Future Work

Known things to change/improve, with enough context to pick up cold.
Newest items near the top of each section. Remove an item when it ships.

---

## Calendar sync

### Closed-app push for new Google gigs
**What:** When a gig is created directly in Google Calendar and synced in by the
5-minute background cron (app closed), notify the user on their device.
**Why it's not done:** The push system identifies devices by *endpoint*, not by
user — `POST /api/push/subscribe` is unauthenticated and subscriptions in the
push store aren't tagged with `user_id`. So the sync engine can't target a
specific user's devices.
**Plan:**
1. Authenticate `/api/push/subscribe` (`requireAuthenticatedUser`) and store
   `user_id` alongside each subscription (`server/db.js` `upsertSubscription`).
2. Add `enqueuePushForUser(userId, {title, body, url})` that finds the user's
   endpoints and inserts an immediate `scheduledPush` (due now); the existing
   5-min scheduler delivers it.
3. In `runSyncForUser` (`server/lib/calendarSync.js`), when `new_bare_gigs` is
   non-empty, call it. Today the client only notifies when the app is open.
**Note:** push store is ephemeral on Railway (see below) — solve or accept that
subscriptions self-heal on app reopen.
**Also unlocks:** the app-icon badge's live/background updates (Phase 2 in
`APP_ICON_BADGE_PLAN.md`) ride on this same per-user push plumbing — build it once, two payoffs.

### Phase 2 — real-time calendar sync
Replace/augment the 5-minute cron with Google `events.watch` push channels →
webhook → `runSyncForUser`, channels renewed on the existing cron. Lower latency
than polling. Also consider optional primary-calendar read with gig-detection,
and Apple (CalDAV) / Outlook (Graph) providers behind the existing interface.

### Set `APP_PUBLIC_URL` on Railway
Small config task: set `APP_PUBLIC_URL=https://flowtone.vercel.app` so the
"View in Flowtone" deep link appears in Google event descriptions. Absent → link
is omitted (graceful).

---

## Infrastructure

### Railway push store is ephemeral
`server/` keeps push subscriptions + the scheduled-push queue in `store.json` on
the Railway container's local disk, which is wiped on every redeploy. No volume
mounted. Self-heals on app reopen (client re-subscribes) but scheduled pushes in
the queue are lost. **Fix:** mount a Railway volume at `/app/data` and point the
store there, or move the store to Supabase.

### Google OAuth verification — URGENT, submit ASAP
The `calendar.app.created` and `gmail.send` scopes are sensitive. Until the OAuth
app passes Google verification, only test users manually whitelisted in Google Cloud
Console can connect (up to 100). In Production mode without verification, every new
user hits a scary "This app isn't verified" screen and most won't proceed.

**Timeline:** 4–8 weeks for sensitive scopes (no security audit needed, just manual
review). Submit early — the clock doesn't start until you submit, and revisions reset it.

**What's needed to submit:**
- Live, published privacy policy URL
- Demo video (Loom-style) showing the exact OAuth flow and what the app does with
  each scope (`gmail.send`, `calendar.app.created`)
- Consent screen must match what the app actually does

**Strategy:** Stay in Testing mode with manually added users until verification clears,
then flip to Production. Do this in a dedicated session — it's a submission process,
not a code task. Submit before public launch or soft-launch will be blocked.

---

## Notifications

### App-icon badge — "you need to look at things" counter
**What:** A number on the Flowtone app icon (like Mail/WhatsApp) = count of unread attention items
(gig added, email received, calendar change, AI problem; extensible). Tapping opens a bell /
notification center; viewing marks items read and the badge goes down.
**Why:** Glanceable "the app has something for you" without opening it; foundation is also a proper
in-app notification center.
**Plan:** Full handoff doc in `APP_ICON_BADGE_PLAN.md` (repo root). Phase 1 = foreground badge +
notification center + `notifications` table (zero AI cost, no new infra). Phase 2 = live background
updates via push, sharing the per-user push plumbing with "Closed-app push for new Google gigs" above.

---

## AI assistant

### Saved places — home + studio (travel awareness)
**What:** Let the user save a small set of named places (at minimum **Home**, plus **Studio** /
others) on their profile, and attach one to an event in a tap. The assistant should know these so
it can reason about travel ("leave by 6:15 to reach the gig", "this lesson is at your studio") and
pre-fill a location for home/studio lessons.
**Why:** Came from real use — a lesson taught at home still showed "I can't plan travel, add the
address" until an address was typed in. Teaching location genuinely varies (home / student's place /
studio at a different address), so "home" and "default teaching location" must be separate, reusable
places, not one free-text field re-typed every time. Directions already use phone GPS as the origin,
so this is about *home/studio as known places*, not fixing turn-by-turn nav.
**Plan:** Add saved places to the profile (e.g. `assistantProfile`/`BusinessProfile`:
`[{label, address}]`, with a `home` flag). Surface a quick "use Home/Studio" picker on
`WorkEventDetail.jsx` location field. Inject the saved places into the AI system prompt
(`server/routes/ai.js` `buildSystemPrompt`, and the WhatsApp server agent) so CREATE/UPDATE_EVENT
can resolve "at home"/"my studio" to the stored address. Keep `missingInfo.js` as-is — once an
event has a `location_address` (filled from a saved place), the location nudge clears automatically.

---

## Infrastructure (scale)

### Address autocomplete at scale — Nominatim fair-use limit
**What:** The address type-and-pick field (`src/components/AddressAutocomplete.jsx`, used on the event
Location field in `EventInfoSection.jsx`) and the AI venue lookup (`useAIAssistant.js` LOCATION_SEARCH)
both call the **public OpenStreetMap/Nominatim** endpoint directly from the browser.
**Why it's deferred:** Free and zero-setup, but the public server's fair-use policy is ~1 request/sec
and bans bulk/heavy use. Fine for Avi + early users; with many active users typing addresses it could
get rate-limited or blocked.
**Plan (when it bites):** Either (a) **self-host Nominatim** (Docker, own server) and point both call
sites at it, or (b) switch the component to **Google Places Autocomplete** (needs a Google Cloud key +
billing; charges per session). `AddressAutocomplete.jsx` is isolated so the provider swap is a
one-file change. Also consider proxying the lookup through `server/` so the key/endpoint stays
server-side and can be cached/throttled centrally.

---

## Analytics & cost

### Log per-user AI usage (replies + tokens)
**What:** Record every AI assistant turn per user — count of replies, input/output tokens, model
used (Sonnet vs Haiku), and channel (in-app vs WhatsApp). Surface a simple per-user and total
rollup (daily/monthly).
**Why:** AI tokens are the real cost driver and the bill swings entirely on how chatty users are —
which we can't predict until launch. Logging from day one gives real numbers instead of guesses, lets
us spot heavy users, prove the trimming/Haiku optimisations actually work, and set sane per-user
caps. Also the foundation for any future usage-based pricing tier.
**Plan:** New Supabase table (e.g. `ai_usage_events`: user_id, channel, model, input_tokens,
output_tokens, created_at) written server-side at the end of each turn — both `/api/ai/chat`
(`server/routes/ai.js`) and the new server agent (`server/lib/aiAgent.js` from the WhatsApp plan).
Token counts come back on the Anthropic API response (`usage`). Keep it cheap: one insert per turn,
no PII beyond user_id. Later: a small admin/analytics view and alerting if a user blows past the cap.

---

## Onboarding & help

### Setup / connections help page
**What:** A single in-app help page (linked from Settings and the onboarding flow) that walks a new
user through, step by step:
- How to connect **Gmail**
- How to connect **Google Calendar**
- How to connect **WhatsApp** (once the WhatsApp assistant ships)
- How to **import data from CSV**
- **Putting it all together** — the recommended end-to-end setup order for a brand-new user
**Why:** These are the highest-friction setup steps and the biggest cause of early churn — users get
stuck connecting integrations and give up. One clear, mobile-first guide lifts activation and cuts
support questions.
**Plan:** New route/page (e.g. `/Help` or `/Setup`), reachable from `AppSettings.jsx` and the
onboarding flow (`src/components/onboarding/`). Keep copy short with screenshots and a tickable
checklist. Reference the existing connection code so steps match reality: Gmail
(`src/lib/gmailClient.js`), Calendar (calendar connect flow + `server/lib/googleCalendar.js`),
WhatsApp (Settings linking from the WhatsApp plan), CSV import (`appClient` import functions +
the AppSettings import buttons). Each section should state what the connection unlocks, not just how.

---

## How to use this file
Add an entry when you defer something with a real reason. Keep the *why* and a
*plan*, not just a title — future-you (or the assistant) reads this cold.
