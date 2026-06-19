# Client Auto-Save — Diagnosis & Fix Plan

> **For the implementer (Sonnet 4.6):** This is a fix plan. Each issue below has file:line evidence,
> a root cause, and a concrete change. Match the existing patterns in `WorkEventDetail.jsx` (the gold
> standard) and `DocumentDetail.jsx`. Do **not** add TypeScript, emojis, or a `vercel.json`. Verify against
> the acceptance checklist at the end.

## Symptom (reported by Avi)

> "When I add a new client, or when I update an existing client's information, it doesn't save.
> Because we took off the Save button, I have no way to save it."

## How auto-save works today (context)

Three detail pages were converted to the "hero leads + auto-save, no Save button" pattern
(commits `8bd205d`, `07aa272`, `80f1082`):

| Page | New record | Existing record |
|---|---|---|
| `WorkEventDetail.jsx` | explicit **Create** button (`handleCreate`, line ~250) | `onChange` → `scheduleSave()` (debounced, ref-based) — line 226-238 |
| `DocumentDetail.jsx` | explicit **Create** button | `useEffect` on `doc` → debounced `update` — line 228-251 |
| `ClientDetail.jsx` | explicit **Create** button (`handleSave`, line 98) | `useEffect` on `client` → debounced `update` — line 51-68 |

The Client existing-record auto-save effect (`ClientDetail.jsx:51-68`) is **logically correct and
structurally identical** to the working invoice effect (`DocumentDetail.jsx:228-251`). The DB schema
matches the entity columns exactly (`supabase/migrations/20260410_backend_first_launch.sql:103-121`
vs `src/api/entityMetadata.js:113-128`), so a Client write does **not** crash in cloud mode. The bug
is therefore **not** in that effect — it is in the surrounding data-entry flow. Root causes below.

---

## Root causes (ranked by confidence)

### 1. Email/Phone "type-then-tap-+" trap — drops the most commonly edited fields  ★ primary

**Evidence:** `ClientDetail.jsx:80-94` (`addEmail`/`addPhone`), inputs at `:264-273` (email) and
`:287-296` (phone).

Emails and phones are not edited in place. The user types into a **separate** `newEmail` / `newPhone`
state, and that value is only merged into `client.emails` / `client.phones` when they tap the **+**
button (or press Enter):

```jsx
const addEmail = () => { if (!newEmail.trim()) return; onChange("emails", [...]); setNewEmail(""); };
// input:
<input value={newEmail} onChange={e => setNewEmail(e.target.value)}
       onKeyDown={e => e.key === "Enter" && addEmail()} />   // no onBlur
```

So if the user types a phone number or email and then **navigates away** (or taps **Create**) without
tapping **+**, the value never enters `client` and is silently dropped. Editing a client's phone/email
is the single most common "update a client" action, so this reads exactly as "it didn't save."

This trap fires on **both** new and existing clients:
- Existing: typed value isn't in `client`, so the auto-save effect has nothing new to persist.
- New: `handleSave` (line 98-107) creates from `client`, which excludes the uncommitted `newEmail`/`newPhone`.

This is the field that distinguishes Client from Event/Invoice: Event's core fields all bind directly via
`onChange`→`scheduleSave`; Invoice's core fields bind directly (only line-items use a +-pattern). Client
hides its two primary fields behind the +-trap.

### 2. New clients have no auto-save lifecycle and no flush-on-unmount  ★ secondary

**Evidence:** auto-save effect early-returns when `!id` (`:52`); unmount-flush requires `id` (`:71-76`).

```js
useEffect(() => () => {
  const c = clientRef.current;
  if (id && c?.name?.trim() && JSON.stringify(c) !== lastSavedJsonRef.current) {  // id-gated
    appClient.entities.Client.update(id, c).catch(() => {});
  }
}, [id]);
```

