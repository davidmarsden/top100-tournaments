-- Who managed each club when each season ended, from Soccer Manager's own manager
-- histories, so saved league tables (Game World History names no managers) carry
-- the right manager under the name Soccer Manager uses.
--
-- Sync everything reads each relevant manager's profile history
-- (profile-ajax.php?action=friends-allhistory): club, game world, start and end
-- of every spell. It keeps the spells in the world being synced and saves them
-- with save_soccer_manager_world_managers(), together with the current season's
-- dates (GWHistory Rules.StartDate / EndDate).
--
-- Past seasons' dates are not given by the game, but every season is exactly 21
-- weeks (147 days): world_season_end() uses saved dates where it has them,
-- otherwise counts back in 147-day steps from the nearest season with dates.
-- public_league_history_rows() names, for each saved table row, the manager whose
-- spell at that club covered the end of that season; the manually entered name
-- and honours remain the fallback.
--
-- The Sync tables come from Manager Lab's migrations, so SQL function bodies are
-- not checked here.
set check_function_bodies = false;

create table if not exists public.soccer_manager_world_seasons (
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  season_num integer not null check (season_num between 1 and 9999),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  captured_at timestamptz not null default now(),
  primary key (game_world_id, season_num)
);

create table if not exists public.soccer_manager_manager_stints (
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  sm_manager_id text not null check (sm_manager_id ~ '^[0-9]{1,20}$'),
  manager_name text not null,
  club_name text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  games integer,
  captured_at timestamptz not null default now(),
  primary key (game_world_id, sm_manager_id, club_name, started_at),
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists soccer_manager_manager_stints_club_idx
  on public.soccer_manager_manager_stints (game_world_id, lower(club_name), started_at);

comment on table public.soccer_manager_world_seasons is
  'Season start and end dates per world, read by Sync from GWHistory Rules (current season only).';
comment on table public.soccer_manager_manager_stints is
  'Managers'' spells at clubs in a world, from their Soccer Manager profile history (friends-allhistory), saved by save_soccer_manager_world_managers().';

alter table public.soccer_manager_world_seasons enable row level security;
alter table public.soccer_manager_manager_stints enable row level security;
revoke all on public.soccer_manager_world_seasons from anon, authenticated;
revoke all on public.soccer_manager_manager_stints from anon, authenticated;
drop policy if exists "Admins read world seasons" on public.soccer_manager_world_seasons;
create policy "Admins read world seasons" on public.soccer_manager_world_seasons
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "Admins read manager stints" on public.soccer_manager_manager_stints;
create policy "Admins read manager stints" on public.soccer_manager_manager_stints
  for select to authenticated using ((select public.is_admin()));
grant select on public.soccer_manager_world_seasons to authenticated;
grant select on public.soccer_manager_manager_stints to authenticated;

-- The end of a season: saved dates, else estimated (see the header).
create or replace function public.world_season_end(p_world_id bigint, p_season integer)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  -- Every season lasts 21 weeks; a season's dates are its neighbour's shifted
  -- by whole seasons. The nearest season with saved dates is the anchor.
  select anchor.end_date + (p_season - anchor.season_num) * 147
  from public.soccer_manager_world_seasons anchor
  where anchor.game_world_id = p_world_id
  order by abs(anchor.season_num - p_season), anchor.season_num desc
  limit 1;
$$;

revoke all on function public.world_season_end(bigint, integer) from public, anon, authenticated;
grant execute on function public.world_season_end(bigint, integer) to service_role;

-- The manager of a club when a season ended: the spell that covered a few days
-- before the season's end date (the last matches), latest start first.
create or replace function public.world_season_club_manager(p_world_id bigint, p_season integer, p_club text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with season_end as (
    select public.world_season_end(p_world_id, p_season) - 4 as reference
  )
  select trim(stint.manager_name)
  from public.soccer_manager_manager_stints stint, season_end
  where season_end.reference is not null
    and stint.game_world_id = p_world_id
    and lower(trim(stint.club_name)) = lower(trim(p_club))
    and stint.started_at::date <= season_end.reference
    and (stint.ended_at is null or stint.ended_at::date >= season_end.reference)
  order by stint.started_at desc
  limit 1;
$$;

revoke all on function public.world_season_club_manager(bigint, integer, text) from public, anon, authenticated;
grant execute on function public.world_season_club_manager(bigint, integer, text) to service_role;

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
    -- The manager in charge when the season ended (Soccer Manager profile
    -- histories), else the name entered for that row, else an honour won by the
    -- club that season.
    select t.season_num, t.division, t.position, t.team, t.played, t.won, t.drawn, t.lost,
           t.goals_for, t.goals_against, t.goal_difference, t.points,
           coalesce(
             public.world_season_club_manager(t.game_world_id, t.season_num, t.team),
             t.manager,
             (
               select h.manager_name
               from public.soccer_manager_world_honours h
               where h.game_world_id = t.game_world_id
                 and h.season_num = t.season_num
                 and h.manager_name is not null
                 and (h.club_source_id = t.club_source_id or (t.club_source_id is null and h.club_name = t.team))
               order by h.display_order
               limit 1
             )
           ) as manager,
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

-- Saves the current season's dates and the spells of the managers whose histories
-- were read. Each read manager's spells in this world replace what was stored.
create or replace function public.save_soccer_manager_world_managers(
  target_setup_id text,
  target_history jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_id text := nullif(trim(target_setup_id), '');
  v_world_id bigint;
  v_season jsonb := target_history->'season';
  v_season_num integer;
  v_start date;
  v_end date;
  v_ids text[];
  v_stints integer := 0;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if setup_id is null or setup_id !~ '^[0-9]+$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;
  if jsonb_typeof(target_history) is distinct from 'object' then
    raise exception 'target_history must be an object';
  end if;

  select id into v_world_id from public.game_worlds where external_world_id = setup_id::bigint order by id limit 1;
  if v_world_id is null then
    raise exception 'No archived Soccer Manager world %', setup_id;
  end if;

  if jsonb_typeof(v_season) = 'object' then
    v_season_num := case when coalesce(v_season->>'seasonNum', '') ~ '^[0-9]{1,4}$' then (v_season->>'seasonNum')::integer end;
    v_start := case when coalesce(v_season->>'startDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_season->>'startDate')::date end;
    v_end := case when coalesce(v_season->>'endDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_season->>'endDate')::date end;
    if v_season_num >= 1 and v_start is not null and v_end is not null and v_end >= v_start then
      insert into public.soccer_manager_world_seasons (game_world_id, season_num, start_date, end_date, captured_at)
      values (v_world_id, v_season_num, v_start, v_end, now())
      on conflict (game_world_id, season_num) do update
        set start_date = excluded.start_date, end_date = excluded.end_date, captured_at = now();
    end if;
  end if;

  if jsonb_typeof(target_history->'managerIds') = 'array' then
    if jsonb_array_length(target_history->'managerIds') > 1000 then
      raise exception 'Save at most 1000 managers per call';
    end if;
    if jsonb_typeof(target_history->'stints') = 'array' and jsonb_array_length(target_history->'stints') > 5000 then
      raise exception 'Save at most 5000 spells per call';
    end if;

    select coalesce(array_agg(distinct value), array[]::text[]) into v_ids
    from jsonb_array_elements_text(target_history->'managerIds') value
    where value ~ '^[0-9]{1,20}$';

    delete from public.soccer_manager_manager_stints
    where game_world_id = v_world_id and sm_manager_id = any(v_ids);

    insert into public.soccer_manager_manager_stints
      (game_world_id, sm_manager_id, manager_name, club_name, started_at, ended_at, games, captured_at)
    select distinct on (manager_id, club_name, started_at)
      v_world_id, manager_id, manager_name, club_name, started_at,
      case when ended_at >= started_at then ended_at end, games, now()
    from (
      select
        item->>'managerId' as manager_id,
        left(nullif(trim(item->>'managerName'), ''), 160) as manager_name,
        left(nullif(trim(item->>'clubName'), ''), 160) as club_name,
        case when coalesce(item->>'startedAt', '') ~ '^[0-9]{9,11}$' then to_timestamp((item->>'startedAt')::bigint) end as started_at,
        case when coalesce(item->>'endedAt', '') ~ '^[0-9]{9,11}$' then to_timestamp((item->>'endedAt')::bigint) end as ended_at,
        case when coalesce(item->>'games', '') ~ '^[0-9]{1,6}$' then (item->>'games')::integer end as games
      from jsonb_array_elements(coalesce(target_history->'stints', '[]'::jsonb)) item
    ) parsed
    where manager_id = any(v_ids) and manager_name is not null and club_name is not null and started_at is not null
    order by manager_id, club_name, started_at;

    get diagnostics v_stints = row_count;
  end if;

  return jsonb_build_object('season', v_season_num, 'managers', coalesce(array_length(v_ids, 1), 0), 'stints', v_stints);
end;
$$;

revoke all on function public.save_soccer_manager_world_managers(text, jsonb) from public, anon;
grant execute on function public.save_soccer_manager_world_managers(text, jsonb) to authenticated, service_role;

reset check_function_bodies;
