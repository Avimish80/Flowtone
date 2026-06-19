# WhatsApp AI Assistant — Plan (simplest, user-initiated)

> Handoff doc. Goal: testers add **"Flow"** as a WhatsApp contact and message it; the
> AI replies and performs actions in their Flowtone account. **The user always sends
> first; Flow never initiates.** Provider: **Meta WhatsApp Cloud API** (Avi already has
> a Meta Business account — avoids Twilio fees).
>
> Match existing server patterns (`server/routes/*.js`, `server/lib/*.js`). No TypeScript,
> no emojis in source.

---

## Why this shape is the simple one

Because the human always messages first and Flow only ever **replies**:
- No **message templates** and no proactive-send approval (the slow, bureaucratic Meta step).
- Every reply lands inside WhatsApp's **24-hour customer service window**, which needs no approval.
- User-initiated "service" conversations are the cheapest tier (effectively free at tester
  volume; Meta gives a free monthly allowance).

So "user-initiated only" is the cheat code that keeps this small. If we ever want Flow to
message first (reminders, "your gig synced"), that's a separate, heavier phase (templates +
business verification) — explicitly OUT of scope here.

---

## What already exists (reuse, don't rebuild)

- **The AI brain:** `server/routes/ai.js` — `buildSystemPrompt(context)` + `POST /chat`
  calls Anthropic and returns `{ message, actions[], action }`. The action vocabulary
  (CREATE_EVENT, CREATE_CLIENT, CREATE_RECURRING_EVENTS, invoices, etc.) is already defined.
- **Server DB access:** `server/lib/supabaseAdmin.js` — service-role client; can read/write
  any user's rows by `user_id`.
- **Auth helpers:** `server/lib/auth.js`, `server/lib/access.js`.

**The gap:** today the **browser** (`src/components/AIAssistant/useAIAssistant.js`) executes
the returned actions via `appClient`. On WhatsApp there is no browser — the **server** must
build the context AND execute the actions.

---

## Architecture (3 new pieces)

### 1. Inbound webhook — `server/routes/whatsapp.js`
- `GET /api/whatsapp/webhook` — Meta verification handshake: echo `hub.challenge` when
  `hub.verify_token === WHATSAPP_VERIFY_TOKEN`.
- `POST /api/whatsapp/webhook` — receives messages. Verify the `X-Hub-Signature-256`
  header against `WHATSAPP_APP_SECRET` (reject if it doesn't match). Extract sender
  `wa_id` (phone) and the text body. Ack with 200 immediately, process async.
- Mount in `server/index.js` alongside the other routers.

### 2. Identity linking — WhatsApp number → Flowtone user  ★ the one unavoidable hard part
WhatsApp gives us only the sender's phone number. We must map it to an account.
- **Store** the user's WhatsApp number on their profile: add `whatsapp_number` (E.164,
  digits only) to the `profiles` table (or `BusinessProfile`).
- **Set it** in the app: a field in `AppSettings.jsx` ("Your WhatsApp number") so a tester
  links themselves once. Normalize to digits-only on save.
- **Look up** on each inbound message: `supabaseAdmin.from('profiles').select().eq(
  'whatsapp_number', normalized)`. No match → reply once: "This number isn't linked to a
  Flowtone account yet — add it in Settings." (Never act on an unlinked number.)
- Uniqueness: enforce one number per account (unique index). Fine for testers.

### 3. Server-side agent — `server/lib/aiAgent.js`
`runWhatsappTurn({ userId, text, history })`:
1. **Build context from Supabase** (mirror what the browser sends today): the user's
   upcoming events + clients, currency, profile/name. This replaces the client-supplied
   `context` so `buildSystemPrompt` has the same situational awareness.
2. **Call the AI** — reuse `buildSystemPrompt` + the same Anthropic call as `/chat`.
   Pass a short rolling `history` (last ~8 turns) so multi-message threads make sense
   inside the 24h window.
