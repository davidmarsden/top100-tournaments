-- Public tournament page: the clubs registered so far, with their rating, while
-- the tournament is a public shell (registration open, draw not yet published).
--
-- tournament_entries is only readable once the tournament is published
-- (tournament_is_public), so the page could not list entries during
-- registration. This returns just club, manager and rating: no seed, pot,
-- group or contact details, so nothing about the draw is given away early.

create or replace function public.public_registered_clubs(target_tournament_id bigint)
returns table (entry_id bigint, club_name text, manager_name text, rating numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id,
         coalesce(tm.name, 'TBC'),
         coalesce(nullif(trim(mg.display_name), ''), mg.name),
         e.rating
  from public.tournament_entries e
  join public.tournaments t on t.id = e.tournament_id and t.is_public = true
  left join public.teams tm on tm.id = e.team_id
  left join public.managers mg on mg.id = e.manager_id
  where e.tournament_id = target_tournament_id
    and coalesce(e.withdrawn, false) = false and coalesce(e.disqualified, false) = false
  order by e.rating desc nulls last, tm.name;
$$;

revoke all on function public.public_registered_clubs(bigint) from public;
grant execute on function public.public_registered_clubs(bigint) to anon, authenticated;
