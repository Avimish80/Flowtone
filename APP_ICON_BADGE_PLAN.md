# Plan: App-icon badge ("you need to look at things" counter)

> Handoff doc for Sonnet to implement. Read this whole file first.

## Context / goal

Add a number on the Flowtone app icon (like the Mail/WhatsApp badge) that tells the user
"there are things here you need to look at." The count is the number of **unread attention
items** — discrete things the app wants to surface:
- a **gig was added** (e.g. pulled in from Google Calendar)
- an **email was received**
- a **calendar change** happened
- an **AI problem** (the assistant couldn't finish an action)
- …and it should be easy to add more producers later.

Tapping into the app (a new bell/notification center) shows the list; viewing items marks them
read and the badge goes down. This doubles as an in-app notification center.

**Cost rule (important):** the badge must add **zero AI cost**. It is pure data: producers do a
plain DB insert, the consumer does a cheap count on app-open. No Claude calls, no new cron — it
piggybacks on the existing app-open hub (`Layout.jsx`) and the existing calendar sync cron.

## How the badge actually works (PWA reality)

- API: `navigator.setAppBadge(n)` / `navigator.clearAppBadge()`. Supported on installed PWAs,
  including **iOS 16.4+** (requires notification permission, which push already requests). Always
  feature-detect and no-op where unsupported.
- **Foreground** (app open): JS calls `navigator.setAppBadge(count)`.
- **Background** (app closed): only a **push** can wake the service worker to update the badge —
  the SW `push` handler calls `self.navigator.setAppBadge(count)`. Live background updates therefore
  depend on the **per-user push plumbing** (the existing TODO "Closed-app push for new Google gigs",
  which ties push subscriptions to `user_id`). So we phase it:
  - **Phase 1 (foreground):** badge reflects unread count whenever the app is opened/closed. It
    persists on the icon after close. No new infra. Ships immediately.
  - **Phase 2 (live/background):** when a server producer creates a notification, enqueue a push
    carrying the new unread count; the SW sets the badge while the app is closed. Shares plumbing
    with the calendar closed-app push TODO — do them together.

---

## Phase 1 — foreground badge + notification center

### 1. Data model — `notifications` table
New Supabase migration in `supabase/migrations/` (mirror the existing migration style):
```sql
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,            -- 'gig_added' | 'email_received' | 'calendar_change' | 'ai_problem'
  title text not null,
  body text,
  entity_type text,              -- 'event' | 'invoice' | 'email' | null
  entity_id uuid,                -- nullable; deep-link target
  url text,                      -- in-app deep link, e.g. '/WorkEventDetail?id=...'
  read_at timestamptz,           -- null = unread (drives the badge)
  created_at timestamptz default now()
);
create index notifications_user_unread on notifications (user_id, read_at);
-- RLS: user_id = auth.uid() for select/insert/update/delete (copy pattern from work_events).
```

### 2. Register the entity (so the client can read/write it the normal way)
- `src/api/appClient.js`: add `"Notification"` to `entityNames`.
- `src/api/entityMetadata.js`: add to `ENTITY_CONFIG`:
  ```js
  Notification: {
    table: "notifications",
    columns: ["type", "title", "body", "entity_type", "entity_id", "url", "read_at"],
    jsonColumns: [],
  },
  ```
- `src/api/localStorageEngine.js`: add `"entity_id"` to `UUID_FK_COLUMNS` so a blank id coerces to
  `null` (same uuid-column guard that fixed the recurring-events crash).

### 3. Badge helper — `src/lib/appBadge.js` (new)
```js
import { appClient } from "@/api/appClient";

export async function getUnreadCount() {
  // Notifications per user are few — list and count unread client-side (cheap, no AI).
  const all = await appClient.entities.Notification.list("-created_at", 100).catch(() => []);
  return all.filter((n) => !n.read_at).length;
}

export async function refreshAppBadge() {
  if (!("setAppBadge" in navigator)) return;
  const count = await getUnreadCount();
  try { count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge(); } catch {}
}

export async function markRead(ids = []) {
  await Promise.allSettled(
    ids.map((id) => appClient.entities.Notification.update(id, { read_at: new Date().toISOString() }))
  );
  await refreshAppBadge();
}

export async function notify({ type, title, body = "", entity_type = "", entity_id = "", url = "" }) {
  await appClient.entities.Notification.create({ type, title, body, entity_type, entity_id, url });
  await refreshAppBadge();
}
```

### 4. Wire the consumer into app-open — `src/Layout.jsx`
`Layout.jsx` already runs app-open work (push scheduling, `maybeSyncOnOpen`, data load). Add a
`refreshAppBadge()` call there, and after `maybeSyncOnOpen()` resolves (a sync may have created
`gig_added` notifications server-side — see Phase 2 producers; in Phase 1 the client mirrors them,
see below).

### 5. Bell / notification center UI
- In `Layout.jsx` header (next to the theme toggle), add a `Bell` icon (lucide) with a small
  unread-count dot.
- New `src/components/notifications/NotificationsPanel.jsx`: slide-up/overlay listing notifications
  (`Notification.list("-created_at")`), each row tappable → navigate to `url` and `markRead([id])`.
  Include "Mark all read". On open, optionally mark all visible as read (or only on tap — keep tap
  to read so the user controls it). Match the dark card styling used by `AIAssistantPanel.jsx`.

### 6. Phase-1 producers (create notifications — all plain inserts, no AI)
- **AI problem (client):** in `src/components/AIAssistant/useAIAssistant.js`, the action-failure
  catch block (the "I couldn't finish that one" path) — also call `notify({ type: 'ai_problem',
  title: "I couldn't finish that one", body: <action label>, url: '/' })`.
- **Gig added / calendar change (client mirror):** `maybeSyncOnOpen` (`src/lib/calendarClient.js`)
  already surfaces new bare gigs to the client. Where it learns of new gigs, call `notify({ type:
  'gig_added', title: ..., entity_type: 'event', entity_id, url: '/WorkEventDetail?id=...' })`.
- **Email received (client):** wherever the Gmail inbox refresh detects new unread relevant mail
  (`src/lib/gmailClient.js` / EmailInbox), call `notify({ type: 'email_received', ... })`.
  De-dupe by storing the source id in `entity_id` and skipping if a notification already exists.

> Phase 1 creates notifications **client-side** so it needs no server changes and ships fast. The
> trade-off: items only appear when the app is open. Phase 2 moves the server-side producers + push.

---

## Phase 2 — live background badge (shares plumbing with the calendar closed-app TODO)

1. Implement the per-user push plumbing from the TODO "Closed-app push for new Google gigs":
   authenticate `/api/push/subscribe` and store `user_id` (`server/db.js`), add
   `enqueuePushForUser(userId, payload)`.
2. **Server producers** write `notifications` rows (via `supabaseAdmin`, scoped by `user_id`) and
   then `enqueuePushForUser`:
   - `server/lib/calendarSync.js` `runSyncForUser` — on `newBareGigs` (and deletions) insert
     `gig_added` / `calendar_change` notifications.
   - `server/lib/aiAgent.js` (the WhatsApp server agent) — on a failed action insert `ai_problem`.
   - Email-received producer if/when email sync moves server-side.
3. **Push payload carries the badge count:** the SW sets it without the app running.
   In `src/sw.js` `push` handler, after `showNotification`, add:
   ```js
   if (typeof data.badge_count === "number" && self.navigator && "setAppBadge" in self.navigator) {
     event.waitUntil(self.navigator.setAppBadge(data.badge_count));
   }
   ```
   (Server includes `badge_count` = the user's unread total when it enqueues the push.)

---

## Key files
- New: `supabase/migrations/<date>_notifications.sql`, `src/lib/appBadge.js`,
  `src/components/notifications/NotificationsPanel.jsx`, `APP_ICON_BADGE_PLAN.md` (this file).
- Edit: `src/api/appClient.js`, `src/api/entityMetadata.js`, `src/api/localStorageEngine.js`,
  `src/Layout.jsx`, `src/sw.js`, `src/components/AIAssistant/useAIAssistant.js`,
  `src/lib/calendarClient.js`, `src/lib/gmailClient.js`.
- Phase 2 server: `server/db.js`, `server/routes/push.js`, `server/lib/calendarSync.js`,
  `server/lib/aiAgent.js`.

## Cost & safety notes
- **Zero AI cost** by design — no Claude calls anywhere in this feature.
- Notifications are small, per-user, RLS-scoped; admin/server writes MUST filter by `user_id`.
- Always feature-detect `setAppBadge`; it's a graceful no-op on unsupported browsers/desktop.
- De-dupe producers (by `entity_id` / source id) so the same gig/email can't badge twice.

## Verification
1. **Phase 1 foreground:** trigger an AI failure and a calendar-synced gig → a `notifications` row
   appears, the bell shows the count, and (installed PWA on iPhone) the icon shows the number.
2. Open the notification center, tap an item → it navigates, `read_at` is set, badge decrements;
   "Mark all read" clears the badge.
3. Reopen the app with unread items → badge restored to the unread count on open.
4. **Multi-user:** a second account never sees another user's notifications (RLS).
5. **Phase 2 background:** with the app fully closed, a server producer + push updates the icon
   badge without opening the app.
6. **Unsupported browser:** desktop/older browser → no errors, badge calls no-op silently.
