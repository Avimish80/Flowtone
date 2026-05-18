create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_flowtone_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do update
  set email = excluded.email;
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  subscription_status text not null default 'trialing',
  plan_name text,
  trial_ends_at timestamptz default (now() + interval '14 days'),
  billing_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists on_auth_user_created_flowtone on auth.users;
create trigger on_auth_user_created_flowtone
after insert on auth.users
for each row execute procedure public.handle_new_flowtone_user();

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  currency text default 'GBP',
  default_currency text default 'GBP',
  default_nav_app text default 'google_maps',
  default_payment_terms_days integer default 30,
  default_tax_rate numeric default 0,
  email_auto_action text default 'suggest_only',
  estimate_number_next integer default 1,
  estimate_number_prefix text default 'EST-',
  gmail_connected boolean default false,
  invoice_number_next integer default 1,
  invoice_number_prefix text default 'INV-',
  invoice_template integer default 1,
  notification_level text default 'standard',
  reminder_channel text default 'in_app',
  tax_rate numeric default 0,
  tax_year_start_month integer default 4,
  notification_prefs jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  business_name text default '',
  contact_name text default '',
  email text default '',
  phone text default '',
  address text default '',
  address_line_1 text default '',
  address_line_2 text default '',
  city text default '',
  postcode text default '',
  country text default 'GB',
  tax_id text default '',
  vat_number text default '',
  website text default '',
  logo text default '',
  logo_url text default '',
  bank_name text default '',
  bank_account_name text default '',
  bank_sort_code text default '',
  bank_account_number text default '',
  bank_iban text default '',
  payment_instructions text default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  client_type text default 'other',
  city text default '',
  default_currency text default 'GBP',
  default_fee numeric default 0,
  default_payment_terms_days integer default 30,
  billing_address text default '',
  notes text default '',
  late_payment_flag boolean default false,
  email_filter_tag text default '',
  emails jsonb not null default '[]'::jsonb,
  phones jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  event_type text default 'Gig',
  status text default 'lead',
  date date,
  time text default '',
  start_time text default '',
  end_time text default '',
  client_id uuid,
  location_address text default '',
  location_name text default '',
  base_price numeric default 0,
  total_price numeric default 0,
  currency text default 'GBP',
  notes text default '',
  is_recurring boolean default false,
  recurrence_id text default '',
  recurrence_index integer default 0,
  google_calendar_event_id text default '',
  base_price_locked boolean default false,
  duration_hours numeric default 0,
  linked_gig_id uuid,
  practice_plan text default '',
  practice_goal_id uuid,
  practice_logged boolean,
  practice_session_id uuid,
  practice_skipped boolean,
  adjustments jsonb not null default '[]'::jsonb,
  equipment_checklist jsonb not null default '[]'::jsonb,
  recurrence_rule jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  document_type text not null,
  document_number text default '',
  invoice_number text default '',
  title text default '',
  client_id uuid,
  client_email text default '',
  client_name text default '',
  work_event_id uuid,
  status text default 'draft',
  currency text default 'GBP',
  subtotal numeric default 0,
  discount_type text,
  discount_value numeric default 0,
  discount_amount numeric default 0,
  tax_rate numeric default 0,
  tax_amount numeric default 0,
  total numeric default 0,
  due_date date,
  valid_until date,
  paid_date date,
  paid_amount numeric default 0,
  payment_method text default '',
  notes text default '',
  is_locked boolean default false,
  locked_at timestamptz,
  unlocked_reason text default '',
  is_standalone boolean default false,
  converted_from_id uuid,
  sent_date timestamptz,
  payment_terms_days integer default 30,
  line_items jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  document_id uuid,
  action text not null,
  old_status text default '',
  new_status text default '',
  details jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  document_id uuid,
  amount numeric default 0,
  payment_date date,
  payment_method text default '',
  reference text default '',
  notes text default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.practice_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  description text default '',
  category text default '',
  completed boolean default false,
  completed_date date,
  target_date date,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  date date,
  duration_minutes integer default 0,
  notes text default '',
  session_notes text default '',
  goal_id uuid,
  work_event_id uuid,
  energy_rating integer default 3,
  linked_gig_id uuid,
  items jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  category text default '',
  condition text default '',
  serial_number text default '',
  notes text default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.charts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  chart_type text default 'chart',
  key text default '',
  tempo text default '',
  feel text default '',
  genre text default '',
  content text default '',
  file_url text default '',
  file_name text default '',
  file_type text default '',
  external_url text default '',
  notes text default '',
  linked_event_ids jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.setlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  notes text default '',
  items jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  subject text default '',
  from_name text default '',
  from_email text default '',
  status text default 'new',
  date timestamptz,
  snippet text default '',
  body text default '',
  thread_id text default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  date date,
  time text default '',
  status text default '',
  notes text default '',
  linked_entity_type text default '',
  linked_entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.apply_standard_rls(table_name text)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', table_name);
  execute format('drop policy if exists "%I_select_own" on public.%I', table_name, table_name);
  execute format('drop policy if exists "%I_insert_own" on public.%I', table_name, table_name);
  execute format('drop policy if exists "%I_update_own" on public.%I', table_name, table_name);
  execute format('drop policy if exists "%I_delete_own" on public.%I', table_name, table_name);
  execute format('create policy "%I_select_own" on public.%I for select using (auth.uid() = user_id)', table_name, table_name);
  execute format('create policy "%I_insert_own" on public.%I for insert with check (auth.uid() = user_id)', table_name, table_name);
  execute format('create policy "%I_update_own" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', table_name, table_name);
  execute format('create policy "%I_delete_own" on public.%I for delete using (auth.uid() = user_id)', table_name, table_name);
