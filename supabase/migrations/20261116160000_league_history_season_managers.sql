-- League history with each season's own managers and start date, so a finished season
-- from Sync can stand as the permanent record without pasting it into the Full History
-- sheet.
--
-- 1. league_season_managers(world): who managed each club in each season, from the
--    managers' Soccer Manager spells (soccer_manager_manager_stints). A spell counts when
--    it overlaps the season by more than two days and began before the season's last
--    league game: the last game Sync saw, or for seasons without match data five days
--    before the season ends (the play-offs). While a season is running, any spell begun
--    by today counts. Managers are listed in the order they took over
--    ("Luís André Libras-Boas / Gianluca Ghio (2nd)"). A second Soccer Manager account
--    with the same name as a manager's own (linked) account is marked "(2nd)", as the
--    archive marks it.
--
-- 2. public_league_history_rows() names those managers first, live season included (it
--    named today's manager there, from public_league_season_rows), keeping the manager in
--    charge at the season's end, the entered name and honours as fallbacks; and gains
--    season_start. public_league_season_rows() is unchanged: appointments
--    want today's managers.

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
  seasons as (
    select n.season,
      coalesce(saved.start_date, public.world_season_end(p_world_id, n.season) - 147) as starts_on,
      coalesce(saved.end_date, public.world_season_end(p_world_id, n.season)) as ends_on
    from current_season cross join generate_series(1, current_season.n) n(season)
    left join public.soccer_manager_world_seasons saved on saved.game_world_id = p_world_id and saved.season_num = n.season
  ),
  last_game as (
    select seasons.season, max((match.source_data->'fixture'->>'date')::date) as played_on
    from seasons
    join public.soccer_manager_match_snapshots match
      on match.game_world_id = p_world_id and match.competition_code = 'league'
     and match.home_score is not null and match.away_score is not null
     and (match.source_data->'fixture'->>'date')::date between seasons.starts_on and seasons.ends_on
    group by seasons.season
  ),
  windows as (
    select seasons.season, seasons.starts_on,
      case when current_date < seasons.ends_on then current_date + 1
           else coalesce(last_game.played_on + 1, seasons.ends_on - 5) end as before_date
    from seasons
    left join last_game on last_game.season = seasons.season
    where seasons.starts_on is not null
  ),
  linked as (
    select distinct identity.sm_manager_id
    from public.manager_soccer_manager_identities identity
    where identity.game_world_id = p_world_id and identity.sm_manager_id is not null
  ),
  -- Names used by more than one Soccer Manager account, one of them linked to a manager.
  shared_names as (
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
     and coalesce(spell.ended_at::date, 'infinity'::date) > windows.starts_on + 2
  )
  select spells.season, spells.starts_on, spells.club_name,
         string_agg(spells.manager_name, ' / ' order by spells.started_at)
  from spells
  group by spells.season, spells.starts_on, spells.club_name;
$$;

revoke all on function public.league_season_managers(bigint) from public, anon, authenticated;
grant execute on function public.league_season_managers(bigint) to service_role;

-- The return type gains season_start, so the function is dropped and made again.
drop function if exists public.public_league_history_rows(text);

create function public.public_league_history_rows(p_world_slug text default 'top-100')
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
  season_managers as (
    select managers.* from world, public.league_season_managers(world.id) managers
  ),
  season_starts as (
    select distinct season_managers.season, season_managers.season_start from season_managers
  ),
  saved as (
    -- Everyone who managed the club that season (their spells), else the manager in
    -- charge when the season ended, else the name entered for that row, else an honour
    -- won by the club that season.
    select t.season_num, t.division, t.position, t.team, t.played, t.won, t.drawn, t.lost,
           t.goals_for, t.goals_against, t.goal_difference, t.points,
           coalesce((
             select season_managers.managers from season_managers
             where season_managers.season = t.season_num and lower(trim(season_managers.club)) = lower(trim(t.team))
           ),
           public.world_season_club_manager(t.game_world_id, t.season_num, t.team),
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
           (select season_starts.season_start from season_starts where season_starts.season = t.season_num) as season_start
    from public.soccer_manager_league_season_tables t
    join world on world.id = t.game_world_id
  )
  select * from saved
  union all
  select live.season, live.division, live.position, live.team, live.played, live.won, live.drawn, live.lost,
         live.goals_for, live.goals_against, live.goal_difference, live.points,
         coalesce((
           select season_managers.managers from season_managers
           where season_managers.season = live.season and lower(trim(season_managers.club)) = lower(trim(live.team))
         ), live.manager),
         true,
         (select season_starts.season_start from season_starts where season_starts.season = live.season)
  from public.public_league_season_rows(coalesce(nullif(trim(p_world_slug), ''), 'top-100')) live
  where not exists (select 1 from saved where saved.season_num = live.season)
  order by 1 desc, 2, 3;
$$;

revoke all on function public.public_league_history_rows(text) from public;
grant execute on function public.public_league_history_rows(text) to anon, authenticated, service_role;