A new client persists **only** via the small top-bar **Create** button (`:129-135`). In an app that
otherwise auto-saves with no buttons, a user who fills the form and taps a bottom-nav item loses
everything. (Event/Invoice share the "button for new" pattern, but for clients — often added quickly —
this is where it bites, and it compounds issue #1.)

### 3. Failures are swallowed silently — a transient error looks like "didn't save"  ★ contributing

**Evidence:** `ClientDetail.jsx:62-65`, and the unmount flush `.catch(() => {})` at `:74`.

```js
} catch (err) {
  console.error("Client auto-save error:", err);
  setSavingState("idle");   // indicator just disappears
}
```

On any failure (e.g. the known iOS-PWA `getSessionSafe()` timeout → `requireSupabase()` throws
"Authentication required", `src/lib/supabaseClient.js:55-64` + `src/api/localStorageEngine.js:85-98`),
the user sees a one-frame "Saving…" then nothing — no error, no retry, no "unsaved" marker. Indistinguishable
from "it didn't save." The flush's `.catch(() => {})` discards the last write entirely.

### 4. Field-name mismatch: `has_late_payment_history` (UI) vs `late_payment_flag` (DB column)  ☆ latent

**Evidence:** state/UI use `has_late_payment_history` (`:27`, `:155`, `:342-345`, also `Clients.jsx:118`);
the real column is `late_payment_flag` (`entityMetadata.js:124`, migration `:114`).

Because `has_late_payment_history` is not a known column, it round-trips through the `payload` JSONB, so
the toggle *appears* to persist — but the dedicated `late_payment_flag` column is never written and stays
`false`. Not the cause of the main symptom, but a real data bug to fix while here (any query/report keying
on `late_payment_flag` is wrong).

### 5. Core direct-bound fields (name/city/notes/type/fee/currency/terms) — appears correct

These bind directly via `onChange` (`:78`) → auto-save effect. No fault found by inspection; should be
verified empirically (see checklist). If issues #1-#3 are fixed, these are covered.

---

## Fix plan

Keep the established "Create button for new, auto-save for existing" model (consistent with Event/Invoice),
but close the data-loss traps and make failures visible. All changes are in
`src/pages/ClientDetail.jsx` unless noted.

### Fix A — eliminate the email/phone trap (addresses #1)  ★ required

Make a pending `newEmail`/`newPhone` value impossible to lose. Implement **all** of:

1. **Commit on blur.** Add `onBlur={addEmail}` to the email input (`:265-271`) and `onBlur={addPhone}`
   to the phone input (`:288-294`). `addEmail`/`addPhone` already no-op on empty, so this is safe.
2. **Commit pending values before any persist.** Introduce a helper that folds pending input into the
   record, and call it at the top of `handleSave` (create) and inside the unmount flush:

   ```js
   // returns a client object with any typed-but-unadded email/phone merged in
   const withPending = (c) => ({
     ...c,
     emails: newEmail.trim() ? [...(c.emails || []), newEmail.trim()] : (c.emails || []),
     phones: newPhone.trim() ? [...(c.phones || []), newPhone.trim()] : (c.phones || []),
   });
   ```
   Use `withPending(client)` in `handleSave`'s `create`, and `withPending(clientRef.current)` in the
   flush. (For the existing-client debounced effect, the `onBlur` from step 1 already commits the value
   into `client`, which triggers the effect — so the effect itself needs no change.)
3. Keep Enter-to-add. Optional polish: also accept comma/space as a separator.

> Net effect: typing a phone/email and navigating away (or tapping Create) now always saves it.

### Fix B — never lose a new client (addresses #2)  ★ required

Give new clients a flush-on-unmount that **creates** when a name was entered. Two viable shapes — pick one:

- **B1 (recommended, lowest risk):** extend the existing flush effect to handle the no-id case by creating.
  Guard against double-create with a ref (the create may race with the user tapping **Create**).

  ```js
  const createdOnceRef = useRef(false);
  useEffect(() => () => {
    const c = withPending(clientRef.current);
    if (!c?.name?.trim()) return;
    if (id) {
      if (JSON.stringify(c) !== lastSavedJsonRef.current)
        appClient.entities.Client.update(id, c).catch(() => {});
    } else if (!createdOnceRef.current) {
      createdOnceRef.current = true;
      appClient.entities.Client.create(c).catch(() => {});   // fire-and-forget; no navigate on unmount
    }
  }, [id]);
  ```
  Also set `createdOnceRef.current = true` inside `handleSave` so an explicit Create + an unmount flush
  can't both create. (Note `id`/`lastSavedJsonRef`/`clientRef` are captured per the effect's deps — keep
  the existing `[id]` dependency; read mutable values from refs.)

- **B2 (alternative — full auto, no button):** "create-on-first-edit." On the first edit of a new client
  (name non-empty), call `create`, then `navigate(createPageUrl(\`ClientDetail?id=\${created.id}\`),
  { replace: true })` and set `lastSavedJsonRef`. After that the existing-client effect takes over.
  Cleaner UX (matches "no save buttons anywhere") but a bigger change and diverges from Event/Invoice.
  Only do this if Avi confirms he wants the **Create** button gone for clients too.

