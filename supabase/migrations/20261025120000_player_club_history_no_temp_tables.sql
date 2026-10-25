-- save_soccer_manager_player_club_history built two "on commit drop" temp tables, so a
-- second call in the same transaction failed with "relation already exists". Parse the
-- batch with two helper functions instead.
--
-- get_soccer_manager_player_club_history_needed also returns the requested player who was
-- collected longest ago. The world's current season is only learned from collected players,
-- so without this a season rollover would go unnoticed while every player was still fresh.

-- @permissions private public.soccer_manager_club_history_batch_players(jsonb): called only by save_soccer_manager_player_club_history()
-- @permissions private public.soccer_manager_club_history_batch_seasons(jsonb): called only by save_soccer_manager_player_club_history()

create or replace function public.soccer_manager_club_history_batch_players(target_players jsonb)
returns table (player_id text, current_season integer, seasons jsonb)
language sql
immutable
set search_path = ''
as $$
  select distinct on (parsed.player_id) parsed.player_id, parsed.current_season, parsed.seasons
  from (
    select
      trim(item->>'playerId') as player_id,
      case when coalesce(item->>'currentSeason', '') ~ '^[0-9]{1,4}$' then (item->>'currentSeason')::integer end as current_season,
      case when jsonb_typeof(item->'seasons') = 'array' then item->'seasons' else '[]'::jsonb end as seasons
    from jsonb_array_elements(case when jsonb_typeof(target_players) = 'array' then target_players else '[]'::jsonb end) item
  ) parsed
  where parsed.player_id ~ '^[1-9][0-9]*$'
  order by parsed.player_id
$$;

create or replace function public.soccer_manager_club_history_batch_seasons(target_players jsonb)
returns table (
  player_id text, season_num integer, club_id text, club_name text, league_name text,
  league_id text, season_id text, appearances integer, substitute_appearances integer,
  average_performance numeric, goals integer, assists integer, man_of_the_match integer,
  yellow_cards integer, red_cards integer, on_loan boolean
)
language sql
immutable
set search_path = ''
as $$
  select distinct on (player.player_id, keys.season_num, keys.club_id)
    player.player_id,
    keys.season_num,
    keys.club_id,
    nullif(trim(row_data->>'clubName'), ''),
    nullif(trim(row_data->>'leagueName'), ''),
    nullif(trim(row_data->>'leagueId'), ''),
    nullif(trim(row_data->>'seasonId'), ''),
    case when coalesce(row_data->>'appearances', '') ~ '^[0-9]{1,5}$' then (row_data->>'appearances')::integer end,
    case when coalesce(row_data->>'substituteAppearances', '') ~ '^[0-9]{1,5}$' then (row_data->>'substituteAppearances')::integer end,
    case when coalesce(row_data->>'averagePerformance', '') ~ '^[0-9]{1,2}(\.[0-9]+)?$' then (row_data->>'averagePerformance')::numeric end,
    case when coalesce(row_data->>'goals', '') ~ '^[0-9]{1,5}$' then (row_data->>'goals')::integer end,
    case when coalesce(row_data->>'assists', '') ~ '^[0-9]{1,5}$' then (row_data->>'assists')::integer end,
    case when coalesce(row_data->>'manOfTheMatch', '') ~ '^[0-9]{1,5}$' then (row_data->>'manOfTheMatch')::integer end,
    case when coalesce(row_data->>'yellowCards', '') ~ '^[0-9]{1,5}$' then (row_data->>'yellowCards')::integer end,
    case when coalesce(row_data->>'redCards', '') ~ '^[0-9]{1,5}$' then (row_data->>'redCards')::integer end,
    coalesce(row_data->>'onLoan', '') in ('1', 'true')
  from public.soccer_manager_club_history_batch_players(target_players) player
  cross join lateral jsonb_array_elements(player.seasons) row_data
  cross join lateral (
    select
      case when coalesce(row_data->>'seasonNum', '') ~ '^[0-9]{1,4}$' then (row_data->>'seasonNum')::integer end as season_num,
      nullif(trim(row_data->>'clubId'), '') as club_id
  ) keys
  where keys.season_num is not null and keys.club_id ~ '^[0-9]+$'
  order by player.player_id, keys.season_num, keys.club_id
$$;

revoke all on function public.soccer_manager_club_history_batch_players(jsonb) from public, anon, authenticated;
revoke all on function public.soccer_manager_club_history_batch_seasons(jsonb) from public, anon, authenticated;

