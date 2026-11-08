# Flowtone AI proactive-helper audit

6 November 2026. Read-only audit of the brain and the voice: what the assistant notices, what it decides to say and when, where that shows up, and whether you can act on it in one tap. Delivery to the phone (push, scheduler, badge, preferences) belongs to the sibling reminders audit; hand-off points are noted and stop there.

Method: SELECT-only queries on the local database (read-only session), the server log, the code in the working tree, and four tiny direct calls to Anthropic using the server's own key and the exact model ids and settings the server uses. The signed-in app was not opened, because opening it runs the scan and changes what is being measured.

---

## Verdict

1. The assistant does notice real problems in your data, and the AI models behind it are switched on and answering today, so nothing is "switched off".
2. But it only looks at your data when the app starts from cold, it never speaks first, and what it finds lands as a small card on the Home screen (four at most) rather than the assistant asking you anything.
3. Two bugs make it feel dead: every task it saves loses its details (which client, how much, whether there is an email), and the step that turns findings into friendly sentences breaks because you have about 100 open tasks, so you only ever see stiff template lines like "Set the fee for Muzika - London".
4. Its buttons almost all just open a page: apart from "Mark sent" (and an email chase on quote leads, which that first bug breaks), nothing creates an invoice, sends one, or chases a client for you.
5. So the "Should I do this? Why didn't you do that?" helper is designed but not built: the noticing half-works, the voice is broken, and the asking-first and the doing-it-for-you are missing.

---

## The loop, as built versus as intended

Intended (memory notes `missions-system-architecture`, `missions-hybrid-ai-scan`, `missions-task-tickets`, and `ai-assistant-mockup.html`): the code finds problems, the AI (Haiku) writes warm one-line nudges, each one is a saved "ticket" that remembers what you said, buttons do the job in one tap ("Review" + "Send"), and the assistant opens with a proactive brief.

| Stage | What happens today | Status | Evidence | |
|---|---|---|---|---|
| Trigger | The scan runs once, when the main layout first loads, and at most once every 10 minutes. It does not run when the app comes back from the background, on a timer, or after you save something. The only other trigger is the Rescan button on the Missions page. Nothing on the server looks at your tasks. | Partly | `src/Layout.jsx:210-220` (one-time effect, 10-min throttle); `src/pages/Missions.jsx:141-158` (Rescan); `server/scheduler.js:60,76` (push queue and calendar sync only) | VERIFIED (code read); resume behaviour on iPhone INFERRED |
| Trigger gate | Inside the scan, a second gate skips everything unless gigs, invoices, clients or leads changed since the last scan on that device, or a snoozed task is due. Changing your AI instructions (`context_notes`) does not count as a change. | Partly | `src/lib/missionScanRunner.js:25-46` | VERIFIED (code) |
| Notice | Code rules catch: gig in the next 7 days with no address; after a gig, one blocker at a time (no fee, then no client, then no client email, then "ready to invoice"); overdue invoice; complete draft invoice (with or without email); incomplete draft older than 7 days; new lead unanswered for a day; lead quote unanswered for 3 days. | Partly | `src/lib/actionItemScanner.js:85-292` | VERIFIED (code) |
| Notice, real data | 97 open tasks for you: 64 "set the fee", 14 "add an email", 10 "add the client", 3 overdue invoices, 5 drafts with no email, 1 missing address. 47 of the 64 fee gigs are over 3 months old (Airtable import). No client has an email, so no gig ever reaches "ready to invoice". | Works, but noisy | Queries on `action_items`, `work_events`, `clients`, `documents` (see Evidence) | VERIFIED |
| Decide | The AI "decision" path only runs if you have written personal instructions in Settings. You have none, so the code alone decides. There is no ranking beyond priority 0-2 and no grouping: "Add an email for Muzika" appears 8 times, once per gig. | Partly | `src/lib/missionScanRunner.js:60-69`; `app_settings.assistant_profile` has no `context_notes`; duplicate-title query | VERIFIED |
| Say (voice) | The call that writes friendly titles sends all ~100 tasks at once with room for 1,024 words-ish of output. It runs out of room, returns broken JSON, the server hands back no titles without an error, and every task keeps the template title. Because of the payload bug below, this happens to all tasks on every scan, not just new ones. | Broken | `server/routes/ai.js:797-811` (`max_tokens: 1024`); replay with your 103 open tasks: `stop_reason: max_tokens`, `parsed: false`, `titles: 0`; stored titles equal `buildFallbackTitle` in `src/lib/missionScanRunner.js:230-257`; no compose error in `~/Library/Logs/Flowtone/server.log` (stderr goes there) | VERIFIED |
| Remember | Each task is saved as a row, but its details (client name, fee, total, currency, has-email, candidate key, change signature) are thrown away on save. All 154 stored rows have an empty `payload`. Side effect: the scan thinks every task changed every time and rewrites all of them (97 rows rewritten at 10:17-10:18 on 6 Nov). | Broken | `src/api/localStorageEngine.js:188-195` and `279-283`: `payload` is a shared column (`src/api/entityMetadata.js:1`), so the task's payload goes into `row.payload`, then the leftover-fields object (empty) overwrites it; query: 154 of 154 rows `payload = {}`, while 140 of 140 gigs keep theirs | VERIFIED |
| Remember, follow-ups | Defer, skip and done are written to real columns, so they would work. In practice nothing has ever been snoozed, skipped or replied to: 0 snoozed, 0 dismissed, 0 directives. Your reply text itself goes into `payload.last_reply`, so it would be lost. | Unused | `src/pages/MissionDetail.jsx:79-113`; query on `snoozed_until`, `status`, `user_directive` | VERIFIED (data), INFERRED (reply loss) |
| Show | Home screen card shows at most 4 tasks, hideable for the session. No badge on the nav, the More menu or the assistant button. The assistant panel never opens by itself and its first message is a fixed greeting that ignores your tasks. The daily-briefing AI route exists on the server but nothing in the app calls it. | Partly | `src/components/AIDashboardBriefing.jsx:21,85,139,152-157`; `src/components/AIAssistant/AIAssistantButton.jsx:9-55`; `src/components/AIAssistant/useAIAssistant.js:466-486`; `server/routes/ai.js:560` unused (no caller in `src/`) | VERIFIED (code) |
| Act (hands) | Almost every button only navigates to a page. Real work happens only for "Mark sent" (sets the invoice to sent and locks it) and "Chase by email" on quote leads. Because the payload is empty: the "Send" button for ready invoices never appears, the lead chase has no email address, and the ticket screen shows no client, amount or date. Saying "send it" in a ticket only opens the page. | Mostly missing | `src/pages/Missions.jsx:79-136, 269-354`; `src/pages/MissionDetail.jsx:73-75, 105-107, 208-211, 268` | VERIFIED (code), effect of empty payload INFERRED |
| Follow up | Snoozed tasks come back when due, but only if a scan runs (that is, a cold app start). Nothing nags you a second time about something you ignored; nothing escalates. The mission code never hands anything to push notifications. | Missing | `src/lib/missionScanRunner.js:41-44, 134-162`; no `pushManager` import in mission or AI code; push is scheduled separately in `src/Layout.jsx:136-153` | VERIFIED (code) |

