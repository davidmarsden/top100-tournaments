-- Club season history for every player in a world's squads.
--
-- Soccer Manager's player-ajax-mobile.php?action=player-data-stats returns
-- Statistics.Career.League: one row per season per club, with appearances and
-- average performance. Sync everything collects it once per player (and again
-- after a season rollover) and saves it with save_soccer_manager_player_club_history.
--
-- The squad fields aapp/aavp/ags/... that the archive stores in
-- soccer_manager_players.career_* are international (national team) stats, not
-- club career. Player Intelligence now compares this season against the
-- player's club seasons before the current one instead.

create table if not exists public.soccer_manager_player_club_seasons (
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  source_player_id text not null,
  season_num integer not null,
  source_club_id text not null,
  club_name text,
  league_name text,
  source_league_id text,
  source_season_id text,
  appearances integer,
  substitute_appearances integer,
  average_performance numeric,
  goals integer,
  assists integer,
  man_of_the_match integer,
  yellow_cards integer,
  red_cards integer,
  on_loan boolean,
  captured_at timestamptz not null default now(),
  primary key (game_world_id, source_player_id, season_num, source_club_id)
);

create table if not exists public.soccer_manager_player_club_history (
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  source_player_id text not null,
  current_season_num integer not null,
  season_rows integer not null default 0,
  captured_at timestamptz not null default now(),
  primary key (game_world_id, source_player_id)
);

alter table public.soccer_manager_player_club_seasons enable row level security;
alter table public.soccer_manager_player_club_history enable row level security;
revoke all on public.soccer_manager_player_club_seasons from anon, authenticated;
revoke all on public.soccer_manager_player_club_history from anon, authenticated;

-- One row per collected player: totals over club seasons before the current one.
-- The average is weighted by appearances and skips seasons without a rating.
create or replace view public.soccer_manager_player_club_baselines
with (security_invoker = true) as
select
  history.game_world_id,
  history.source_player_id,
  history.current_season_num,
  count(distinct season.season_num)::integer as career_seasons,
  sum(season.appearances)::integer as career_appearances,
  round(
    sum(season.average_performance * season.appearances)
      filter (where season.appearances > 0 and season.average_performance > 0)
    / nullif(sum(season.appearances) filter (where season.appearances > 0 and season.average_performance > 0), 0),
    2
  ) as career_average_performance,
  sum(season.goals)::integer as career_goals,
  sum(season.assists)::integer as career_assists,
  sum(season.man_of_the_match)::integer as career_man_of_the_match,
  sum(season.yellow_cards)::integer as career_yellow_cards,
  sum(season.red_cards)::integer as career_red_cards,
  history.captured_at
from public.soccer_manager_player_club_history history
left join public.soccer_manager_player_club_seasons season
  on season.game_world_id = history.game_world_id
 and season.source_player_id = history.source_player_id
 and season.season_num < history.current_season_num
group by history.game_world_id, history.source_player_id, history.current_season_num, history.captured_at;

revoke all on public.soccer_manager_player_club_baselines from anon, authenticated;

-- Which of these players (playerDataIds) still need their club history collected:
-- never collected, collected before the world's latest known season, or over 60 days ago.
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

  select coalesce(array_agg(requested.player_id order by requested.player_id), '{}')
    into needed
  from (
    select distinct trim(raw_id) as player_id
    from unnest(coalesce(target_player_ids, '{}')) raw_id
    where trim(raw_id) ~ '^[1-9][0-9]*$'
  ) requested
  left join public.soccer_manager_player_club_history history
    on history.game_world_id = v_world_id
   and history.source_player_id = requested.player_id
  where history.source_player_id is null
     or history.current_season_num < v_world_season
     or history.captured_at < now() - interval '60 days';

  return needed;
end;
$$;

