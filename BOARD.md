# Flowtone Board

> Your single dashboard. Read it on GitHub (renders nicely on your phone) to see
> where everything stands without the terminal. Claude keeps it updated each session.
>
> **How to use:** owners are marked `(Avi)` = only you can do it, `(Claude)` = code.
> Say "show me the board", "move X to done", or "add X to concepts" any time.
>
> _Last updated: 19 June 2026_

---

## NOW — actively in progress
- [ ] **(Avi)** Whitelist testers' Google emails as Test users in Google Cloud Console → unblocks Calendar + Email for them today

---

## AVI'S TO-DOS — only you can do (accounts, approvals, setup)
- [ ] **Whitelist testers** in Google Cloud Console → Audience → Test users (in progress)
- [ ] Add the **privacy URL** `https://flowtone.vercel.app/privacy` to the OAuth consent screen
- [ ] **Submit Google OAuth verification** (privacy URL done · still need: demo video + consent screen matching). 4–8 weeks — clock starts only when you submit, so submit early
- [ ] Skim `/privacy` page for accuracy (contact email is `avi.mishali@gmail.com` — change if you want)
- [ ] **Meta WhatsApp setup:** create Meta app + WhatsApp product, register your own phone number as the sender, create a permanent token, set the webhook, then hand Claude the 4 env vars (see `WHATSAPP_PLAN.md`)
- [ ] Decide the **three pricing tiers** (what's in each)
- [ ] (optional) Set `APP_PUBLIC_URL` on Railway → enables the "View in Flowtone" link in Google event descriptions

---

## CLAUDE'S TO-DOS — code
- [ ] **WhatsApp AI assistant** — build once Meta creds exist (`WHATSAPP_PLAN.md`): webhook, number→account linking, server-side action agent
- [ ] **"How to connect" help page** for testers (Gmail · Calendar · CSV import) + how to get past the "unverified app" screen
- [ ] **iPhone contact-picker fallback** — clean message + manual entry on iOS so it doesn't look broken
- [ ] Refresh **CLAUDE.md** (outdated: still describes the removed "Docs" event section) + stale README
- [ ] (optional) Invoice **line-item "type-then-+" trap** fix in DocumentDetail (same bug class as the client one — `CLIENT_AUTOSAVE_PLAN.md`)
- [ ] **Railway push store** is ephemeral — mount a volume so scheduled pushes survive redeploys (`TODO.md`)
- [ ] **Per-user push** → unlocks closed-app alerts for new Google gigs + the app-icon badge (`TODO.md`, `APP_ICON_BADGE_PLAN.md`)
- [ ] **Saved places** (Home/Studio) for AI travel awareness (`TODO.md`)
- [ ] **Per-user AI usage logging** (tokens/replies) before scale (`TODO.md`)

---

## CONCEPTS — ideas under discussion (not decided)
- **App-icon badge + notification center** — "you have something to look at" counter (`APP_ICON_BADGE_PLAN.md`)
- **Address autocomplete at scale** — current free Nominatim has a fair-use limit; swap to self-host or Google Places when it bites (`TODO.md`)

---

## PARKED — we WILL do, but blocked by a platform limit

### Code is ready — just waiting to connect / flip on
- **Public Gmail + Google Calendar for all users** — fully built and works for whitelisted testers now; just needs Google verification to clear, then flip the OAuth app from Testing → Production. _Blocker: Google verification (4–8 wks)._

### Not built yet — waiting on the blocker
- **Pick from iPhone contacts** — works on Android; impossible on iPhone via web/PWA. _Blocker: Apple (no web contacts API) → needs a native iOS app/wrapper._
- **WhatsApp messages first** (reminders, "your gig synced") — the user-initiated assistant doesn't need this; proactive sending does. _Blocker: Meta template approval + business verification._
- **Read client emails / gig inbox** — scaffolding exists (Inbox page, EmailMessage, client email tags) but unwired; paused on purpose. _Blocker: restricted `gmail.readonly` scope + annual CASA security audit._

---

## TIERS / PRICING
- [ ] Define the three tiers — what features land in each, trial vs paid, what's gated.
  _(To be filled in with Avi.)_

---

## DONE — recently shipped
- **Calendar renamed "Flow"** + auto-renames already-connected testers (`406101b`)
- **Privacy policy page** at `/privacy` — for Google verification (`406101b`)
- **Event invoicing moved into Financials** — removed "Docs" section + per-event calendar sync; **Create invoice** button now always works, fixing the calendar-synced-gig dead-end (`3ebb92b`)
- **Code-splitting** — first-load bundle 993 KB → 666 KB (`9ed370e`)
- **First-load black screen fixed** — instant boot splash + ErrorBoundary + auth watchdog (`e65582c`)
- **Invoicing language follows the event type** (gigs / lessons / sessions, not always "lessons")

---

## Deep-dive plans (full handoff docs in the repo root)
- `WHATSAPP_PLAN.md` — WhatsApp AI assistant (Meta Cloud API, user-initiated)
- `APP_ICON_BADGE_PLAN.md` — app-icon badge + notification center
- `CLIENT_AUTOSAVE_PLAN.md` — client auto-save (mostly shipped)
- `TODO.md` — engineering backlog with context