---

## Root causes, most damaging first

1. **It never speaks first.** No part of the app turns a finding into a question to you: no badge, no assistant opening line, no morning brief, no push from tasks. The "proactive brief card" in `ai-assistant-mockup.html` was never wired; the `/briefing` route is orphaned. This is the main reason it does not feel like a helper.
2. **Task details are thrown away on save** (`src/api/localStorageEngine.js:188-195, 279-283`). This one bug breaks the friendly titles' change detection, the Send button, the lead email chase, the ticket screen's client and amount chips, the AI's understanding of your replies (`server/routes/ai.js:842-843` gets blanks), and the chat's view of tasks (`useAIAssistant.js:133`). It does not happen in preview mode (data stays whole in the browser), which is why earlier testing looked fine.
3. **The voice breaks at scale.** One AI call for ~100 tasks with a 1,024-token cap (`server/routes/ai.js:797-801`), long ID keys, and a silent fallback. Because of cause 2, every scan asks for all titles again, so it always fails.
4. **Hands are links, not actions.** "Create invoice", "Chase", "Send" all navigate (`src/pages/Missions.jsx:79-83`). The chat can create invoices (`CREATE_INVOICE_FROM_EVENTS`) but the task buttons do not use it, and the chat cannot close, snooze or skip a task.
5. **It only looks on a cold start.** The scan is a one-time effect on layout mount (`src/Layout.jsx:210-220`). An iPhone app resumed from the background does not remount, so on the phone it may go days without looking (INFERRED).
6. **Noise drowns signal.** 64 "set the fee" tasks (47 older than 3 months), the same missing email raised once per gig, and only 4 shown. Your saved fee rules (`app_settings.fee_rules`, "Function gigs £450") are never offered as a fix.
7. **Detection gaps for a gigging musician.** Not caught: past gigs still marked "confirmed" (3 today); anything about an upcoming gig except its address (fee, client, start time, set list, kit); unconfirmed "lead" gigs; quotes (estimates) sent with no reply outside the Leads feature; a sent invoice with no due date; a first chase versus a second chase on overdue invoices.

Not a cause: the AI models. All four model calls the server makes succeed today (see Evidence).

---

