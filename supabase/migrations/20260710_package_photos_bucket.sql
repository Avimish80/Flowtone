-- Public storage bucket for service package photos.
-- Objects follow the path convention <user_id>/<uuid>.jpg so ownership can be
-- enforced from the first path segment.

insert into storage.buckets (id, name, public)
values ('package-photos', 'package-photos', true)
on conflict (id) do nothing;

drop policy if exists "package photos public read" on storage.objects;
create policy "package photos public read"
  on storage.objects for select
  using (bucket_id = 'package-photos');

drop policy if exists "package photos owner insert" on storage.objects;
create policy "package photos owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'package-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "package photos owner update" on storage.objects;
create policy "package photos owner update"
  on storage.objects for update
  using (
    bucket_id = 'package-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "package photos owner delete" on storage.objects;
create policy "package photos owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'package-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