-- Replace the club history of up to 200 players.
-- target_players: [{ playerId, currentSeason, seasons: [{ seasonNum, clubId, clubName, leagueName,
--   leagueId, seasonId, appearances, substituteAppearances, averagePerformance, goals, assists,
--   manOfTheMatch, yellowCards, redCards, onLoan }] }]
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

  create temporary table club_history_players on commit drop as
  select distinct on (player_id) player_id, current_season, seasons
  from (
    select
      trim(item->>'playerId') as player_id,
      case when coalesce(item->>'currentSeason', '') ~ '^[0-9]{1,4}$' then (item->>'currentSeason')::integer end as current_season,
      case when jsonb_typeof(item->'seasons') = 'array' then item->'seasons' else '[]'::jsonb end as seasons
    from jsonb_array_elements(target_players) item
  ) parsed
  where player_id ~ '^[1-9][0-9]*$';

  create temporary table club_history_rows on commit drop as
  select distinct on (player.player_id, season_num, club_id)
    player.player_id,
    season_num,
    club_id,
    nullif(trim(row_data->>'clubName'), '') as club_name,
    nullif(trim(row_data->>'leagueName'), '') as league_name,
    nullif(trim(row_data->>'leagueId'), '') as league_id,
    nullif(trim(row_data->>'seasonId'), '') as season_id,
    case when coalesce(row_data->>'appearances', '') ~ '^[0-9]{1,5}$' then (row_data->>'appearances')::integer end as appearances,
    case when coalesce(row_data->>'substituteAppearances', '') ~ '^[0-9]{1,5}$' then (row_data->>'substituteAppearances')::integer end as substitute_appearances,
    case when coalesce(row_data->>'averagePerformance', '') ~ '^[0-9]{1,2}(\.[0-9]+)?$' then (row_data->>'averagePerformance')::numeric end as average_performance,
    case when coalesce(row_data->>'goals', '') ~ '^[0-9]{1,5}$' then (row_data->>'goals')::integer end as goals,
    case when coalesce(row_data->>'assists', '') ~ '^[0-9]{1,5}$' then (row_data->>'assists')::integer end as assists,
    case when coalesce(row_data->>'manOfTheMatch', '') ~ '^[0-9]{1,5}$' then (row_data->>'manOfTheMatch')::integer end as man_of_the_match,
    case when coalesce(row_data->>'yellowCards', '') ~ '^[0-9]{1,5}$' then (row_data->>'yellowCards')::integer end as yellow_cards,
    case when coalesce(row_data->>'redCards', '') ~ '^[0-9]{1,5}$' then (row_data->>'redCards')::integer end as red_cards,
    coalesce(row_data->>'onLoan', '') in ('1', 'true') as on_loan
  from pg_temp.club_history_players player
  cross join lateral jsonb_array_elements(player.seasons) row_data
  cross join lateral (
    select
      case when coalesce(row_data->>'seasonNum', '') ~ '^[0-9]{1,4}$' then (row_data->>'seasonNum')::integer end as season_num,
      nullif(trim(row_data->>'clubId'), '') as club_id
  ) keys
  where season_num is not null and club_id ~ '^[0-9]+$';

  -- A player with no current-season row (no games yet) still belongs to the world's current season.
  select greatest(
    (select max(current_season_num) from public.soccer_manager_player_club_history where game_world_id = v_world_id),
    (select max(current_season) from pg_temp.club_history_players),
    (select max(season_num) from pg_temp.club_history_rows)
  ) into v_world_season;

  delete from public.soccer_manager_player_club_seasons season
  using pg_temp.club_history_players player
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
  from pg_temp.club_history_rows;
  get diagnostics v_seasons = row_count;

  insert into public.soccer_manager_player_club_history (
    game_world_id, source_player_id, current_season_num, season_rows, captured_at
  )
  select
    v_world_id,
    player.player_id,
    greatest(coalesce(player.current_season, 0), coalesce(v_world_season, 0)),
    (select count(*) from pg_temp.club_history_rows row_data where row_data.player_id = player.player_id),
    now()
  from pg_temp.club_history_players player
  on conflict (game_world_id, source_player_id) do update
    set current_season_num = excluded.current_season_num,
        season_rows = excluded.season_rows,
        captured_at = excluded.captured_at;
  get diagnostics v_players = row_count;

  return jsonb_build_object('gameWorldId', v_world_id, 'players', v_players, 'seasons', v_seasons, 'currentSeason', v_world_season);