end;
$$;

select public.apply_standard_rls('app_settings');
select public.apply_standard_rls('business_profiles');
select public.apply_standard_rls('clients');
select public.apply_standard_rls('work_events');
select public.apply_standard_rls('documents');
select public.apply_standard_rls('document_activity_logs');
select public.apply_standard_rls('payments');
select public.apply_standard_rls('practice_goals');
select public.apply_standard_rls('practice_sessions');
select public.apply_standard_rls('equipment');
select public.apply_standard_rls('charts');
select public.apply_standard_rls('setlists');
select public.apply_standard_rls('email_messages');
select public.apply_standard_rls('reminders');

alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at before update on public.profiles
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_app_settings_updated_at on public.app_settings;
create trigger touch_app_settings_updated_at before update on public.app_settings
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_business_profiles_updated_at on public.business_profiles;
create trigger touch_business_profiles_updated_at before update on public.business_profiles
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_clients_updated_at on public.clients;
create trigger touch_clients_updated_at before update on public.clients
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_work_events_updated_at on public.work_events;
create trigger touch_work_events_updated_at before update on public.work_events
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_documents_updated_at on public.documents;
create trigger touch_documents_updated_at before update on public.documents
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_document_activity_logs_updated_at on public.document_activity_logs;
create trigger touch_document_activity_logs_updated_at before update on public.document_activity_logs
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_payments_updated_at on public.payments;
create trigger touch_payments_updated_at before update on public.payments
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_practice_goals_updated_at on public.practice_goals;
create trigger touch_practice_goals_updated_at before update on public.practice_goals
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_practice_sessions_updated_at on public.practice_sessions;
create trigger touch_practice_sessions_updated_at before update on public.practice_sessions
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_equipment_updated_at on public.equipment;
create trigger touch_equipment_updated_at before update on public.equipment
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_charts_updated_at on public.charts;
create trigger touch_charts_updated_at before update on public.charts
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_setlists_updated_at on public.setlists;
create trigger touch_setlists_updated_at before update on public.setlists
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_email_messages_updated_at on public.email_messages;
create trigger touch_email_messages_updated_at before update on public.email_messages
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_reminders_updated_at on public.reminders;
create trigger touch_reminders_updated_at before update on public.reminders
for each row execute procedure public.touch_updated_at();
