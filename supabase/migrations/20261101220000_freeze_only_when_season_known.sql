-- Follow-up to 20261101210000: only save a live table as a season's final table
-- when the game's own season counter (player club histories) names that season.
-- Without it, world_current_season_num() falls back to "last completed + 1",
-- which between the last match and the new season names the next season, and the
-- finished table would be saved under the wrong number (and then hide that
-- season's real live table). Sync's Game World History read saves finished
-- seasons anyway, so skipping an uncertain freeze loses nothing.

create or replace function public.freeze_completed_league_season(p_world_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_season integer;
  v_game_season integer;
  v_saved integer := 0;
begin
  select slug into v_slug from public.game_worlds where id = p_world_id and is_active;
  if v_slug is null then
    return 0;
  end if;

  select max(h.current_season_num) into v_game_season
  from public.soccer_manager_player_club_history h
  where h.game_world_id = p_world_id;

  select live.season into v_season
  from public.public_league_season_rows(v_slug) live
  group by live.season
  having bool_and(live.season_complete) and count(*) >= 20
  limit 1;

  if v_season is null or v_season < 1 or v_game_season is distinct from v_season then
    return 0;
  end if;
  if exists (select 1 from public.soccer_manager_league_season_tables t where t.game_world_id = p_world_id and t.season_num = v_season) then
    return 0;
  end if;

  insert into public.soccer_manager_league_season_tables
    (game_world_id, season_num, division, position, team, played, won, drawn, lost, goals_for, goals_against, goal_difference, points, manager)
  select p_world_id, live.season, live.division, live.position, live.team, live.played, live.won, live.drawn, live.lost,
         live.goals_for, live.goals_against, live.goal_difference, live.points, live.manager
  from public.public_league_season_rows(v_slug) live
  where live.division is not null and live.position is not null and live.team is not null
  on conflict do nothing;

  get diagnostics v_saved = row_count;
  return v_saved;
end;
$$;

revoke all on function public.freeze_completed_league_season(bigint) from public, anon, authenticated;
grant execute on function public.freeze_completed_league_season(bigint) to service_role;
