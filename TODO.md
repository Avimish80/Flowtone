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

### Google OAuth verification before public launch
The `calendar.app.created` and `gmail.send` scopes are sensitive. Until the OAuth
app passes Google verification, only test users on the consent screen can connect.
Required gate before opening sign-ups to the public.

---

## How to use this file
Add an entry when you defer something with a real reason. Keep the *why* and a
*plan*, not just a title — future-you (or the assistant) reads this cold.