create or replace function public.save_soccer_manager_player_club_history(
  target_setup_id text,
  target_players jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_id text := nullif(trim(target_setup_id), '');
  v_world_id bigint;
  v_world_season integer;
  v_players integer;
  v_seasons integer;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if setup_id is null or setup_id !~ '^[0-9]+$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;
  if jsonb_typeof(target_players) is distinct from 'array' then
    raise exception 'target_players must be an array';
  end if;
  if jsonb_array_length(target_players) > 200 then
    raise exception 'Save at most 200 players per call';
  end if;

  select id into v_world_id
  from public.game_worlds
  where external_world_id = setup_id::bigint
  order by id
  limit 1;
  if v_world_id is null then
    raise exception 'No archived Soccer Manager world %', setup_id;
  end if;

  -- A player with no current-season row (no games yet) still belongs to the world's current season.
  select greatest(
    (select max(current_season_num) from public.soccer_manager_player_club_history where game_world_id = v_world_id),
    (select max(current_season) from public.soccer_manager_club_history_batch_players(target_players)),
    (select max(season_num) from public.soccer_manager_club_history_batch_seasons(target_players))
  ) into v_world_season;

  delete from public.soccer_manager_player_club_seasons season
  using public.soccer_manager_club_history_batch_players(target_players) player
  where season.game_world_id = v_world_id
    and season.source_player_id = player.player_id;

  insert into public.soccer_manager_player_club_seasons (
    game_world_id, source_player_id, season_num, source_club_id, club_name, league_name,
    source_league_id, source_season_id, appearances, substitute_appearances, average_performance,
    goals, assists, man_of_the_match, yellow_cards, red_cards, on_loan, captured_at
  )
  select
    v_world_id, player_id, season_num, club_id, club_name, league_name,
    league_id, season_id, appearances, substitute_appearances, average_performance,
    goals, assists, man_of_the_match, yellow_cards, red_cards, on_loan, now()
  from public.soccer_manager_club_history_batch_seasons(target_players);
  get diagnostics v_seasons = row_count;

  insert into public.soccer_manager_player_club_history (
    game_world_id, source_player_id, current_season_num, season_rows, captured_at
  )
  select
    v_world_id,
    player.player_id,
    greatest(coalesce(player.current_season, 0), coalesce(v_world_season, 0)),
    coalesce(counts.season_rows, 0),
    now()
  from public.soccer_manager_club_history_batch_players(target_players) player
  left join (
    select player_id, count(*)::integer as season_rows
    from public.soccer_manager_club_history_batch_seasons(target_players)
    group by player_id
  ) counts on counts.player_id = player.player_id
  on conflict (game_world_id, source_player_id) do update
    set current_season_num = excluded.current_season_num,
        season_rows = excluded.season_rows,
        captured_at = excluded.captured_at;
  get diagnostics v_players = row_count;

  return jsonb_build_object('gameWorldId', v_world_id, 'players', v_players, 'seasons', v_seasons, 'currentSeason', v_world_season);
end;
$$;

create or replace function public.get_soccer_manager_player_club_history_needed(
  target_setup_id text,
  target_player_ids text[]
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_id text := nullif(trim(target_setup_id), '');
  v_world_id bigint;
  v_world_season integer;
  needed text[];
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if setup_id is null or setup_id !~ '^[0-9]+$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;
  if coalesce(cardinality(target_player_ids), 0) > 10000 then
    raise exception 'Too many players in one request';
  end if;

  select id into v_world_id
  from public.game_worlds
  where external_world_id = setup_id::bigint
  order by id
  limit 1;
  if v_world_id is null then
    raise exception 'No archived Soccer Manager world %', setup_id;
  end if;

  select max(current_season_num) into v_world_season
  from public.soccer_manager_player_club_history
  where game_world_id = v_world_id;

  with requested as (
    select distinct trim(raw_id) as player_id
    from unnest(coalesce(target_player_ids, '{}')) raw_id
    where trim(raw_id) ~ '^[1-9][0-9]*$'
  ),
  stale as (
    select requested.player_id
    from requested
    left join public.soccer_manager_player_club_history history
      on history.game_world_id = v_world_id
     and history.source_player_id = requested.player_id
    where history.source_player_id is null
       or history.current_season_num < v_world_season
       or history.captured_at < now() - interval '60 days'
  ),
  season_probe as (
    select requested.player_id
    from requested
    join public.soccer_manager_player_club_history history
      on history.game_world_id = v_world_id
     and history.source_player_id = requested.player_id
    order by history.captured_at, requested.player_id
    limit 1
  )
  select coalesce(array_agg(ids.player_id order by ids.player_id), '{}')
    into needed
  from (select player_id from stale union select player_id from season_probe) ids;

  return needed;
end;
$$;
