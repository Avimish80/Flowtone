# Reminders and notifications audit

Date: 6 Nov 2026, about 17:30 London time. Read-only audit: nothing in the app, the database or the server was changed. Scope: everything meant to reach Avi while Flowtone is closed or in the background, plus the in-app bell and the app-icon badge. The assistant's thinking (scanner, missions, chat) belongs to the sibling AI audit.

## Verdict

1. Flowtone has not been able to send you a single reminder since you moved to the iPhone app at the end of October, and nothing in the system is broken in a way that shows: it is simply not connected.
2. The iPhone app you use has no notification route at all: every reminder is built on "web push", which only works in a browser or a home-screen web app, and the iPhone app switches that off on purpose and has no Apple notification setup to replace it.
3. The server on this Mac is running and ticking every five minutes, but its list of phones to notify has been empty since it started on 31 October (the file that would hold it has never been written), so even a perfectly built reminder has nowhere to go.
4. The reminders are also only planned when you open the app, one batch at a time, so even on a working device a missed day or a gig added on another device means missed or stale reminders; nothing on the server works out what is due by itself.
5. The fastest fix is to have the iPhone app set its own alarms on the phone (iOS "local notifications"): it needs no server, no Apple push certificate and no cloud move, and would bring back almost every reminder type in one piece of work.

## Status table

Paths: **Native** = the Capacitor iPhone app (what Avi uses). **Old web app** = the home-screen icon from flowtone.vercel.app, talking to Railway and the paused cloud database. **Browser** = a desktop browser on the local web app (port 3011 / Tailscale).

