-- Restore a reliable public connection to the locally stored honours archive.
--
-- The public tournament page previously queried honours and several related
-- tables directly. Anonymous RLS or a broken nested relationship could make
-- that query return no rows, which looked like the archive had disappeared.
-- This security-definer function exposes only the small set of fields needed
-- to display historic Youth Cup and Shield winners.

create or replace function public.get_public_youth_winners()
returns table (
  id bigint,
  honour text,
  position integer,
  tournament_id bigint,
  tournament_name text,
  season_number integer,
  team_name text,
  manager_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    h.id,
    h.honour,
    h.position,
    h.tournament_id,
    t.name as tournament_name,
    coalesce(t.season_number, 0) as season_number,
    tm.name as team_name,
    coalesce(m.display_name, m.name) as manager_name
  from public.honours h
  join public.tournaments t on t.id = h.tournament_id
  left join public.tournament_entries te on te.id = h.entry_id
  left join public.teams tm on tm.id = te.team_id
  left join public.managers m on m.id = te.manager_id
  where lower(coalesce(h.honour, '')) like '%winner%'
    and (
      lower(coalesce(t.name, '')) like '%youth%'
      or lower(coalesce(h.honour, '')) like '%youth cup%'
      or lower(coalesce(h.honour, '')) like '%youth shield%'
      or lower(coalesce(h.honour, '')) like '%shield winner%'
      or lower(coalesce(h.honour, '')) like '%cup winner%'
    )
  order by coalesce(t.season_number, 0) desc, h.id desc;
$$;

revoke all on function public.get_public_youth_winners() from public;
grant execute on function public.get_public_youth_winners() to anon, authenticated;
