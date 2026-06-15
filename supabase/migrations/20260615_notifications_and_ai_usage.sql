-- Notification center + app-icon badge (Phase 1)
-- Each row is a discrete attention item surfaced to the user.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,          -- 'gig_added' | 'email_received' | 'calendar_change' | 'ai_problem'
  title text not null,
  body text not null default '',
  entity_type text not null default '',   -- 'event' | 'invoice' | 'email' | ''
  entity_id uuid,                          -- nullable deep-link target
  url text not null default '',            -- in-app deep link, e.g. '/WorkEventDetail?id=...'
  read_at timestamptz,                     -- null = unread (drives the badge)
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread on public.notifications (user_id, read_at);

alter table public.notifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'notifications' and policyname = 'notifications_user_owns'
  ) then
    create policy notifications_user_owns on public.notifications
      for all using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- AI usage logging
-- One row per AI assistant turn. No PII beyond user_id.

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  channel text not null default 'in_app',   -- 'in_app' | 'whatsapp'
  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_user_created on public.ai_usage_events (user_id, created_at);

-- RLS on: service-role writes from the server; no client reads needed yet.
alter table public.ai_usage_events enable row level security;