| Reminder or surface (prefs level) | Native iPhone app | Old web app (home screen) | Browser on this Mac | Where it stops | Evidence | Grade |
|---|---|---|---|---|---|---|
| All 18 scheduled reminder types (below) | **Missing** | **Broken** | **Partly** | Native: the push service worker is never registered and the Push API does not exist in the iPhone app's web view, so `isPushActive()` is false and nothing is scheduled. Old web app: cannot sign in (cloud database paused), so it never loads gigs to schedule from. Browser: works only for a tab that has switched notifications on, only while Chrome or Safari is running, and nobody has subscribed since 31 Oct | `src/main.jsx:17-19` (SW skipped when native); `src/lib/pushManager.js:39-40,94-96,185-186` (returns early without `serviceWorker`/`PushManager`); `src/Layout.jsx:136-138` (schedules only if push active); server log: every start says `0 subscriptions, 0 scheduled pushes`; `server/store.json` does not exist | Native: VERIFIED for code and server store, INFERRED for WebKit behaviour. Old web app: INFERRED |
| Gig day before, 9am (standard, full) | Missing | Broken | Partly | as row 1 | `pushManager.js:239-281` | as row 1 |
| Day-of morning summary 8am (full) | Missing | Broken | Partly | as row 1 | `pushManager.js:284-312` | as row 1 |
| Load-in / call time (standard, full) | Missing | Broken | Partly | as row 1 | `pushManager.js:315-333` | as row 1 |
| Leave now, 90 min before (all levels) | Missing | Broken | Partly | as row 1; also a fixed time offset, no travel time | `pushManager.js:336-363` | as row 1 |
| Starting soon, 30 min (all levels) | Missing | Broken | Partly | as row 1 | `pushManager.js:366-384` | as row 1 |
| Invoice not sent, day after gig 9am (all levels) | Missing | Broken | Partly | as row 1 | `pushManager.js:389-425` | as row 1 |
| Gig needs a fee (all levels) | Missing | Broken | Partly | as row 1; only ever schedules the next 9am, so it repeats only if the app is opened daily | `pushManager.js:428-455` | INFERRED |
| Invoice due soon, 2 days (standard, full) | Missing | Broken | Partly | as row 1 | `pushManager.js:458-477` | as row 1 |
| Overdue invoice, daily 9am (all levels) | Missing | Broken | Partly | as row 1; one day at a time, as above. 3 sent invoices are overdue right now | `pushManager.js:480-502`; DB: `overdue=3, sent=3` | VERIFIED (DB), INFERRED (timing) |
| Weekly unpaid summary, Mon 8am (standard, full) | Missing | Broken | Partly | as row 1 | `pushManager.js:505-528` | as row 1 |
| Missing venue (standard, full) | Missing | Broken | Partly | as row 1 | `pushManager.js:533-555` | as row 1 |
| Imported gig missing details (standard, full) | Missing | Broken | Partly | as row 1 | `pushManager.js:558-581` | as row 1 |
| Unconfirmed gig, 3-14 days out (full only) | Missing | Broken | Partly | as row 1 | `pushManager.js:584-604` | as row 1 |
| Risk alert (full only) | Missing | Broken | Partly | as row 1 | `pushManager.js:607-634` | as row 1 |
| Practice reminder | Missing everywhere | | | Switched off at every level | `src/lib/notificationPrefs.js` DEFAULT_PREFS (`practice_reminder enabled:false` in minimal, standard, full) | VERIFIED |
| Practice goal deadline | Missing everywhere | | | Never built ("We skip this here") | `pushManager.js:658-660` | VERIFIED |
| Daily briefing 7am (standard, full) | Missing | Broken | Partly | as row 1; uses the UTC date for "tomorrow", so wrong day if the app is opened between midnight and 1am in summer | `pushManager.js:665-692` (`toISOString().slice(0,10)`) | INFERRED |
| Weekly digest, Mon 8am (full only) | Missing | Broken | Partly | as row 1 | `pushManager.js:695-745` | as row 1 |
| New lead / quote accepted (server sends at once) | **Missing** | Broken | Partly | Server looks up the owner's phones by `user_id` in the push store, which is empty. Also writes an in-app bell row, which would work | `server/routes/public.js:76-103`; store empty (log) | VERIFIED store empty; INFERRED rest |
| New gigs pulled from Google Calendar | Missing | Broken | Partly | Shown by the service worker only if it exists and permission is granted: never on native | `src/lib/calendarClient.js:63-84` | INFERRED |
| Missions / "Should I do this?" nudges | **Missing everywhere** | | | Missions never call any push or bell code; only `pushManager.js`, `public.js`, `calendarClient.js` and the AI-error path send anything | grep for `api/push`, `webpush`, `showNotification`, `notify(` across `src` and `server` | VERIFIED |
| In-app bell (notifications panel) | Works but empty | Broken | Works but empty | Table exists locally, 0 rows. Only two writers: new-lead/quote events and "I couldn't finish that action" AI errors. No reminder or mission ever lands here | DB: `notifications` table present, `count=0`; `src/components/AIAssistant/useAIAssistant.js:624`; `server/routes/public.js:79` | VERIFIED |
| App-icon badge | Missing | Partly | Partly | Uses `navigator.setAppBadge`, which the iPhone app's web view does not have; and it counts the empty bell table | `src/lib/appBadge.js:8-18` | INFERRED |
| `Reminder` entity (`reminders` table) | Does nothing | | | 0 rows; only written by CSV import and read by CSV export; nothing schedules or shows it | DB `reminders count=0`; `src/components/SmartCSVImport.jsx:315`, `src/lib/csvExport.js:63` | VERIFIED |
| "Send test notification" button | Hidden | | Works if subscribed | Only shown when push is active; on native the toggle shows "Push notifications are not supported on this device or browser" and Diagnostics wrongly says "install as PWA" | `src/pages/AppSettings.jsx:209-215,762-779` | INFERRED |

## How it is meant to work, and what happens today

