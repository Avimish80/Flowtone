-- Ticket fields for action items: per-task user directive + decision label.
-- These turn an action item into a persistent "ticket" the AI manages.
--
-- user_directive: the user's latest free-text instruction to this ticket
--   ("remind me after the gig", "send as-is"). Empty until the user replies.
-- decision: lifecycle label — '' | 'deferred' | 'skipped' | 'done'.
--   'skipped'  pairs with status='dismissed' (durable; never re-raised, but kept
--              and queryable so the user can ask "what did I ignore?").
--   'deferred' pairs with a future snoozed_until.
--
-- Note: snoozed_until (added in 20260621_action_items_snooze.sql) is reused as the
-- AI-internal follow-up date. It is set by the AI from natural language and is
-- never shown to the user.

alter table public.action_items
  add column if not exists user_directive text not null default '';

alter table public.action_items
  add column if not exists decision text not null default '';
