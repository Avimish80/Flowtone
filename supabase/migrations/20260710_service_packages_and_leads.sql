-- Leads feature: service packages catalog + leads pipeline + public enquiry slug.
-- Prospects browse packages on a public enquiry page (/p/<slug>), submit an
-- enquiry that becomes a lead, and later view/accept a quote via /q/<token>.
-- Anonymous access never touches these tables directly — it goes through the
-- Express server's service-role client (server/routes/public.js).

-- Service packages: the musician's offer catalog (e.g. "DJ solo", "DJ + sax").
create table if not exists public.service_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null default '',
  description text not null default '',
  price numeric,
  currency text not null default 'GBP',
  photo_url text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,

  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_packages_user_active
  on public.service_packages (user_id, active, sort_order);

select public.apply_standard_rls('service_packages');

drop trigger if exists touch_service_packages_updated_at on public.service_packages;
create trigger touch_service_packages_updated_at
  before update on public.service_packages
  for each row execute procedure public.touch_updated_at();

-- Leads: enquiries from prospects, tracked through a pipeline until they
-- become (or fail to become) a booked event.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  contact_name text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',

  event_date date,
  event_type text not null default '',
  location text not null default '',
  message text not null default '',

  package_id uuid references public.service_packages(id) on delete set null,

  status text not null default 'new'
    check (status in ('new', 'contacted', 'quoted', 'accepted', 'declined', 'lost')),

  document_id uuid,
  client_id uuid,
  work_event_id uuid,

  -- Unguessable token powering the public quote page (/q/<token>).
  public_token text not null unique default encode(gen_random_bytes(24), 'hex'),

  source text not null default 'enquiry_page',
  quote_sent_at timestamptz,
  accepted_at timestamptz,
  last_activity_at timestamptz not null default now(),

  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_user_status
  on public.leads (user_id, status);
create index if not exists leads_public_token
  on public.leads (public_token);

select public.apply_standard_rls('leads');

drop trigger if exists touch_leads_updated_at on public.leads;
create trigger touch_leads_updated_at
  before update on public.leads
  for each row execute procedure public.touch_updated_at();

-- Public enquiry page identity lives on the business profile (1:1 per user).
alter table public.business_profiles
  add column if not exists public_slug text,
  add column if not exists enquiry_headline text not null default '',
  add column if not exists enquiry_intro text not null default '';

create unique index if not exists business_profiles_public_slug_uniq
  on public.business_profiles (public_slug)
  where public_slug is not null;
