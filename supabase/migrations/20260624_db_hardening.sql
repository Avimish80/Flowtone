-- ─────────────────────────────────────────────────────────────────────────────
-- DB hardening for long-term (5-6 year) durability.
--
-- This migration is intentionally SAFE TO RUN ON A POPULATED PRODUCTION DATABASE:
--   • Foreign keys are added as NOT VALID — they enforce on all NEW/updated rows
--     immediately but do NOT re-validate existing rows, so the migration can
--     never fail on legacy/orphaned data. Validate them later (see bottom) once
--     you've confirmed the data is clean.
--   • All indexes use IF NOT EXISTS.
--   • Columns use ADD COLUMN IF NOT EXISTS.
--   • The unique invoice-number constraint is left commented out (it CAN fail if
--     pre-existing duplicates exist) — enable it after the dedup check at the end.
--
-- Nothing here rewrites or deletes existing data.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Referential integrity (NOT VALID — safe on existing data) ──────────────
-- Detach rather than vanish: deleting a client/event leaves its documents intact
-- with the link cleared. Payments and activity logs belong to their document, so
-- they cascade.

alter table public.work_events
  add constraint work_events_client_id_fk
  foreign key (client_id) references public.clients(id) on delete set null not valid;

alter table public.documents
  add constraint documents_client_id_fk
  foreign key (client_id) references public.clients(id) on delete set null not valid;

alter table public.documents
  add constraint documents_work_event_id_fk
  foreign key (work_event_id) references public.work_events(id) on delete set null not valid;

alter table public.documents
  add constraint documents_converted_from_id_fk
  foreign key (converted_from_id) references public.documents(id) on delete set null not valid;

alter table public.payments
  add constraint payments_document_id_fk
  foreign key (document_id) references public.documents(id) on delete cascade not valid;

alter table public.document_activity_logs
  add constraint document_activity_logs_document_id_fk
  foreign key (document_id) references public.documents(id) on delete cascade not valid;

-- ── 2. Indexes for the queries that grow with the dataset ─────────────────────
-- Without these, every "show overdue / by status / by client" filter is a full
-- table scan — fine at 50 invoices, slow at thousands.

create index if not exists documents_user_status_idx       on public.documents (user_id, status);
create index if not exists documents_user_due_date_idx      on public.documents (user_id, due_date);
create index if not exists documents_user_created_at_idx    on public.documents (user_id, created_at);
create index if not exists documents_client_id_idx          on public.documents (client_id);
create index if not exists documents_work_event_id_idx      on public.documents (work_event_id);
create index if not exists payments_document_id_idx         on public.payments (document_id);
create index if not exists activity_logs_document_id_idx    on public.document_activity_logs (document_id);
create index if not exists work_events_user_status_idx      on public.work_events (user_id, status);
create index if not exists work_events_user_date_idx        on public.work_events (user_id, date);

-- ── 3. Soft-delete marker ─────────────────────────────────────────────────────
-- Adds the column so nothing financial is ever truly lost. The app still hard-
-- deletes today; switching reads to "where deleted_at is null" is a follow-up.

alter table public.documents   add column if not exists deleted_at timestamptz;
alter table public.work_events add column if not exists deleted_at timestamptz;
alter table public.payments    add column if not exists deleted_at timestamptz;
alter table public.clients     add column if not exists deleted_at timestamptz;

-- ── 4. Atomic invoice/estimate numbering ──────────────────────────────────────
-- Replaces the app's read-then-write counter (which can hand the same number to
-- two documents created at the same moment) with a single locked increment in
-- the database. Returns the number just consumed, e.g. 'INV-0042'.
-- SECURITY DEFINER + auth.uid() so it only ever touches the caller's own row.

create or replace function public.next_document_number(p_document_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_prefix text;
  v_next   integer;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if p_document_type = 'invoice' then
    update public.app_settings
      set invoice_number_next = coalesce(invoice_number_next, 1) + 1
      where user_id = v_user
      returning invoice_number_prefix, coalesce(invoice_number_next, 1) - 1
      into v_prefix, v_next;
    v_prefix := coalesce(nullif(v_prefix, ''), 'INV-');
  else
    update public.app_settings
      set estimate_number_next = coalesce(estimate_number_next, 1) + 1
      where user_id = v_user
      returning estimate_number_prefix, coalesce(estimate_number_next, 1) - 1
      into v_prefix, v_next;
    v_prefix := coalesce(nullif(v_prefix, ''), 'EST-');
  end if;

  -- No settings row yet (the app normally creates it first). Signal the caller
  -- to fall back to its own counter rather than returning a wrong number.
  if v_next is null then
    raise exception 'no app_settings row for user';
  end if;

  return v_prefix || lpad(v_next::text, 4, '0');
end;
$$;

grant execute on function public.next_document_number(text) to authenticated;

-- ── 5. OPTIONAL: enforce unique document numbers per user ─────────────────────
-- The atomic function above already prevents NEW duplicates. This index is the
-- belt-and-suspenders guarantee. It is left commented out because it WILL FAIL
-- if your existing data already contains duplicate numbers. First run the check:
--
--   select user_id, document_number, count(*)
--   from public.documents
--   where document_number <> ''
--   group by user_id, document_number
--   having count(*) > 1;
--
-- If that returns no rows, enable the constraint:
--
--   create unique index if not exists documents_user_number_uniq
--     on public.documents (user_id, document_number)
--     where document_number <> '';
--
-- ── Later, once data is confirmed clean, validate the FKs added above: ─────────
--   alter table public.work_events            validate constraint work_events_client_id_fk;
--   alter table public.documents              validate constraint documents_client_id_fk;
--   alter table public.documents              validate constraint documents_work_event_id_fk;
--   alter table public.documents              validate constraint documents_converted_from_id_fk;
--   alter table public.payments               validate constraint payments_document_id_fk;
--   alter table public.document_activity_logs validate constraint document_activity_logs_document_id_fk;
