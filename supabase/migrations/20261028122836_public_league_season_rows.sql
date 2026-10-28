-- Live league table for Top 100 Stats & History (archive.smtop100.blog).
--
-- The archive's history lives in the "Top 100 All Teams Position History"
-- Google Sheet, which used to be updated by pasting league tables in at the
-- end of each season. This returns the current season in the same shape
-- (one row per club) from the latest reviewed Soccer Manager Sync, so the
-- archive can show the season as it happens and the sheet only needs the
-- final table once the season is over.
--
-- squad_strength uses the archive's ETOT weighting (src/analytics/etotUtils.js)
-- on the club's current squad: best goalkeeper, best four defenders, best four
-- midfielders (DM/M/AM), best two forwards, top-18 average. predicted_position
-- ranks it within the division. It is the current squad, not the squad at the
-- start of the season, so read value added (predicted - actual) with that in mind.

-- Function bodies read Soccer Manager Sync tables that Manager Lab's migrations create,
-- so they are not checked here (as in the baseline).
SET check_function_bodies = false;

create or replace function public.public_league_season_rows(p_world_slug text default 'top-100')
returns table (
  season integer,
  division integer,
  "position" integer,
  team text,
  played integer,
  won integer,
  drawn integer,
  lost integer,
  goals_for integer,
  goals_against integer,
  goal_difference integer,
  points integer,
  manager text,
  squad_strength numeric,
  predicted_position integer,
  observed_at timestamptz,
  season_complete boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with world as (
    select id, external_world_id from public.game_worlds where slug = p_world_slug and is_active
  ),
  season_number as (
    -- The seasons table is the administrators' record; Soccer Manager's own
    -- season counter (learned from player club histories) can only move it on by one.
    select greatest(
      coalesce((select max(s.number) from public.seasons s where s.code ~ '^S[0-9]+$'), 0),
      least(
        coalesce((select max(h.current_season_num) from public.soccer_manager_player_club_history h, world where h.game_world_id = world.id), 0),
        coalesce((select max(s.number) from public.seasons s where s.code ~ '^S[0-9]+$'), 0) + 1
      )
    ) as value
  ),
  squad as (
    select crosswalk.game_world_club_id, player.rating,
      case
        when player.main_position_id = 1 then 'gk'
        when player.main_position_id in (2, 4, 8) then 'def'
        when player.main_position_id in (16, 32, 64, 128, 256, 512, 1024, 2048, 4096) then 'mid'
        else 'att'
      end as unit
    from public.soccer_manager_players player
    cross join world
    join public.soccer_manager_club_crosswalk crosswalk
      on crosswalk.source_world_id = world.external_world_id
     and crosswalk.source_club_id = player.current_source_club_id
    where player.game_world_id = world.id and player.current_team_id is not null and player.rating is not null
  ),
  ranked as (
    select squad.*,
      row_number() over (partition by game_world_club_id, unit order by rating desc) as unit_rank,
      row_number() over (partition by game_world_club_id order by rating desc) as squad_rank
    from squad
  ),
  strength as (
    select game_world_club_id,
      round(
        max(rating) filter (where unit = 'gk' and unit_rank = 1) * 0.12
        + avg(rating) filter (where unit = 'def' and unit_rank <= 4) * 0.8
        + avg(rating) filter (where unit = 'mid' and unit_rank <= 4) * 0.8
        + avg(rating) filter (where unit = 'att' and unit_rank <= 2) * 0.65
        + avg(rating) filter (where squad_rank <= 18) * 0.12,
        2) as value
    from ranked
    group by game_world_club_id
  ),
  standings as (
    select standing.*, strength.value as squad_strength
    from public.league_standings_current_by_club standing
    cross join world
    left join strength on strength.game_world_club_id = standing.game_world_club_id
    where standing.game_world_id = world.id and standing.position is not null
  )
  select season_number.value,
    standings.division,
    standings.position,
    standings.club_name,
    standings.played, standings.won, standings.drawn, standings.lost,
    standings.goals_for, standings.goals_against, standings.goal_difference, standings.points,
    coalesce(manager.display_name, manager.name, assignment.source_manager_name),
    standings.squad_strength,
    (rank() over (partition by standings.division order by standings.squad_strength desc nulls last))::integer,
    standings.world_observed_at,
    -- 20-club divisions play 38 league matches.
    bool_and(standings.played >= 38) over ()
  from standings
  cross join world
  cross join season_number
  left join public.soccer_manager_club_crosswalk crosswalk
    on crosswalk.game_world_club_id = standings.game_world_club_id
  left join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = world.id and assignment.team_id = crosswalk.team_id
  left join public.managers manager on manager.id = assignment.manager_id
  order by standings.division, standings.position;
$$;

revoke all on function public.public_league_season_rows(text) from public;
grant execute on function public.public_league_season_rows(text) to anon, authenticated, service_role;

RESET check_function_bodies;
