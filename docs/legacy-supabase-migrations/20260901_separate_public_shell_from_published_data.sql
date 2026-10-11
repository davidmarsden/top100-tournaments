-- Keep the tournament shell discoverable whenever an organiser explicitly marks it public,
-- while retaining the stricter publication boundary for groups, entries, matches,
-- round dates, honours, forfeits and match comments.

create or replace function public.tournament_is_public(tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tournaments t
    where t.id = tournament_id
      and t.is_public = true
      and t.status in ('groups_approved', 'published', 'completed', 'archived')
  );
$$;

create or replace function public.tournament_shell_is_public(tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tournaments t
    where t.id = tournament_id
      and t.is_public = true
  );
$$;

revoke all on function public.tournament_shell_is_public(bigint) from public;
grant execute on function public.tournament_shell_is_public(bigint) to anon, authenticated;

-- Only the tournament-row policies use the broader shell predicate.
-- Child-table policies continue calling tournament_is_public(), which remains
-- restricted to genuinely published/approved competition data.
drop policy if exists "Anonymous read public tournaments" on public.tournaments;
create policy "Anonymous read public tournaments"
on public.tournaments
for select
to anon
using (public.tournament_shell_is_public(id));

drop policy if exists "Authenticated read public tournaments and assigned staff" on public.tournaments;
create policy "Authenticated read public tournaments and assigned staff"
on public.tournaments
for select
to authenticated
using (
  (select public.tournament_shell_is_public(tournaments.id))
  or (select public.can_assist_tournament(tournaments.id))
);