## Fix list, ranked by how much more proactive it feels per unit of work

| # | What | Files | Size | Risk | Depends on |
|---|---|---|---|---|---|
| 1 | Keep task details on save: merge the record's own `payload` with leftover fields instead of overwriting it, in create and update. Next scan then rewrites every task's details by itself. | `src/api/localStorageEngine.js` (create ~188, bulk ~228, update ~279) | S | Low, but it touches the shared data layer, so test events and invoices too | Nothing |
| 2 | Make the voice survive: send tasks in batches of about 15, use short keys (1, 2, 3) and map back, raise `max_tokens`, keep titles that did parse, only ask for new or changed tasks. | `server/routes/ai.js:742-811`, `src/lib/missionScanRunner.js:164-185` | S | Low | 1 (otherwise it re-asks for everything each scan) |
| 3 | Speak first, inside the app: a count badge on the assistant button and the Missions entry; the assistant panel opens with "Here's what I'd do today" from the top 3 tasks, each with a Yes button. Revive or replace the orphaned `/briefing` route. | `AIAssistantButton.jsx`, `useAIAssistant.js:466-486`, `AIAssistantPanel.jsx`, `src/Layout.jsx` | M | Low | 1, 2 |
| 4 | Look more often: run the scan when the app comes back to the front (browser visibility and the Capacitor resume event) and after saves, and let a change to your AI instructions force a rescan. | `src/Layout.jsx:157-220`, `src/lib/missionScanRunner.js:25-46` | S | Low (the cost is AI calls, kept small by 2) | Nothing |
| 5 | Cut the noise: one task per client for a missing email ("Muzika has 8 gigs waiting on an email"), one bulk task for old fee-less gigs ("47 old gigs have no fee: apply your fee rules, or forget anything before August?"). | `src/lib/actionItemScanner.js`, `src/lib/feeRules.js` | M | Medium: changes task identity, so plan how existing rows resolve | 1 |
| 6 | Real one-tap hands: "Create invoice" builds the invoice (reuse the chat's `CREATE_INVOICE_FROM_EVENTS` and `buildInvoiceFromEvents`); "Chase" on overdue opens a ready-written reminder email to confirm; "Mark gig done"; the chat gets actions to resolve, snooze and skip tasks. | `src/pages/Missions.jsx`, `src/pages/MissionDetail.jsx`, `src/components/AIDashboardBriefing.jsx`, `useAIAssistant.js`, `server/routes/ai.js` | M to L | Medium: anything that emails a client needs a confirm step | 1; Gmail OAuth is still in Testing mode |
| 7 | New "why didn't you" rules: gig passed but still "confirmed"; gig in the next 3 days with no fee or client ("confirm the fee before Saturday?"); unconfirmed lead gig; quote sent, no reply in 5 days; second chase 7 days after the first. | `src/lib/actionItemScanner.js`, possibly `src/lib/missingInfo.js` (shared with push, so coordinate with the reminders work) | M | Low to medium | 1 |
| 8 | Speak first, outside the app: the server runs the scan daily and sends the top nudge as a push ("3 gigs from last week still need invoices. Do them now?"). | `server/scheduler.js`, new server scan module; hand-off to the push layer | L | Medium | The notification layer working (sibling audit); the server must reach the database, which it does locally today and must again after the cloud move |
| 9 | Move to current models before the old ones retire: Haiku 5.5 must be called without `temperature` (it rejects it). | `server/routes/ai.js:507-509, 610-612, 702-704, 798-800, 868-870` | S | Low | Nothing (not urgent: today's ids still work) |

Doing 1, 2, 3 and 4 (all small or medium) would give you a helper that opens with a short, warm, specific list of what it would do, and tells you so with a badge. Items 6 and 8 are what make it feel like it does the work and comes to find you.

---

## Answers to the seven questions, in short

1. **Trigger.** Cold start of the app (any screen, since it lives in the layout), at most every 10 minutes, plus a second "did data change" gate; the Rescan button; nothing on the server. The gates can block wrongly: a resumed iPhone app never rescans (INFERRED), changing your AI instructions does not trigger a rescan, and the "last scan" marker is per device. `src/Layout.jsx:210-220`, `src/lib/missionScanRunner.js:25-46`.
2. **Detection.** Rule types listed in the loop table. Against your real data the stored tasks match the rules (97 open; 24 past gigs with a fee but no invoice are all held up by missing client or email). Missed, as listed in root cause 7. Not caught as a task: "drafted but not sent" only appears when the draft is complete (5 today, all with no email). The scanner itself was not executed in Node; the comparison was done with equivalent SQL.
3. **Voice.** Every model call succeeds today (VERIFIED): `claude-sonnet-4-6` with `temperature: 0` (chat, 2,000 tokens; last six chats on 1 and 6 Nov logged in `ai_usage_events`, about 20,000 input tokens each); `claude-haiku-4-5-20251001` with `temperature: 0` (briefing 512, compose 2,048 or 1,024, task reply 300); `claude-haiku-5-5` without temperature (calendar sorting) works, and would fail if `temperature` were added. On failure: compose and briefing fall back silently to template text; chat shows the server's error text; task reply has an empty fallback. Only chat logs usage, so there is no record of the Haiku calls.
4. **Memory.** You: 97 open, 46 resolved, 0 snoozed, 0 dismissed, 0 replies. Created 25 Oct to 1 Nov, all open rows rewritten on 6 Nov at 10:17-10:18. No duplicate rows per gig, but the same client problem repeats per gig. Follow-ups would come back via `snoozed_until`, but none has ever been set. Reply text would be lost (payload bug).
5. **Surfacing.** Home card (4 max), Missions page under More. No badge, no assistant opening line, no banner, never opens by itself. It only answers.
6. **Hands.** Navigate-only for every type except "Mark sent" (real) and lead "Chase by email" (real, but broken by the empty payload). Details in the loop table.
7. **Chat.** Can create, update and delete gigs, clients and invoices, create recurring gigs, build invoices from gigs, record payments, log practice, set goals, change invoice style, navigate, and look up venues (`useAIAssistant.js:171-462`, `server/routes/ai.js:124-330`). Sees gigs from 180 days back to a year ahead (200 max), 150 documents, 80 tasks. Cannot touch tasks (told they are read-only, `server/routes/ai.js:350`) and cannot email anyone. "Mark sent" through chat only changes the status. The ticket box's hint "send it" promises more than it does.

---

## Evidence (queries and probes)

- Read-only session confirmed: `show default_transaction_read_only` returned `on`.
- `action_items` for your account: open 97, resolved 46. Open by type: fee 64, contact 14, client 10, overdue 3, ready-no-email 5, location 1. Rows with `snoozed_until` set: 0; with `user_directive`: 0. Rows with empty `payload`: 154 of 154 (all users). Gigs with non-empty `payload`: 140 of 140.
- Rows updated on 6 Nov: 24 at 10:17 and 73 at 10:18 (whole open list rewritten).
- "Add an email for ..." open titles: Muzika 8, Flumi Band 3, Noya Showband 2, Elite Entertainment 1.
- Your data: past billable gigs with a fee and no invoice 24; with no fee and no invoice 64 (47 older than 90 days); past gigs still "confirmed" 3; upcoming gigs without a client 13; 7 clients, none with an email; invoices: 11 paid, 3 sent and overdue, 5 drafts; no leads.
- `ai_usage_events`: six `claude-sonnet-4-6` chat turns (1 Nov x3, 6 Nov x3), ~20,000 input tokens each.
- Direct probes (no data sent, prompt "Say OK"): `claude-haiku-4-5-20251001` + temperature 0: OK. `claude-sonnet-4-6` + temperature 0: OK. `claude-haiku-5-5` without temperature: OK. `claude-haiku-5-5` + temperature 0: HTTP 400, "`temperature` is deprecated for this model".
- Compose replay: the server's exact legacy prompt with your 103 open tasks rebuilt from gigs and invoices, `claude-haiku-4-5-20251001`, `max_tokens 1024`, `temperature 0`: `stop_reason: max_tokens`, output not parseable, 0 titles. Nothing written anywhere.
- `server.log`: only start-up lines, last written 31 Oct, zero error lines; the LaunchAgent sends stderr to the same file, so the compose calls did not throw.

## What I could not verify, and why

- **The signed-in app on screen.** Not opened, so that the scan would not run and rewrite the rows being measured. What the Home card and Missions page look like with empty payloads is inferred from code.
- **iPhone resume.** That a resumed Capacitor app does not rescan is inferred from the one-time layout effect; not tested on the device.
- **The server's own AI routes.** They require a signed-in user (`server/index.js:54-55`), so I called Anthropic directly with the same ids and settings instead of going through the server.
- **The actual 6 Nov compose call.** No log records Haiku calls; the failure is shown by the replay plus the stored template titles, not by a captured response.
- **The scanner code itself.** Not executed (it imports through the app's `@/` alias); its rules were checked against the data with equivalent SQL.

## Questions only you can answer

1. Your 64 old gigs with no fee (47 from more than 3 months ago, mostly the Airtable import): should the assistant chase them, fill them from your fee rules, or forget anything before a date you choose?
2. How often should it speak first: every time you open the app, one morning message a day, or a push to your phone when something new comes up?
3. After you tap Yes, may it email clients itself (send the invoice, chase a late payment), or should it always stop at a ready-written draft for you to send?