**Recommendation:** B1. It is consistent with `WorkEventDetail`/`DocumentDetail` (which keep a Create button
for new records) and is the smallest safe change. Leave the visible **Create** button in place.

### Fix C — surface save failures (addresses #3)  ★ required

- Add a `"error"` (or `"unsaved"`) value to `savingState`. In the `catch`, set it and render a small
  red "Couldn't save — retry" affordance next to the hero status (`:145-148`), instead of silently going idle.
- In the unmount flush, replace `.catch(() => {})` with `.catch(err => console.error("Client flush error:", err))`
  at minimum. Consider a `sessionStorage` "pending client write" breadcrumb so a failed flush can be retried
  on next mount (optional, nice-to-have).
- This turns "it silently didn't save" into a visible, recoverable state.

### Fix D — correct the late-payer field name (addresses #4)  ☆ recommended

Pick one and apply consistently across `ClientDetail.jsx` **and** `Clients.jsx:118`:
- **D1 (recommended):** rename UI usage `has_late_payment_history` → `late_payment_flag` everywhere
  (state default `:27`, hero `:155`, toggle `:342-345`, list `Clients.jsx:118`). Writes the real column.
- **D2:** add `late_payment_flag` to the entity column set and keep the UI name — more confusing; avoid.
- **Migration note:** existing clients toggled before this fix stored the value in `payload.has_late_payment_history`.
  Add a one-time read fallback (`client.late_payment_flag ?? client.has_late_payment_history`) when loading so
  no flags are visually lost, or a tiny backfill. Call this out to Avi; don't silently drop old data.

---

## Finalize the rest of the app (so "the whole auto-save" is consistent)

- **DocumentDetail line items** (`:85`, `:425-429`, inputs `:1467-1479`) have the **same** type-then-+ trap as
  Client emails/phones. Apply the Fix A treatment: `onBlur={addLineItem}` on the description/price inputs and a
  `withPending`-style merge before create/flush. Lower urgency (users tend to tap Add for line items), but it's
  the same class of bug — fix for consistency.
- **WorkEventDetail** is the reference implementation (`onChange`→`scheduleSave`, ref-based `persist`,
  flush-on-unmount, `handleCreate` for new). No change needed; mirror its robustness in Client.
- **No change** to `EquipmentDetail`, `ChartDetail`, `Practice` — these intentionally keep explicit Save
  buttons (modal/form style) and are out of scope.

---

## Acceptance checklist (verify in the real app, signed in / cloud mode)

New client:
- [ ] Fill name + type an email + type a phone, then tap **Create** (without tapping +). Reopen the client →
      email and phone are present.
- [ ] Fill name + email + phone, then tap the **Clients** bottom-nav (no Create) → client is saved with all fields.
- [ ] Fill nothing meaningful (no name) and leave → no empty client is created.

Existing client:
- [ ] Edit name → "Saved" shows; reopen → persisted.
- [ ] Type a new phone/email and immediately leave the field (blur) → it is added and saved.
- [ ] Type a new phone/email and navigate away without tapping + → it is saved.
- [ ] Toggle "Late Payment History" → reopen → still on; DB `late_payment_flag` column is `true` (Fix D).
- [ ] Edit city / notes / default fee / currency / payment terms → each persists.

Failure visibility:
- [ ] Simulate a failed write (e.g. offline) → a visible "couldn't save / retry" state appears, not a silent idle.

No regressions:
- [ ] Invoice and Event auto-save still work as before.
- [ ] No double-created clients when tapping **Create** then navigating.

---

## Files in scope

- `src/pages/ClientDetail.jsx` — Fixes A, B, C, D (primary)
- `src/pages/Clients.jsx` — Fix D (line 118 field rename)
- `src/pages/DocumentDetail.jsx` — app-wide consistency (line-item trap), optional
- Reference only (do not change): `src/pages/WorkEventDetail.jsx`, `src/api/localStorageEngine.js`,
  `src/api/entityMetadata.js`, `src/api/appClient.js`

## Out of scope / notes

- Don't change the data layer; Client writes are correct there.
- Keep the dual-mode (Supabase cloud / localStorage preview) behavior intact — all changes are UI-level.
- The existing-client debounced effect (`:51-68`) can stay as-is once the +-trap is closed; do not rewrite it
  to the WorkEvent `scheduleSave` style unless you also keep behavior identical (no need).
