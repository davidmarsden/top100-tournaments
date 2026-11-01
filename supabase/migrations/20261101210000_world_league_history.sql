-- League history per game world, so the archive can show Top 100 Regen next to
-- Top 100. Top 100's past seasons live in the Full History sheet; Regen has no
-- sheet, so its seasons are kept here as each one finishes.
--
-- 1. world_current_season_num(): each world's own season number (Regen is S4,
--    not Top 100's S28): the game's current season from player histories, else
--    the latest completed league season + 1 or the newest honours season.
-- 2. public_league_season_rows() uses it (it used the global seasons table).
-- 3. soccer_manager_league_season_tables + freeze_completed_league_season(): when
--    every club has played 38, the final table is saved. The core archive apply
--    (run after each Sync) calls it.
-- 4. public_league_history_rows(): saved seasons plus the live season, for the
--    archive.
-- 5. save_soccer_manager_world_honours() also saves each season's final tables,
--    which Sync now reads from Soccer Manager's Game World History.
--
-- league_standings_current_by_club, the crosswalk and the Sync tables come from
-- Manager Lab's migrations, so SQL function bodies are not checked here.
set check_function_bodies = false;

create or replace function public.world_current_season_num(p_world_id bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with source as (
    select
      (select max(h.current_season_num) from public.soccer_manager_player_club_history h where h.game_world_id = p_world_id) as game_season,
      (select max((entity.data->>'season')::integer)
         from public.soccer_manager_canonical_entities entity
         join public.game_worlds world on world.id = p_world_id
        where entity.entity_type = 'season_history'
          and entity.data->>'setupId' = world.external_world_id::text
          and coalesce(entity.data->>'season', '') ~ '^[0-9]{1,4}$') as last_completed,
      (select max(h.season_num) from public.soccer_manager_world_honours h where h.game_world_id = p_world_id) as honours_season
  )
  -- The game's own current season (read with player histories) wins: between the
  -- last match and the new season, the finished season already has a winner, so
  -- "last completed + 1" would name the next season too early. It is only
  -- ignored when it is plainly stale (older than a completed season).
  select case
    when game_season is not null and game_season >= coalesce(last_completed, 0) then game_season
    else nullif(greatest(coalesce(last_completed + 1, 0), coalesce(honours_season, 0)), 0)
  end
  from source;
$$;

revoke all on function public.world_current_season_num(bigint) from public, anon, authenticated;
grant execute on function public.world_current_season_num(bigint) to service_role;

create or replace function public.public_league_season_rows(p_world_slug text default 'top-100'::text)
returns table(season integer, division integer, "position" integer, team text, played integer, won integer, drawn integer, lost integer, goals_for integer, goals_against integer, goal_difference integer, points integer, manager text, squad_strength numeric, predicted_position integer, observed_at timestamp with time zone, season_complete boolean)
language sql
stable security definer
set search_path to ''
as $function$
  with world as (
    select id, external_world_id from public.game_worlds where slug = p_world_slug and is_active
  ),
  season_number as (
    select coalesce(
      (select public.world_current_season_num(world.id) from world),
      (select max(s.number) from public.seasons s where s.code ~ '^S[0-9]+$'),
      0
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
$function$;

revoke all on function public.public_league_season_rows(text) from public;
grant execute on function public.public_league_season_rows(text) to anon, authenticated, service_role;

create table if not exists public.soccer_manager_league_season_tables (
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  season_num integer not null check (season_num between 1 and 9999),
  division integer not null,
  position integer not null,
  team text not null,
  club_source_id text,
  managed boolean,
  played integer,
  won integer,
  drawn integer,
  lost integer,
  goals_for integer,
  goals_against integer,
  goal_difference integer,
  points integer,
  manager text,
  source text not null default 'live' check (source in ('live', 'history')),
  frozen_at timestamptz not null default now(),
  primary key (game_world_id, season_num, division, position)
);

comment on table public.soccer_manager_league_season_tables is
  'Final league tables per world and season: read from Soccer Manager''s Game World History by Sync (source history, through save_soccer_manager_world_honours) or saved from the live table by freeze_completed_league_season() when every club has played 38 (source live). Read publicly through public_league_history_rows().';

alter table public.soccer_manager_league_season_tables enable row level security;
revoke all on public.soccer_manager_league_season_tables from anon, authenticated;
drop policy if exists "Admins read league season tables" on public.soccer_manager_league_season_tables;
create policy "Admins read league season tables" on public.soccer_manager_league_season_tables
  for select to authenticated using ((select public.is_admin()));
grant select on public.soccer_manager_league_season_tables to authenticated;

-- Saves the live table as that season's final table once every club has played
-- 38. A season already saved is left alone, so a later sync can't overwrite it
-- with the next season's opening rows.
create or replace function public.freeze_completed_league_season(p_world_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_season integer;
  v_saved integer := 0;
begin
  select slug into v_slug from public.game_worlds where id = p_world_id and is_active;
  if v_slug is null then
    return 0;
  end if;

  select live.season into v_season
  from public.public_league_season_rows(v_slug) live
  group by live.season
  having bool_and(live.season_complete) and count(*) >= 20
  limit 1;

  if v_season is null or v_season < 1 then
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

-- Every saved season plus the live one (when it isn't saved yet), in the Full
-- History sheet's shape.
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
  is_live boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with world as (
    select id from public.game_worlds where slug = coalesce(nullif(trim(p_world_slug), ''), 'top-100') and is_active
  ),
  saved as (
    -- Game World History tables name no managers: an honour won by that club in
    -- that season names its manager (league titles, play-offs, cups).
    select t.season_num, t.division, t.position, t.team, t.played, t.won, t.drawn, t.lost,
           t.goals_for, t.goals_against, t.goal_difference, t.points,
           coalesce(t.manager, (
             select h.manager_name
             from public.soccer_manager_world_honours h
             where h.game_world_id = t.game_world_id
               and h.season_num = t.season_num
               and h.manager_name is not null
               and (h.club_source_id = t.club_source_id or (t.club_source_id is null and h.club_name = t.team))
             order by h.display_order
             limit 1
           )) as manager,
           false as is_live
    from public.soccer_manager_league_season_tables t
    join world on world.id = t.game_world_id
  )
  select * from saved
  union all
  select live.season, live.division, live.position, live.team, live.played, live.won, live.drawn, live.lost,
         live.goals_for, live.goals_against, live.goal_difference, live.points, live.manager, true
  from public.public_league_season_rows(coalesce(nullif(trim(p_world_slug), ''), 'top-100')) live
  where not exists (select 1 from saved where saved.season_num = live.season)
  order by 1 desc, 2, 3;
$$;

revoke all on function public.public_league_history_rows(text) from public;
grant execute on function public.public_league_history_rows(text) to anon, authenticated, service_role;

-- Freeze after each core archive apply (Sync's last step).
do $migration$
declare
  function_ddl text;
  old_text constant text := E'  insert into public.audit_log (\n    entity_type,';
  new_text constant text := E'  perform public.freeze_completed_league_season(v_world_id);\n\n  insert into public.audit_log (\n    entity_type,';
begin
  select pg_get_functiondef(p.oid)
    into function_ddl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_soccer_manager_core_archive'
    and pg_get_function_identity_arguments(p.oid) = 'target_setup_id text';

  if function_ddl is null then
    raise exception 'apply_soccer_manager_core_archive(text) was not found';
  end if;

  if (length(function_ddl) - length(replace(function_ddl, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'Expected audit_log anchor was not found exactly once; refusing an unsafe migration';
  end if;

  execute replace(function_ddl, old_text, new_text);
end;
$migration$;

revoke all on function public.apply_soccer_manager_core_archive(text) from public;
grant execute on function public.apply_soccer_manager_core_archive(text) to authenticated;
grant execute on function public.apply_soccer_manager_core_archive(text) to service_role;

-- Sync everything sends each season's final tables (Game World History) with its
-- honours. A season's tables replace what History stored for it; a live freeze
-- is replaced too, but its manager names are kept (History names none).
-- Only complete tables are sent (every club has played every match).
create or replace function public.save_soccer_manager_world_honours(
  target_setup_id text,
  target_seasons jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_id text := nullif(trim(target_setup_id), '');
  v_world_id bigint;
  v_season jsonb;
  v_season_num integer;
  v_rows integer := 0;
  v_seasons integer := 0;
  v_table_rows integer := 0;
  v_table_seasons integer := 0;
  v_inserted integer;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if setup_id is null or setup_id !~ '^[0-9]+$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;
  if jsonb_typeof(target_seasons) is distinct from 'array' then
    raise exception 'target_seasons must be an array';
  end if;
  if jsonb_array_length(target_seasons) > 60 then
    raise exception 'Save at most 60 seasons per call';
  end if;

  select id into v_world_id from public.game_worlds where external_world_id = setup_id::bigint order by id limit 1;
  if v_world_id is null then
    raise exception 'No archived Soccer Manager world %', setup_id;
  end if;

  for v_season in select value from jsonb_array_elements(target_seasons) loop
    v_season_num := case when coalesce(v_season->>'seasonNum', '') ~ '^[0-9]{1,4}$' then (v_season->>'seasonNum')::integer end;
    if v_season_num is null or v_season_num < 1 then continue; end if;

    -- Final tables.
    if jsonb_typeof(v_season->'tables') = 'array' and jsonb_array_length(v_season->'tables') > 0 then
      if jsonb_array_length(v_season->'tables') > 400 then
        raise exception 'Season % has more than 400 table rows', v_season_num;
      end if;

      with parsed as (
        select distinct on (division, position)
          division, position, team, club_source_id, managed, played, won, drawn, lost, goals_for, goals_against, goal_difference, points
        from (
          select
            case when coalesce(item->>'division', '') ~ '^[0-9]{1,2}$' then (item->>'division')::integer end as division,
            case when coalesce(item->>'position', '') ~ '^[0-9]{1,3}$' then (item->>'position')::integer end as position,
            left(nullif(trim(item->>'clubName'), ''), 160) as team,
            case when coalesce(item->>'clubId', '') ~ '^[0-9]{1,20}$' then item->>'clubId' end as club_source_id,
            case when jsonb_typeof(item->'managed') = 'boolean' then (item->>'managed')::boolean end as managed,
            case when coalesce(item->>'played', '') ~ '^[0-9]{1,3}$' then (item->>'played')::integer end as played,
            case when coalesce(item->>'won', '') ~ '^[0-9]{1,3}$' then (item->>'won')::integer end as won,
            case when coalesce(item->>'drawn', '') ~ '^[0-9]{1,3}$' then (item->>'drawn')::integer end as drawn,
            case when coalesce(item->>'lost', '') ~ '^[0-9]{1,3}$' then (item->>'lost')::integer end as lost,
            case when coalesce(item->>'goalsFor', '') ~ '^[0-9]{1,4}$' then (item->>'goalsFor')::integer end as goals_for,
            case when coalesce(item->>'goalsAgainst', '') ~ '^[0-9]{1,4}$' then (item->>'goalsAgainst')::integer end as goals_against,
            case when coalesce(item->>'goalDifference', '') ~ '^-?[0-9]{1,4}$' then (item->>'goalDifference')::integer end as goal_difference,
            case when coalesce(item->>'points', '') ~ '^-?[0-9]{1,4}$' then (item->>'points')::integer end as points
          from jsonb_array_elements(v_season->'tables') item
        ) raw
        where division between 1 and 20 and position between 1 and 100 and team is not null
        order by division, position
      ),
      cleared as (
        delete from public.soccer_manager_league_season_tables old
        where old.game_world_id = v_world_id
          and old.season_num = v_season_num
          and old.source = 'history'
          and not exists (select 1 from parsed where parsed.division = old.division and parsed.position = old.position)
      )
      insert into public.soccer_manager_league_season_tables as saved
        (game_world_id, season_num, division, position, team, club_source_id, managed, played, won, drawn, lost,
         goals_for, goals_against, goal_difference, points, source, frozen_at)
      select v_world_id, v_season_num, division, position, team, club_source_id, managed, played, won, drawn, lost,
             goals_for, goals_against, goal_difference, points, 'history', now()
      from parsed
      on conflict (game_world_id, season_num, division, position) do update
        set team = excluded.team,
            club_source_id = excluded.club_source_id,
            managed = excluded.managed,
            played = excluded.played, won = excluded.won, drawn = excluded.drawn, lost = excluded.lost,
            goals_for = excluded.goals_for, goals_against = excluded.goals_against,
            goal_difference = excluded.goal_difference, points = excluded.points,
            -- A live freeze named the manager; keep it while it is the same club.
            manager = case when saved.team = excluded.team then saved.manager else null end,
            source = 'history',
            frozen_at = now();

      get diagnostics v_inserted = row_count;
      v_table_rows := v_table_rows + v_inserted;
      v_table_seasons := v_table_seasons + 1;
    end if;

    -- Honours.
    if jsonb_typeof(v_season->'honours') is distinct from 'array' or jsonb_array_length(v_season->'honours') = 0 then continue; end if;
    if jsonb_array_length(v_season->'honours') > 60 then
      raise exception 'Season % has more than 60 honours', v_season_num;
    end if;

    delete from public.soccer_manager_world_honours where game_world_id = v_world_id and season_num = v_season_num;

    insert into public.soccer_manager_world_honours
      (game_world_id, season_num, competition, display_order, season_source_id, club_source_id, club_name, manager_source_id, manager_name, captured_at)
    select distinct on (competition)
      v_world_id, v_season_num, competition, display_order,
      nullif(trim(v_season->>'seasonId'), ''),
      club_source_id, club_name, manager_source_id, manager_name, now()
    from (
      select
        left(nullif(trim(item.value->>'competition'), ''), 120) as competition,
        item.ordinality::integer as display_order,
        case when coalesce(item.value->>'clubId', '') ~ '^[0-9]{1,20}$' then item.value->>'clubId' end as club_source_id,
        left(nullif(trim(item.value->>'clubName'), ''), 160) as club_name,
        case when coalesce(item.value->>'managerId', '') ~ '^[0-9]{1,20}$' then item.value->>'managerId' end as manager_source_id,
        left(nullif(trim(item.value->>'managerName'), ''), 160) as manager_name
      from jsonb_array_elements(v_season->'honours') with ordinality item
    ) parsed
    where competition is not null and (club_name is not null or manager_name is not null)
    order by competition, display_order;

    get diagnostics v_inserted = row_count;
    v_rows := v_rows + v_inserted;
    v_seasons := v_seasons + 1;
  end loop;

  return jsonb_build_object('seasons', v_seasons, 'honours', v_rows, 'tableSeasons', v_table_seasons, 'tableRows', v_table_rows);
end;
$$;

revoke all on function public.save_soccer_manager_world_honours(text, jsonb) from public, anon;
grant execute on function public.save_soccer_manager_world_honours(text, jsonb) to authenticated, service_role;

reset check_function_bodies;