1. On every app open, `Layout.jsx:136-153` checks whether this device has a web-push subscription. If yes, it loads all gigs, clients, invoices and settings, and `schedulePushNotifications` works out every reminder for the next 30 days and POSTs each one to `/api/push/schedule` on the server.
2. The server stores each one in a JSON file (`server/db.js`), keyed by the device's push address. Every five minutes `server/scheduler.js:60-68` sends whatever is due through the browser's push service (Apple, Google or Mozilla).
3. The device's service worker (`src/sw.js:13-65`) shows the banner and opens the right page when tapped.

On Avi's setup each step fails:

- **Step 1 never starts on the iPhone app.** `src/main.jsx:17-19` deliberately skips the service worker in the native build ("WKWebView has no web push"). `pushManager.js:39-40` then returns "not active", so `Layout.jsx:138` stops. The native project has no push plugin (`package.json`: only app, core, ios, splash-screen, status-bar, capacitor-calendar), no local-notification plugin, no `.entitlements` file and no `aps-environment` (searched `ios/`). VERIFIED for the files; the WebKit limitation is INFERRED from platform rules.
- **Step 2 is empty.** The server (LaunchAgent `com.avi.flowtone.server`, pid 1794, running since Sat 31 Oct 10:22) logged at each of its four starts: `JSON store ready at .../server/store.json — 0 subscriptions, 0 scheduled pushes`. `server/store.json` does not exist, and `db.js:56-58` writes it on the first subscription, so no device has subscribed to this server since it was set up. `GET /api/push/debug` returns `duePushes: 0`. VERIFIED.
- **The scheduler does tick but logs nothing when idle** (`scheduler.js:64` returns silently), which is why `server.log` (1.2 KB) has not changed since 31 Oct. `/api/health` answers. VERIFIED that the process runs; per-tick activity cannot be seen without a log line.
- **VAPID keys are set and consistent.** The server never logged the "VAPID keys not set" error, and the public key served by this server and by Railway matches the one baked into `pushManager.js:27-28` (compared by hash, no values recorded). VERIFIED.

## Answers to the brief's questions

