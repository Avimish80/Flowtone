-- iCloud Mail connection (IMAP/SMTP with an Apple app-specific password).
-- Credentials live ONLY on the server: RLS is enabled with no policies, so the
-- anon/authenticated client is denied every row and only the service-role key
-- (the Express server) can read or write, the same pattern as
-- google_calendar_credentials. The password is stored encrypted
-- (AES-256-GCM, server/lib/mailCrypto.js), never in clear.
create table if not exists public.mail_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'icloud',
  email text not null default '',             -- the From address clients see
  login text not null default '',             -- IMAP user name (usually the same address)
  secret_ciphertext text not null default '',
  imap_host text not null default 'imap.mail.me.com',
  imap_port integer not null default 993,
  smtp_host text not null default 'smtp.mail.me.com',
  smtp_port integer not null default 587,
  sync_enabled boolean not null default true,
  uid_validity bigint,                        -- INBOX UIDVALIDITY seen by the last sync
  last_uid bigint not null default 0,         -- highest INBOX UID imported so far
  last_synced_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mail_accounts enable row level security;

drop trigger if exists touch_mail_accounts_updated_at on public.mail_accounts;
create trigger touch_mail_accounts_updated_at before update on public.mail_accounts
for each row execute procedure public.touch_updated_at();

-- Imported messages are keyed by their Message-ID so a re-sync never duplicates
-- a message or resets its Flowtone status (the sync inserts with ON CONFLICT DO
-- NOTHING). Rows written before this column existed keep NULL, which a unique
-- index allows any number of times.
alter table public.email_messages add column if not exists message_id text;
create unique index if not exists email_messages_user_message_id_uniq
  on public.email_messages (user_id, message_id);
create index if not exists email_messages_user_date_idx
  on public.email_messages (user_id, date desc);
