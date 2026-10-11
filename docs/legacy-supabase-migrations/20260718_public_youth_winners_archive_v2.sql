-- Fix the public Youth winners RPC for PostgreSQL installations where
-- POSITION is parsed as syntax inside a RETURNS TABLE definition.
--
-- This migration is safe whether or not the original function was created.

drop function if exists public.get_public_youth_winners();

create function public.get_public_youth_winners()
returns table (
  id bigint,
  honour text,
  honour_position integer,
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
    h.position as honour_position,
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
