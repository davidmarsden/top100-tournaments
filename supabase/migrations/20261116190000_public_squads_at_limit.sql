-- Squads at or over the 50-player limit (rule 4.1), for every signed-in manager to see.
--
-- squad_cap_counts(world): each club's latest synced squad count (excluded players taken off) and
-- the date of that count. Private: the admin overview and the managers' list read it.
-- squad_cap_overview(): unchanged for the admin team (adds each club's open breaches).
-- public_squads_at_limit(): the clubs at or over the limit, without breach or review details, for
-- signed-in managers (the Manager Portal's Squad & Transfers page).

-- @permissions private public.squad_cap_counts(text): internal, read by squad_cap_overview() and public_squads_at_limit()
create or replace function public.squad_cap_counts(p_world_slug text default 'top-100')
returns table (
  source_world_id bigint,
  source_club_id text,
  club_name text,
  manager_name text,
  division integer,
  players integer,
  squad_limit integer,
  captured_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with world as (
    select id, external_world_id from public.game_worlds where slug = p_world_slug
  ),
  latest as (
    select distinct on (change.after_data->>'clubId')
      change.after_data->>'clubId' as club,
      (change.after_data->>'playerCount')::integer
        - (select count(*)::integer
           from jsonb_array_elements_text(coalesce(change.after_data->'rosterPlayerIds', '[]'::jsonb)) roster(player_id)
           join public.squad_cap_exclusions exclusion
             on exclusion.source_world_id = world.external_world_id
            and exclusion.source_club_id = change.after_data->>'clubId'
            and exclusion.source_player_id = roster.player_id
            and (exclusion.excluded_until is null or exclusion.excluded_until >= current_date)) as n,
      run.captured_at
    from public.soccer_manager_sync_changes change
    join public.soccer_manager_sync_runs run on run.id = change.run_id
    cross join world
    where change.entity_type = 'squad_scope' and change.status = 'approved'
      and change.after_data->>'setupId' = world.external_world_id::text
      and change.after_data->>'playerCount' ~ '^[0-9]+$'
    order by change.after_data->>'clubId', run.captured_at desc, change.id desc
  )
  select world.external_world_id::bigint, latest.club,
    coalesce(crosswalk.source_club_name, 'Club ' || latest.club),
    coalesce(manager.display_name, manager.name, assignment.source_manager_name),
    club.division,
    latest.n,
    50,
    latest.captured_at
  from latest
  cross join world
  left join public.soccer_manager_club_crosswalk crosswalk
    on crosswalk.source_world_id = world.external_world_id and crosswalk.source_club_id = latest.club
  left join public.game_world_clubs club on club.id = crosswalk.game_world_club_id
  left join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = world.id and assignment.team_id = crosswalk.team_id
  left join public.managers manager on manager.id = assignment.manager_id;
$$;

revoke all on function public.squad_cap_counts(text) from public, anon, authenticated;

create or replace function public.squad_cap_overview(p_world_slug text default 'top-100')
returns table (
  club_name text,
  manager_name text,
  division integer,
  players integer,
  squad_limit integer,
  captured_at timestamptz,
  open_breaches integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can view squad compliance.'; end if;

  return query
  select counts.club_name, counts.manager_name, counts.division, counts.players, counts.squad_limit, counts.captured_at,
    (select count(*)::integer from public.squad_cap_breaches breach
      where breach.source_world_id = counts.source_world_id and breach.source_club_id = counts.source_club_id
        and breach.status in ('open', 'upheld'))
  from public.squad_cap_counts(p_world_slug) counts
  order by counts.players desc, 1;
end;
$$;

create or replace function public.public_squads_at_limit(p_world_slug text default 'top-100')
returns table (
  club_name text,
  manager_name text,
  division integer,
  players integer,
  squad_limit integer,
  captured_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select counts.club_name, counts.manager_name, counts.division, counts.players, counts.squad_limit, counts.captured_at
  from public.squad_cap_counts(p_world_slug) counts
  where counts.players >= counts.squad_limit
  order by counts.players desc, counts.club_name;
$$;

revoke all on function public.public_squads_at_limit(text) from public, anon;
grant execute on function public.public_squads_at_limit(text) to authenticated;
