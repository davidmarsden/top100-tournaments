-- Squads over the limit, dated from the last read.
--
-- squad_cap_counts(): each count is dated from the last time Sync read the club's squad (its
-- players' squad_applied_at). Sync writes a squad row only when the count changes, so a squad that
-- has sat at 50 since September was dated September though it was read today.
-- public_squads_at_limit(): the Manager Portal list shows only clubs over the limit (more than 50);
-- the admin overview still lists every squad.

-- The Sync tables come from Manager Lab's migrations, so SQL function bodies are not checked here.
set check_function_bodies = false;

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
    -- The last time Sync read the squad, not only the last time the count changed (a squad row is
    -- written only when the count changes).
    greatest(latest.captured_at, (
      select max(player.squad_applied_at) from public.soccer_manager_players player
      where player.game_world_id = world.id and player.current_source_club_id = latest.club
    ))
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
  where counts.players > counts.squad_limit
  order by counts.players desc, counts.club_name;
$$;

revoke all on function public.public_squads_at_limit(text) from public, anon;
grant execute on function public.public_squads_at_limit(text) to authenticated;