3. **Execute actions server-side** — this is the real work. Port the action handlers the
   browser runs in `useAIAssistant.js` to operate on `supabaseAdmin` with `user_id`.
   v1 subset (cover the headline use case, expand later):
   - `CREATE_EVENT`, `UPDATE_EVENT`
   - `CREATE_CLIENT`
   - `CREATE_RECURRING_EVENTS`
   - read-only Q&A (actions: [])
   Defer: invoices, DELETE_* (or require explicit "yes" first, per the existing prompt rule).
4. **Skip channel-incompatible actions:** `SUGGEST_CONTACT_PICKER` (no device picker on
   WhatsApp) and `LOCATION_SEARCH` (no tap-to-pick UI) — tell the agent via a context flag
   (e.g. `channel: "whatsapp"`) so the prompt knows not to emit them; if one slips through,
   ignore it gracefully.
5. **Return** the AI's `message` text.

### Reply
Send the agent's message back via Meta Graph:
`POST https://graph.facebook.com/v21.0/<WHATSAPP_PHONE_NUMBER_ID>/messages`
with `{ messaging_product: "whatsapp", to: wa_id, text: { body } }` and
`Authorization: Bearer <WHATSAPP_TOKEN>`.

### Conversation history
Keep last N turns per user for context. Simplest: a `whatsapp_messages` table
(user_id, role, content, created_at) via supabaseAdmin, or reuse an existing message store.
Avoids a stateless agent that forgets the previous line mid-thread.

---

## Meta setup (Avi's side — needs the Meta Business account)

1. **developer.facebook.com** → Create App → type **Business** → add the **WhatsApp** product.
2. **WhatsApp → API Setup:** note the **Phone Number ID** and **WhatsApp Business Account ID**.
   - Dev/test number can message a small set of **added recipient numbers** (good for a few
     testers). For more testers, register your own number and/or complete business
     verification.
3. **Permanent token:** Business Settings → System Users → create one → generate a token with
   `whatsapp_business_messaging` + `whatsapp_business_management`. (The temporary 24h token is
   only for first smoke-testing.)
4. **Webhook:** point it at the Railway server `https://flowtone-production.up.railway.app/api/whatsapp/webhook`,
   set a verify token, and **subscribe to the `messages` field**.
5. **Env vars on Railway:**
   - `WHATSAPP_VERIFY_TOKEN` (any secret string you choose; must match the webhook config)
   - `WHATSAPP_TOKEN` (the permanent System User token)
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_APP_SECRET` (App → Settings → Basic) for signature verification

---

## Division of labor
- **Avi:** the Meta setup above + provide the 4 env vars. Each tester adds the Flow number
  to WhatsApp and sets their WhatsApp number in Flow Settings once.
- **Me (code):** `server/routes/whatsapp.js`, `server/lib/aiAgent.js`, the
  `whatsapp_number` profile field + Settings UI, the server-side action handlers, and the
  history store.

---

## Acceptance checklist
- [ ] Tester sets their WhatsApp number in Settings; sending a message from that number is
      recognised as their account.
- [ ] "Add a gig for Saturday 8pm at The Blue Note, £400, client Akiva" → event created in
      that account, client linked/created, AI replies confirming in plain language.
- [ ] Unlinked number gets the "link in Settings" reply and no action is taken.
- [ ] A two-message thread keeps context (follow-up "make it 9pm" updates the right gig).
- [ ] Signature verification rejects a forged webhook call.
- [ ] No proactive messages are ever sent (replies only, inside 24h).

## Out of scope (later phases)
- Flow messaging first (reminders/alerts) — needs templates + business verification.
- Invoices/deletes over WhatsApp — add after the create-flow is solid.
- Reading the user's email/inbox — separate feature, paused (restricted Gmail scope + audit).
- Clients (not the musician) talking to the AI — a different, heavier product.
