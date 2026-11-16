-- Speed for 20261116160000: public_league_history_rows() timed out for the archive
-- (anon statement timeout). league_season_managers() worked out each season's dates once per
-- league game (3.7 s); its intermediate results are now materialized (0.16 s). The history
-- rows now join each season's managers, start date and end-of-season manager instead of looking
-- them up row by row, and read the live table only while the current season is not saved yet.
-- Same results and signatures.

create or replace function public.league_season_managers(p_world_id bigint)
returns table (season integer, season_start date, club text, managers text)
language sql
stable
security definer
set search_path = ''
as $$
  with current_season as (
    select public.world_current_season_num(p_world_id) as n
  ),
  seasons as materialized (
    select n.season,
      coalesce(saved.start_date, public.world_season_end(p_world_id, n.season) - 147) as starts_on,
      coalesce(saved.end_date, public.world_season_end(p_world_id, n.season)) as ends_on
    from current_season cross join generate_series(1, current_season.n) n(season)
    left join public.soccer_manager_world_seasons saved on saved.game_world_id = p_world_id and saved.season_num = n.season
  ),
  -- Each league game's date, read once.
  games as materialized (
    select (match.source_data->'fixture'->>'date')::date as played_on
    from public.soccer_manager_match_snapshots match
    where match.game_world_id = p_world_id and match.competition_code = 'league'
      and match.home_score is not null and match.away_score is not null
  ),
  last_game as (
    select seasons.season, max(games.played_on) as played_on
    from seasons
    join games on games.played_on between seasons.starts_on and seasons.ends_on
    group by seasons.season
  ),
  windows as materialized (
    select seasons.season, seasons.starts_on,
      case when current_date < seasons.ends_on then current_date + 1
           else coalesce(last_game.played_on + 1, seasons.ends_on - 5) end as before_date
    from seasons
    left join last_game on last_game.season = seasons.season
    where seasons.starts_on is not null
  ),
  linked as materialized (
    select distinct identity.sm_manager_id
    from public.manager_soccer_manager_identities identity
    where identity.game_world_id = p_world_id and identity.sm_manager_id is not null
  ),
  -- Names used by more than one Soccer Manager account, one of them linked to a manager.
  shared_names as materialized (
    select spell.manager_name
    from public.soccer_manager_manager_stints spell
    where spell.game_world_id = p_world_id
    group by spell.manager_name
    having count(distinct spell.sm_manager_id) > 1
       and bool_or(spell.sm_manager_id in (select linked.sm_manager_id from linked))
  ),
  spells as (
    select windows.season, windows.starts_on, spell.club_name, spell.started_at,
      case when spell.manager_name in (select shared_names.manager_name from shared_names)
                and spell.sm_manager_id not in (select linked.sm_manager_id from linked)
           then spell.manager_name || ' (2nd)' else spell.manager_name end as manager_name
    from windows
    join public.soccer_manager_manager_stints spell
      on spell.game_world_id = p_world_id
     and spell.started_at::date < windows.before_date
     -- More than two days of the spell fall inside the season.
     and least(coalesce(spell.ended_at::date, windows.before_date), windows.before_date)
         - greatest(spell.started_at::date, windows.starts_on) > 2
  )
  select spells.season, spells.starts_on, spells.club_name,
         string_agg(spells.manager_name, ' / ' order by spells.started_at)
  from spells
  group by spells.season, spells.starts_on, spells.club_name;
$$;

revoke all on function public.league_season_managers(bigint) from public, anon, authenticated;
grant execute on function public.league_season_managers(bigint) to service_role;

create or replace function public.public_league_history_rows(p_world_slug text default 'top-100')
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
  is_live boolean,
  season_start date
)
language sql
stable
security definer
set search_path = ''
as $$
  with world as (
    select id from public.game_worlds where slug = coalesce(nullif(trim(p_world_slug), ''), 'top-100') and is_active
  ),
  season_managers as materialized (
    select managers.* from world, public.league_season_managers(world.id) managers
  ),
  -- Each season's start date, whether or not any manager's spells are known for it.
  season_starts as materialized (
    select n.season,
      coalesce(saved.start_date, public.world_season_end(world.id, n.season) - 147) as season_start,
      public.world_season_end(world.id, n.season) as season_end
    from world
    cross join generate_series(1, coalesce(public.world_current_season_num(world.id), 0)) n(season)
    left join public.soccer_manager_world_seasons saved on saved.game_world_id = world.id and saved.season_num = n.season
  ),
  -- The manager in charge four days before each season's end (world_season_club_manager(),
  -- for every club at once).
  season_end_managers as materialized (
    select distinct on (season_starts.season, lower(trim(stint.club_name)))
      season_starts.season, lower(trim(stint.club_name)) as club_key, trim(stint.manager_name) as manager
    from season_starts, world
    join public.soccer_manager_manager_stints stint on stint.game_world_id = world.id
    where stint.started_at::date <= season_starts.season_end - 4
      and (stint.ended_at is null or stint.ended_at::date >= season_starts.season_end - 4)
    order by season_starts.season, lower(trim(stint.club_name)), stint.started_at desc
  ),
  saved as (
    -- Everyone who managed the club that season (their spells), else the manager in
    -- charge when the season ended, else the name entered for that row, else an honour
    -- won by the club that season.
    select t.season_num, t.division, t.position, t.team, t.played, t.won, t.drawn, t.lost,
           t.goals_for, t.goals_against, t.goal_difference, t.points,
           coalesce(
             season_managers.managers,
             season_end_managers.manager,
             t.manager, (
               select h.manager_name
               from public.soccer_manager_world_honours h
               where h.game_world_id = t.game_world_id
                 and h.season_num = t.season_num
                 and h.manager_name is not null
                 and (h.club_source_id = t.club_source_id or (t.club_source_id is null and h.club_name = t.team))
               order by h.display_order
               limit 1
             )) as manager,
           false as is_live,
           season_starts.season_start
    from public.soccer_manager_league_season_tables t
    join world on world.id = t.game_world_id
    left join season_managers
      on season_managers.season = t.season_num and lower(trim(season_managers.club)) = lower(trim(t.team))
    left join season_starts on season_starts.season = t.season_num
    left join season_end_managers
      on season_end_managers.season = t.season_num and season_end_managers.club_key = lower(trim(t.team))
  )
  select * from saved
  union all
  select live.season, live.division, live.position, live.team, live.played, live.won, live.drawn, live.lost,
         live.goals_for, live.goals_against, live.goal_difference, live.points,
         coalesce(season_managers.managers, live.manager),
         true,
         season_starts.season_start
  -- The live table is read only when the current season is not saved yet.
  from (
    select * from public.public_league_season_rows(coalesce(nullif(trim(p_world_slug), ''), 'top-100'))
    where not exists (
      select 1 from world, public.soccer_manager_league_season_tables saved_table
      where saved_table.game_world_id = world.id
        and saved_table.season_num = public.world_current_season_num(world.id))
  ) live
  left join season_managers
    on season_managers.season = live.season and lower(trim(season_managers.club)) = lower(trim(live.team))
  left join season_starts on season_starts.season = live.season
  where not exists (select 1 from saved where saved.season_num = live.season)
  order by 1 desc, 2, 3;
$$;

revoke all on function public.public_league_history_rows(text) from public;
grant execute on function public.public_league_history_rows(text) to anon, authenticated, service_role;
