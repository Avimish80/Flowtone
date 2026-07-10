-- ─────────────────────────────────────────────────────────────────────────────
-- Pre-launch hardening #2: lock billing columns + enforce singletons.
--
-- 1. PROFILES COLUMN PRIVILEGES (security fix)
--    The RLS policy "profiles_update_own" lets a user update their own row —
--    but Supabase's default table grants let that update touch EVERY column,
--    including subscription_status / plan_name / trial_ends_at. Since the
--    server's access gate trusts profiles.subscription_status, any signed-in
--    user could PATCH themselves to 'active' and bypass billing entirely.
--    Fix: column-level grants. The client only ever writes id/email/full_name
--    (see ensureProfile in src/lib/AuthContext.jsx). Billing columns become
--    service-role-only (Stripe webhooks on the server).
--
-- 2. SINGLETON UNIQUES
--    app_settings and business_profiles are one-row-per-user tables, but
--    nothing enforced that. Duplicate rows make settings reads inconsistent
--    and break atomic invoice numbering. Dedup (keep newest updated_at),
--    then enforce with a unique index.
--
-- Safe to run on a populated production database.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Profiles: column-level write privileges ───────────────────────────────

revoke insert, update, delete on public.profiles from anon, authenticated;

-- Client may create its own profile row and keep name/email fresh — nothing else.
-- (id stays grantable for upsert's ON CONFLICT SET; RLS "with check" still
-- prevents changing it to another user's id.)
grant insert (id, email, full_name) on public.profiles to authenticated;
grant update (id, email, full_name) on public.profiles to authenticated;

-- ── 2. One settings row / business profile per user ──────────────────────────

-- Dedup first: keep each user's most recently updated row.
delete from public.app_settings a
using public.app_settings b
where a.user_id = b.user_id
  and a.id <> b.id
  and (a.updated_at, a.id) < (b.updated_at, b.id);

create unique index if not exists app_settings_user_uniq
  on public.app_settings (user_id);

delete from public.business_profiles a
using public.business_profiles b
where a.user_id = b.user_id
  and a.id <> b.id
  and (a.updated_at, a.id) < (b.updated_at, b.id);

create unique index if not exists business_profiles_user_uniq
  on public.business_profiles (user_id);
