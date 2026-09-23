-- First archive adapter from approved Soccer Manager canonical entities into the Top 100 archive.
-- This is intentionally explicit and idempotent: running a sync never applies archive writes by itself.

create table if not exists public.soccer_manager_archive_links (
  source_type text not null,
  source_key text not null,
  target_type text not null check (target_type in ('game_world','team','manager','season')),
  target_id bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_type, source_key)
);

alter table public.soccer_manager_archive_links enable row level security;

revoke all on table public.soccer_manager_archive_links from anon, authenticated;
grant select on table public.soccer_manager_archive_links to authenticated;
grant select, insert, update, delete on table public.soccer_manager_archive_links to service_role;

drop policy if exists "Global admins read Soccer Manager archive links" on public.soccer_manager_archive_links;
create policy "Global admins read Soccer Manager archive links"
  on public.soccer_manager_archive_links for select to authenticated
  using ((select public.is_admin()));

create table if not exists public.league_standing_snapshots (
  id bigint generated always as identity primary key,
  source_entity_key text not null,
  source_version integer not null check (source_version > 0),
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  league_id text,
  division integer,
  team_id bigint not null references public.teams(id) on delete cascade,
  position integer,
  previous_position integer,
  played integer,
  won integer,
  drawn integer,
  lost integer,
  goals_for integer,
  goals_against integer,
  goal_difference integer,
  points integer,
  attendance integer,
  form jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_entity_key, source_version)
);

create index if not exists league_standing_snapshots_world_captured_idx
  on public.league_standing_snapshots(game_world_id, captured_at desc);

create index if not exists league_standing_snapshots_team_captured_idx
  on public.league_standing_snapshots(team_id, captured_at desc);

alter table public.league_standing_snapshots enable row level security;

revoke all on table public.league_standing_snapshots from anon, authenticated;
grant select on table public.league_standing_snapshots to anon, authenticated;
grant select, insert, update, delete on table public.league_standing_snapshots to service_role;
grant usage, select on sequence public.league_standing_snapshots_id_seq to service_role;

drop policy if exists "Public reads league standing snapshots" on public.league_standing_snapshots;
create policy "Public reads league standing snapshots"
  on public.league_standing_snapshots for select to anon, authenticated
  using (true);

alter table public.achievements
  add column if not exists game_world_id bigint references public.game_worlds(id) on delete set null,
  add column if not exists season_id bigint references public.seasons(id) on delete set null,
  add column if not exists source text,
  add column if not exists source_key text;

create unique index if not exists achievements_source_key_uidx
  on public.achievements(source, source_key);

create index if not exists achievements_game_world_season_idx
  on public.achievements(game_world_id, season_id);