**1. Inventory.** 18 scheduled types in five "layers" plus 3 instant ones (new lead, quote accepted, new Google gigs). Levels (from `notificationPrefs.js` DEFAULT_PREFS): Minimal = leave now, starting soon, invoice not sent, gig needs fee, overdue invoice. Standard (Avi's setting for both accounts in `app_settings`) = minimal plus day-before, load-in, invoice due soon, weekly unpaid, missing venue, imported incomplete, daily briefing. Full = standard plus day-of summary, unconfirmed, risk alert, weekly digest. Practice reminder and goal deadline are off or unbuilt everywhere. Mission nudges have no delivery at all.

**2. Paths.**
- Browser on this Mac: can subscribe (Chrome/Safari on macOS have web push). Subscription is stored on this Mac's server in `server/store.json`. The phone works out the schedule; the Mac's server sends. Only fires while that browser is running. Note: web push needs a secure page; `localhost` qualifies, but the Tailscale address `http://flowtone-mac...:3011` is plain http and would refuse (INFERRED).
- Installed web app (old Vercel icon): would subscribe to the Railway server, whose store is wiped on every redeploy (memory note `flowtone-railway-ephemeral-push-store.md`). It cannot sign in now, so it schedules nothing new. Railway still answers `/api/health` (VERIFIED today); whether it still holds old queued reminders from before the pause cannot be seen (`/api/push/debug` returns 404 there). If any survive, they would be stale reminders built on October data.
- Native iPhone app: no path at all (no APNs, no local notifications, no service worker).

**3. Scheduling model.** All planning happens on the phone at app open. If Avi does not open the app for three days: the day-before, leave-now and invoice reminders already queued would still fire, but the "repeat daily" ones (overdue, needs fee, unconfirmed, imported-incomplete) only schedule the next single 9am, and the daily briefing only "tomorrow", so they go quiet. A gig added on another device or pulled in by the server's Google sync (every five minutes, `scheduler.js:76-92`) gets no reminders until the subscribed device is opened. A gig cancelled or deleted keeps its queued reminders: the server only replaces by matching tag (`push.js:78-81`), and nothing removes reminders for gigs that disappeared. The server computes nothing on its own, though it already has database access for calendar sync and leads.

**4. Live state.** 0 subscriptions, 0 queued, 0 sent since 31 Oct, no 201/404/410 responses ever logged (server.log VERIFIED). If the Mac sleeps, the cron job stops; on wake, `getDuePushes` (`db.js:95-99`) has no lower time limit, so everything missed is sent at once, late: a "leave now" could arrive hours after the gig started (INFERRED). The Tailscale log shows the Mac changing networks often today (`link change` lines), which suggests a laptop that moves and sleeps.

**5. Failure handling.**
- Expired subscriptions: 404/410 removes the subscription and marks the push sent (`scheduler.js:48-51`). Fine. Other errors leave the push unsent and it retries every five minutes forever (no attempt limit).
- Permission denied: shown as an error in Settings (`AppSettings.jsx:213`); on native the message is misleading.
- `user_id`: stored only when the subscribe call carries a valid sign-in token (`push.js:45-53`); the regular `schedule` calls carry no token at all (`pushManager.js:61-67`), and the server accepts them from anyone (low risk on the Mac, higher on public Railway).
- London time: the phone computes times in its own local time and sends an absolute UTC time, so GMT/BST is handled correctly, except the daily-briefing date bug above.
- Repeated tags: daily reminders are date-suffixed for the iOS "renotify" problem (`pushManager.js:83-89`). Fine.
- Deep links on tap: `src/sw.js:40-65` opens the right page, for web only. Old `public/sw-push.js` is a leftover duplicate.
- The queue never deletes sent items and rewrites the whole file on every change (`db.js:43-49,101-106`); harmless at current size.

**6. In-app.** `notifications` table exists on the local database (VERIFIED, 0 rows), so the bell works but stays empty because reminders and missions never write to it. Badge cannot work on native. The `Reminder` entity is unused (0 rows).

**7. Shortest route.** See fix 1: iOS local notifications from inside the app. Everything else that needs a server to reach a closed phone (instant new-lead pushes, reminders for gigs added elsewhere) needs real Apple push, a paid developer account and an always-on server, which belongs with the cloud move.

## Root causes, most damaging first

1. **The iPhone app has no notification mechanism.** All delivery is web push; the native build turns it off and adds nothing in its place (`main.jsx:17-19`, no plugin in `package.json`, no entitlements).
2. **Nothing is subscribed to the Mac's server**, so even the server-initiated alerts (leads, quotes) and browser reminders have no recipients (empty store, server log).
3. **Planning lives on the phone and only runs on app open**, so reminders depend on Avi opening the right device daily, and cancelled gigs keep stale reminders (`Layout.jsx:136-153`, `push.js:78-81`).
4. **Missions and the assistant's nudges are not wired to any delivery path**, not even the bell (grep result above). This is where "Hey, why didn't you do that?" should come from.
5. **The server is a single Mac that can sleep**, and it catches up by sending everything late rather than dropping stale alerts (`db.js:95-99`).

## Fix list (most reminders back per unit of work)

| # | What | Files | Size | Risk | Depends on |
|---|---|---|---|---|---|
| 1 | **Native local notifications.** Add `@capacitor/local-notifications`. Split `schedulePushNotifications` into "build the list" and "deliver": web keeps POSTing to the server, native cancels all pending Flowtone notifications and schedules the soonest ones on the phone (iOS keeps at most 64 pending, so take the next 64 by time). Ask permission from the existing Settings toggle. Handle taps with the plugin's action listener and `navigate(url)`. Brings back all 18 scheduled types on the iPhone with no server involved | `src/lib/pushManager.js`, `src/Layout.jsx`, `src/pages/AppSettings.jsx`, `package.json`, `ios/` (cap sync), new `src/lib/localNotifications.js` | M | Low: device-only, nothing leaves the phone; needs an Xcode rebuild and reinstall | Nothing |
| 2 | **Re-plan on resume, not just on first load**, so returning to the app tops up the queue (the 64 limit makes this matter) and picks up gigs that arrived through calendar sync | `src/Layout.jsx` (use the existing visibility/resume hook pattern at 159-167) | S | Low | 1 |
| 3 | **Mission nudges to the bell and to the phone.** When the scanner creates or escalates an action item, write a `notifications` row and, on native, a local notification. Coordinate with the AI audit | mission scanner (sibling's files), `src/lib/appBadge.js` `notify()` | S-M | Low | 1 for the phone part |
| 4 | **Clear before re-planning** (web path): new server route "replace all unsent for this endpoint", called once before scheduling, so cancelled or moved gigs stop reminding | `server/routes/push.js`, `server/db.js`, `src/lib/pushManager.js` | S | Low (needs a server restart, done by Avi or the repair session) | Nothing |
| 5 | **Drop stale catch-up pushes**: skip anything more than ~30 minutes overdue when the Mac wakes; prune sent rows | `server/db.js`, `server/scheduler.js` | S | Low | Server restart |
| 6 | **Honest settings on native**: show the real permission state and drop "install as PWA"; show the test button | `src/pages/AppSettings.jsx:209-215,762-779` | S | Low | 1 |
| 7 | **Small correctness fixes**: daily-briefing UTC date, multi-day repeat for overdue/needs-fee (schedule several days ahead), `public/sw-push.js` leftover | `src/lib/pushManager.js`, `public/sw-push.js` | S | Low | Nothing |
| 8 | **Server-side reminders with real Apple push** (APNs): `@capacitor/push-notifications`, `aps-environment` entitlement, APNs key on the server; the server computes reminders from the database every few minutes instead of the phone. Gives instant lead alerts and reminders for gigs added anywhere | `server/scheduler.js`, new `server/lib/apns.js`, `ios/` entitlements, `package.json` | L | Medium | Paid Apple Developer account; an always-on server, so the cloud move |
| 9 | **Retire the old web app**: remove the Vercel icon from the home screen; when the cloud move happens, mount a volume for the push store (or move subscriptions into Postgres) | Railway config, `server/db.js` | S | Low | Cloud move |

## What I could not verify

- **That the iPhone app's web view has no `serviceWorker` / `PushManager`** at runtime. Read from code and platform rules, not run in the simulator (a build would take longer than the time box). The code path fails either way, because the service worker is never registered on native.
- **Signed-in screens.** I did not open the real-data app on port 3011: opening it re-plans reminders, and with no subscription it would show nothing extra. Settings behaviour on native is read from code.
- **Railway's push store** (subscriptions, queue, last sends): its debug route is closed in production. I did not send anything there.
- **Whether the scheduler fired at each five-minute tick**: it logs nothing when idle. The process is up and healthy.
- **Apple signing**: no Flowtone provisioning profile was found in the usual Xcode folders, so I could not tell whether the developer account (team `NPTYVV6KC4`) is paid (needed for fix 8) or free (apps expire after 7 days).
- **Test notification: not sent.** There are no stored subscriptions for Avi (or anyone) on this Mac's server, so there was nothing to send to; I did not create one.

## Questions only Avi can answer

1. Is the Mac that runs Flowtone a laptop that sleeps or leaves the house? If yes, the server cannot be the thing that wakes your phone until the cloud move, and fix 1 is the only reliable route for now.
2. Is your Apple Developer account the paid one (99 a year), and does the Flowtone app on your phone stop opening after about a week? This decides when real push (fix 8) is possible.
3. Is the old Flowtone icon from the website still on your home screen, and have you had any Flowtone notification at all since late October? (If yes, it came from the old Railway server with October data.)
