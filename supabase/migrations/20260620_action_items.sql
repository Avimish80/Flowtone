-- Persistent action items (missions) for the AI assistant.
-- Each row is a detected problem or opportunity that Flow surfaces
-- on the dashboard and tracks until resolved or dismissed.

create table if not exists public.action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  item_type text not null,           -- 'client_missing_email' | 'client_missing_phone' |
                                     -- 'gig_missing_location' | 'gig_missing_fee' |
                                     -- 'gig_ready_to_invoice' | 'invoice_overdue' |
                                     -- 'invoice_draft_stale' | 'invoice_ready_to_send'
  entity_type text not null,         -- 'client' | 'event' | 'invoice'
  entity_id uuid,                    -- FK to source record (nullable for safety)
  title text not null default '',    -- AI-generated natural language text
  priority integer not null default 0,  -- 0=normal, 1=high, 2=urgent
  status text not null default 'open',  -- 'open' | 'resolved' | 'dismissed'
  action_type text not null default '',  -- 'navigate' | 'create_invoice' | 'send_invoice' | 'add_field'
  action_target text not null default '', -- page URL or action identifier

  resolved_at timestamptz,
  resolved_by text not null default '',  -- 'auto' | 'user'
  dismissed_at timestamptz,

  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists action_items_user_status
  on public.action_items (user_id, status);

-- Only one open item per (user, type, entity) — prevents scanner from
-- creating duplicates on repeated runs.
create unique index if not exists action_items_dedup
  on public.action_items (user_id, item_type, entity_id)
  where status = 'open';

select public.apply_standard_rls('action_items');

drop trigger if exists touch_action_items_updated_at on public.action_items;
create trigger touch_action_items_updated_at
  before update on public.action_items
  for each row execute procedure public.touch_updated_at();