create or replace function public.apply_soccer_manager_core_archive(
  target_setup_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id uuid := (select auth.uid());
  setup_id text := nullif(trim(target_setup_id), '');
  world_count integer;
  v_world_id bigint;
  world_data jsonb;
  row_data record;
  v_club_id text;
  v_club_name text;
  v_manager_source_id text;
  v_manager_name text;
  v_team_id bigint;
  v_manager_id bigint;
  v_season_id bigint;
  v_season_number integer;
  v_case_matches integer;
  clubs_applied integer := 0;
  managers_applied integer := 0;
  assignments_applied integer := 0;
  seasons_applied integer := 0;
  honours_applied integer := 0;
  standings_applied integer := 0;
  skipped_assignments integer := 0;
begin
  if user_id is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;

  if setup_id is null then
    select count(*)::integer, min(entity_key)
      into world_count, setup_id
    from public.soccer_manager_canonical_entities
    where entity_type = 'world';

    if world_count = 0 then
      raise exception 'No approved Soccer Manager world is available';
    elsif world_count > 1 then
      raise exception 'More than one approved Soccer Manager world exists; choose a setup id explicitly';
    end if;
  end if;

  if setup_id !~ '^[0-9]+$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('soccer-manager-core-archive:' || setup_id, 0)
  );

  select data
    into world_data
  from public.soccer_manager_canonical_entities
  where entity_type = 'world'
    and entity_key = setup_id;

  if not found then
    raise exception 'Approved Soccer Manager world % was not found', setup_id;
  end if;

  select id
    into v_world_id
  from public.game_worlds
  where external_world_id = setup_id::bigint
  order by id
  limit 1;

  if v_world_id is null then
    insert into public.game_worlds (
      name,
      slug,
      description,
      display_order,
      is_active,
      external_world_id
    ) values (
      'Soccer Manager World ' || setup_id,
      'sm-world-' || setup_id,
      'Created from the approved Soccer Manager canonical source layer.',
      100,
      true,
      setup_id::bigint
    )
    returning id into v_world_id;
  else
    update public.game_worlds
      set is_active = true
    where id = v_world_id;
  end if;

  insert into public.soccer_manager_archive_links (
    source_type, source_key, target_type, target_id
  ) values (
    'world', setup_id, 'game_world', v_world_id
  )
  on conflict (source_type, source_key) do update
    set target_type = excluded.target_type,
        target_id = excluded.target_id,
        updated_at = now();

  -- Current clubs come from approved standing entities. Stable SM club ids are
  -- kept in club_key; the existing trigger mirrors names into public.teams.
  for row_data in
    select entity_key, data
    from public.soccer_manager_canonical_entities
    where entity_type = 'standing'
      and data->>'setupId' = setup_id
    order by entity_key
  loop
    v_club_id := nullif(trim(row_data.data->>'clubId'), '');
    v_club_name := nullif(trim(row_data.data->>'name'), '');
    if v_club_id is null or v_club_name is null then
      continue;
    end if;

    insert into public.game_world_clubs (
      game_world_id,
      club_name,
      club_key,
      occupied,
      division,
      active,
      updated_at
    ) values (
      v_world_id,
      v_club_name,
      'sm:' || v_club_id,
      case when lower(coalesce(row_data.data->>'managed', '')) in ('1','true','yes') then true else false end,
      case when coalesce(row_data.data->>'division', '') ~ '^[0-9]+$'
        then (row_data.data->>'division')::integer else null end,
      true,
      now()
    )
    on conflict (game_world_id, club_key) do update
      set club_name = excluded.club_name,
          occupied = excluded.occupied,
          division = excluded.division,
          active = true,
          updated_at = now();

    select count(*)::integer, min(id)
      into v_case_matches, v_team_id
    from public.teams
    where lower(name) = lower(v_club_name);

    if v_case_matches = 0 then
      insert into public.teams(name, active)
      values (v_club_name, true)
      returning id into v_team_id;
    elsif v_case_matches > 1 then
      raise exception 'Ambiguous Top 100 team match for Soccer Manager club % (%)', v_club_name, v_club_id;
    end if;

    insert into public.soccer_manager_archive_links (
      source_type, source_key, target_type, target_id
    ) values (
      'club', setup_id || ':' || v_club_id, 'team', v_team_id
    )
    on conflict (source_type, source_key) do update
      set target_type = excluded.target_type,
          target_id = excluded.target_id,
          updated_at = now();

    clubs_applied := clubs_applied + 1;
  end loop;

  -- Stable manager ids are mapped once. Exact case-insensitive name matching is
  -- used only for the first link; an ambiguous existing archive match is refused.
  for row_data in
    select entity_key, data
    from public.soccer_manager_canonical_entities
    where entity_type = 'manager_assignment'
      and data->>'setupId' = setup_id
    order by entity_key
  loop
    v_manager_source_id := nullif(trim(row_data.data->>'managerId'), '');
    v_manager_name := nullif(trim(row_data.data->>'displayName'), '');
    v_club_id := nullif(trim(row_data.data->>'clubId'), '');

    if v_manager_source_id is null or v_manager_name is null or v_club_id is null then
      continue;
    end if;

    select target_id
      into v_manager_id
    from public.soccer_manager_archive_links
    where source_type = 'manager'
      and source_key = setup_id || ':' || v_manager_source_id
      and target_type = 'manager';

    if v_manager_id is not null
       and not exists (select 1 from public.managers where id = v_manager_id) then
      delete from public.soccer_manager_archive_links
      where source_type = 'manager'
        and source_key = setup_id || ':' || v_manager_source_id;
      v_manager_id := null;
    end if;

    if v_manager_id is null then
      select count(*)::integer, min(id)
        into v_case_matches, v_manager_id
      from public.managers
      where lower(coalesce(display_name, canonical_name, name)) = lower(v_manager_name);

      if v_case_matches = 0 then
        insert into public.managers(name, canonical_name, display_name, active)
        values (v_manager_name, v_manager_name, v_manager_name, true)
        returning id into v_manager_id;
      elsif v_case_matches > 1 then
        raise exception 'Ambiguous Top 100 manager match for Soccer Manager manager % (%)', v_manager_name, v_manager_source_id;
      end if;

      insert into public.soccer_manager_archive_links (
        source_type, source_key, target_type, target_id
      ) values (
        'manager', setup_id || ':' || v_manager_source_id, 'manager', v_manager_id
      )
      on conflict (source_type, source_key) do update
        set target_type = excluded.target_type,
            target_id = excluded.target_id,
            updated_at = now();
    else
      update public.managers
        set name = coalesce(nullif(name, ''), v_manager_name),
            canonical_name = coalesce(nullif(canonical_name, ''), v_manager_name),
            display_name = v_manager_name,
            active = true
      where id = v_manager_id;
    end if;

    managers_applied := managers_applied + 1;

    select target_id
      into v_team_id
    from public.soccer_manager_archive_links
    where source_type = 'club'
      and source_key = setup_id || ':' || v_club_id
      and target_type = 'team';

    if v_team_id is null then
      skipped_assignments := skipped_assignments + 1;
      continue;
    end if;

    update public.game_world_clubs
      set current_manager_name = v_manager_name,
          manager_key = 'sm:' || v_manager_source_id,
          occupied = true,
          updated_at = now()
    where game_world_id = v_world_id
      and club_key = 'sm:' || v_club_id;

    update public.manager_clubs mc
      set current_club = false
    where mc.team_id = v_team_id
      and mc.current_club = true
      and mc.manager_id is distinct from v_manager_id;

    if not exists (
      select 1
      from public.manager_clubs mc
      where mc.manager_id = v_manager_id
        and mc.team_id = v_team_id
        and mc.current_club = true
    ) then
      insert into public.manager_clubs (
        manager_id, team_id, current_club, appointment_type, notes
      ) values (
        v_manager_id, v_team_id, true, 'manager',
        'Applied from approved Soccer Manager manager assignment.'
      );
    end if;

    assignments_applied := assignments_applied + 1;
  end loop;

  -- Historical season winners become season records plus league-title achievements.
  for row_data in
    select entity_key, data
    from public.soccer_manager_canonical_entities
    where entity_type = 'season_history'
      and data->>'setupId' = setup_id
    order by
      case when coalesce(data->>'season', '') ~ '^[0-9]+$'
        then (data->>'season')::integer else null end nulls last,
      entity_key
  loop
    if coalesce(row_data.data->>'season', '') !~ '^[0-9]+$' then
      continue;
    end if;

    v_season_number := (row_data.data->>'season')::integer;

    insert into public.seasons(code, number)
    values ('S' || v_season_number, v_season_number)
    on conflict (code) do update
      set number = excluded.number
    returning id into v_season_id;

    insert into public.soccer_manager_archive_links (
      source_type, source_key, target_type, target_id
    ) values (
      'season', setup_id || ':' || coalesce(row_data.data->>'seasonId', v_season_number::text), 'season', v_season_id
    )
    on conflict (source_type, source_key) do update
      set target_type = excluded.target_type,
          target_id = excluded.target_id,
          updated_at = now();

    seasons_applied := seasons_applied + 1;

    v_club_id := nullif(trim(row_data.data->>'winnerClubId'), '');
    v_club_name := nullif(trim(row_data.data->>'winnerClubName'), '');
    v_team_id := null;

    if v_club_id is not null then
      select target_id
        into v_team_id
      from public.soccer_manager_archive_links
      where source_type = 'club'
        and source_key = setup_id || ':' || v_club_id
        and target_type = 'team';
    end if;

    if v_team_id is null and v_club_name is not null then
      select count(*)::integer, min(id)
        into v_case_matches, v_team_id
      from public.teams
      where lower(name) = lower(v_club_name);

      if v_case_matches = 0 then
        insert into public.teams(name, active)
        values (v_club_name, true)
        returning id into v_team_id;
      elsif v_case_matches > 1 then
        raise exception 'Ambiguous historical Top 100 team match for %', v_club_name;
      end if;

      if v_club_id is not null then
        insert into public.soccer_manager_archive_links (
          source_type, source_key, target_type, target_id
        ) values (
          'club', setup_id || ':' || v_club_id, 'team', v_team_id
        )
        on conflict (source_type, source_key) do update
          set target_type = excluded.target_type,
              target_id = excluded.target_id,
              updated_at = now();
      end if;
    end if;

    v_manager_source_id := nullif(trim(row_data.data->>'winnerManagerId'), '');
    v_manager_name := nullif(trim(row_data.data->>'winnerManagerName'), '');
    v_manager_id := null;

    if v_manager_source_id is not null then
      select target_id
        into v_manager_id
      from public.soccer_manager_archive_links
      where source_type = 'manager'
        and source_key = setup_id || ':' || v_manager_source_id
        and target_type = 'manager';
    end if;

    if v_manager_id is null and v_manager_name is not null then
      select count(*)::integer, min(id)
        into v_case_matches, v_manager_id
      from public.managers
      where lower(coalesce(display_name, canonical_name, name)) = lower(v_manager_name);

      if v_case_matches = 0 then
        insert into public.managers(name, canonical_name, display_name, active)
        values (v_manager_name, v_manager_name, v_manager_name, true)
        returning id into v_manager_id;
      elsif v_case_matches > 1 then
        raise exception 'Ambiguous historical Top 100 manager match for %', v_manager_name;
      end if;

      if v_manager_source_id is not null then
        insert into public.soccer_manager_archive_links (
          source_type, source_key, target_type, target_id
        ) values (
          'manager', setup_id || ':' || v_manager_source_id, 'manager', v_manager_id
        )
        on conflict (source_type, source_key) do update
          set target_type = excluded.target_type,
              target_id = excluded.target_id,
              updated_at = now();
      end if;
    end if;

    if v_team_id is not null then
      insert into public.achievements (
        game_world_id,
        season_id,
        team_id,
        manager_id,
        achievement_type,
        title,
        position,
        notes,
        source,
        source_key
      ) values (
        v_world_id,
        v_season_id,
        v_team_id,
        v_manager_id,
        'league_title',
        'Season S' || v_season_number || ' league champion',
        1,
        'Imported from approved Soccer Manager season history.',
        'soccer_manager',
        'season_history:' || row_data.entity_key
      )
      on conflict (source, source_key) do update
        set game_world_id = excluded.game_world_id,
            season_id = excluded.season_id,
            team_id = excluded.team_id,
            manager_id = excluded.manager_id,
            title = excluded.title,
            position = excluded.position,
            notes = excluded.notes;

      honours_applied := honours_applied + 1;
    end if;
  end loop;

  -- Preserve every approved standing change, not only the latest canonical row.
  -- This lets the adapter catch up after several reviews without losing intermediate tables.
  for row_data in
    select
      change.entity_key,
      coalesce(change.baseline_version, 0) + 1 as source_version,
      run.captured_at,
      change.after_data as data
    from public.soccer_manager_sync_changes change
    join public.soccer_manager_sync_runs run on run.id = change.run_id
    where change.entity_type = 'standing'
      and change.status = 'approved'
      and change.after_data->>'setupId' = setup_id
    order by change.entity_key, coalesce(change.baseline_version, 0) + 1, change.id
  loop
    v_club_id := nullif(trim(row_data.data->>'clubId'), '');
    if v_club_id is null then
      continue;
    end if;

    select target_id
      into v_team_id
    from public.soccer_manager_archive_links
    where source_type = 'club'
      and source_key = setup_id || ':' || v_club_id
      and target_type = 'team';

    if v_team_id is null then
      continue;
    end if;

    insert into public.league_standing_snapshots (
      source_entity_key,
      source_version,
      game_world_id,
      league_id,
      division,
      team_id,
      position,
      previous_position,
      played,
      won,
      drawn,
      lost,
      goals_for,
      goals_against,
      goal_difference,
      points,
      attendance,
      form,
      captured_at
    ) values (
      row_data.entity_key,
      row_data.source_version,
      v_world_id,
      nullif(row_data.data->>'leagueId', ''),
      case when coalesce(row_data.data->>'division', '') ~ '^[0-9]+$' then (row_data.data->>'division')::integer else null end,
      v_team_id,
      case when coalesce(row_data.data->>'position', '') ~ '^-?[0-9]+$' then (row_data.data->>'position')::integer else null end,
      case when coalesce(row_data.data->>'previousPosition', '') ~ '^-?[0-9]+$' then (row_data.data->>'previousPosition')::integer else null end,
      case when coalesce(row_data.data->>'played', '') ~ '^-?[0-9]+$' then (row_data.data->>'played')::integer else null end,
      case when coalesce(row_data.data->>'won', '') ~ '^-?[0-9]+$' then (row_data.data->>'won')::integer else null end,
      case when coalesce(row_data.data->>'drawn', '') ~ '^-?[0-9]+$' then (row_data.data->>'drawn')::integer else null end,
      case when coalesce(row_data.data->>'lost', '') ~ '^-?[0-9]+$' then (row_data.data->>'lost')::integer else null end,
      case when coalesce(row_data.data->>'goalsFor', '') ~ '^-?[0-9]+$' then (row_data.data->>'goalsFor')::integer else null end,
      case when coalesce(row_data.data->>'goalsAgainst', '') ~ '^-?[0-9]+$' then (row_data.data->>'goalsAgainst')::integer else null end,
      case when coalesce(row_data.data->>'goalDifference', '') ~ '^-?[0-9]+$' then (row_data.data->>'goalDifference')::integer else null end,
      case when coalesce(row_data.data->>'points', '') ~ '^-?[0-9]+$' then (row_data.data->>'points')::integer else null end,
      case when coalesce(row_data.data->>'attendance', '') ~ '^-?[0-9]+$' then (row_data.data->>'attendance')::integer else null end,
      coalesce(row_data.data->'form', '[]'::jsonb),
      coalesce(row_data.captured_at, now())
    )
    on conflict (source_entity_key, source_version) do nothing;

    if found then
      standings_applied := standings_applied + 1;
    end if;
  end loop;

  insert into public.audit_log (
    entity_type,
    entity_id,
    action,
    new_data,
    changed_by
  ) values (
    'soccer_manager_archive',
    v_world_id,
    'apply_core_archive',
    jsonb_build_object(
      'setupId', setup_id,
      'clubs', clubs_applied,
      'managers', managers_applied,
      'assignments', assignments_applied,
      'seasons', seasons_applied,
      'leagueTitles', honours_applied,
      'standingSnapshots', standings_applied,
      'skippedAssignments', skipped_assignments
    ),
    user_id::text
  );

  return jsonb_build_object(
    'setupId', setup_id,
    'gameWorldId', v_world_id,
    'clubs', clubs_applied,
    'managers', managers_applied,
    'assignments', assignments_applied,
    'seasons', seasons_applied,
    'leagueTitles', honours_applied,
    'standingSnapshots', standings_applied,
    'skippedAssignments', skipped_assignments
  );
end;
$$;

revoke all on function public.apply_soccer_manager_core_archive(text) from public, anon;
grant execute on function public.apply_soccer_manager_core_archive(text) to authenticated, service_role;
