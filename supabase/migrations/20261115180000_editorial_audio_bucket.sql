-- Audio episodes for the Publishing Desk (write.smtop100.blog).
--
-- Managers upload an MP3 or M4A straight from the browser into their own folder
-- (editorial-audio/<auth uid>/<draft id>/<file>), so large files don't pass through a Netlify
-- function. The bucket is public-read under unguessable paths: the editors need to listen before
-- publishing, and the publish step copies the file into Micro.blog's media library, which puts
-- the post in the blog's podcast feed. Files can't be replaced or deleted by managers.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('editorial-audio', 'editorial-audio', true, 52428800, array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/m4a'])
on conflict (id) do update
  set public = true,
      file_size_limit = 52428800,
      allowed_mime_types = array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/m4a'];

drop policy if exists "Managers upload editorial audio" on storage.objects;
create policy "Managers upload editorial audio" on storage.objects for insert to authenticated
with check (
  bucket_id = 'editorial-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
  and array_length(storage.foldername(name), 1) = 2
  and lower(storage.extension(name)) in ('mp3', 'm4a')
  and exists (
    select 1 from public.manager_portal_accounts account
    where account.auth_user_id = auth.uid() and account.active
  )
);
