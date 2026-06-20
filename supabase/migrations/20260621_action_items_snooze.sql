-- Add snooze support to action items.
-- snoozed_until: when set and in the future, the item is hidden but returns
-- once the snooze expires (soft dismiss). Permanent dismiss uses status='dismissed'.

alter table public.action_items
  add column if not exists snoozed_until timestamptz;
