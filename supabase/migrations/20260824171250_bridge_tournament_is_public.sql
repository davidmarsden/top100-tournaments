-- Bridge migration (finding F6, docs/supabase-baseline-reconstruction-2026-10-11.md).
--
-- Applied migration 20260824171251 (17:12 UTC) revokes EXECUTE on public.tournament_is_public(bigint),
-- but the migration that defines it, 20260824174302, ran 31 minutes later. In production the function
-- was created outside migration history in between. This file recreates that step so a fresh database
-- (Supabase Preview) can replay the history in order. The definition is copied from 20260824174302,
-- which restates it with CREATE OR REPLACE, so the end state is unchanged.
--
-- PRODUCTION SAFETY: record as APPLIED in production before merge; never execute there:
--   supabase migration repair --status applied 20260824171250
create or replace function public.tournament_is_public(tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.tournaments t
    where t.id = tournament_id
      and t.is_public = true
      and t.status in ('groups_approved', 'published', 'completed', 'archived')
  );
$$;

revoke all on function public.tournament_is_public(bigint) from public;
grant execute on function public.tournament_is_public(bigint) to anon, authenticated, service_role;
