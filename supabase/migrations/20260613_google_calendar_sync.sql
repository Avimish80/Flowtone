-- Google Calendar two-way sync (Phase 1)
-- Per-user Google OAuth + sync state. Tokens are SERVICE-ROLE ONLY — the browser
-- must never read them, so RLS grants no client access at all (no policies created).

create table if not exists public.google_calendar_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null default '',
  access_token text not null default '',
  token_expires_at timestamptz,
  connected_email text not null default '',
  calendar_id text not null default '',      -- the dedicated "Flowtone Gigs" calendar
  sync_token text not null default '',        -- Google incremental events.list token
  sync_enabled boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS but create NO policies: with RLS on and no policy, the anon/auth
-- client is denied every row. Only the service-role key (which bypasses RLS)
-- can read or write — exactly what the server-side sync engine uses.
alter table public.google_calendar_credentials enable row level security;

drop trigger if exists touch_google_calendar_credentials_updated_at on public.google_calendar_credentials;
create trigger touch_google_calendar_credentials_updated_at before update on public.google_calendar_credentials
for each row execute procedure public.touch_updated_at();