end;
$$;

revoke all on function public.get_soccer_manager_player_club_history_needed(text, text[]) from public, anon;
revoke all on function public.save_soccer_manager_player_club_history(text, jsonb) from public, anon;
grant execute on function public.get_soccer_manager_player_club_history_needed(text, text[]) to authenticated;
grant execute on function public.save_soccer_manager_player_club_history(text, jsonb) to authenticated;

-- Point Player Intelligence at the club baseline. These functions are patched in place so
-- the rest of their bodies stay exactly as deployed.
do $migration$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef('public.get_my_soccer_manager_dashboard_for_world(bigint)'::regprocedure);
  patched := replace(definition,
'      ''careerAppearances'', player.career_appearances,
      ''careerAveragePerformance'', player.career_average_performance,
      ''careerGoals'', player.career_goals,
      ''careerAssists'', player.career_assists,
      ''careerManOfTheMatch'', player.career_man_of_the_match,
      ''careerYellowCards'', player.career_yellow_cards,
      ''careerRedCards'', player.career_red_cards,',
'      ''careerSeasons'', baseline.career_seasons,
      ''careerAppearances'', baseline.career_appearances,
      ''careerAveragePerformance'', baseline.career_average_performance,
      ''careerGoals'', baseline.career_goals,
      ''careerAssists'', baseline.career_assists,
      ''careerManOfTheMatch'', baseline.career_man_of_the_match,
      ''careerYellowCards'', baseline.career_yellow_cards,
      ''careerRedCards'', baseline.career_red_cards,
      ''internationalAppearances'', player.career_appearances,
      ''internationalAveragePerformance'', player.career_average_performance,');
  patched := replace(patched,
'  from public.soccer_manager_players player
  where player.game_world_id = v_game_world_id',
'  from public.soccer_manager_players player
  left join public.soccer_manager_player_club_baselines baseline
    on baseline.game_world_id = player.game_world_id
   and baseline.source_player_id = player.source_player_id
  where player.game_world_id = v_game_world_id');
  if patched = definition or position('baseline.career_seasons' in patched) = 0 or position('left join public.soccer_manager_player_club_baselines baseline' in patched) = 0 then
    raise exception 'get_my_soccer_manager_dashboard_for_world did not match the expected definition';
  end if;
  execute patched;

  definition := pg_get_functiondef('public.manager_lab_opponent_players(text)'::regprocedure);
  patched := replace(definition,
'      p.goals, p.assists, p.career_appearances, p.career_average_performance, p.career_goals,
      p.career_assists, p.rating_change, p.transfer_listed
    from public.soccer_manager_players p
    join world w on w.id = p.game_world_id',
'      p.goals, p.assists, b.career_appearances, b.career_average_performance, b.career_goals,
      b.career_assists, p.rating_change, p.transfer_listed
    from public.soccer_manager_players p
    join world w on w.id = p.game_world_id
    left join public.soccer_manager_player_club_baselines b
      on b.game_world_id = p.game_world_id and b.source_player_id = p.source_player_id');
  if patched = definition then
    raise exception 'manager_lab_opponent_players did not match the expected definition';
  end if;
  execute patched;

  definition := pg_get_functiondef('public.manager_lab_observed_selections(text)'::regprocedure);
  patched := replace(definition,
'p.average_performance,p.career_appearances,p.career_average_performance,p.rating_change
 from observed o left join public.soccer_manager_players p on p.game_world_id=v_world_id and p.source_player_id=o.source_player_id',
'p.average_performance,b.career_appearances,b.career_average_performance,p.rating_change
 from observed o left join public.soccer_manager_players p on p.game_world_id=v_world_id and p.source_player_id=o.source_player_id
 left join public.soccer_manager_player_club_baselines b on b.game_world_id=v_world_id and b.source_player_id=o.source_player_id');
  if patched = definition then
    raise exception 'manager_lab_observed_selections did not match the expected definition';
  end if;
  execute patched;
end;
$migration$;
