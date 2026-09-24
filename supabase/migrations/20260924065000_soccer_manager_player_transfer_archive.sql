-- Player and transfer archive adapters for approved Soccer Manager canonical data.
-- Private by default: squad snapshots contain tactical/current-state fields that are not a public archive surface.

create table if not exists public.soccer_manager_players (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  source_player_id text not null,
  source_squad_player_id text,
  name text,
  surname text,
  nationality text,
  age integer,
  rating integer,
  position text,
  position_id integer,
  current_team_id bigint references public.teams(id) on delete set null,
  current_source_club_id text,
  value bigint,
  wages bigint,
  contract integer,
  morale integer,
  condition integer,
  foot text,
  appearances integer,
  substitute_appearances integer,
  average_performance numeric,
  goals integer,
  assists integer,
  goalkeeper boolean,
  youth boolean,
  transfer_listed boolean,
  photo text,
  rating_changed_at text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_world_id, source_player_id)
);

create index if not exists soccer_manager_players_world_team_idx
  on public.soccer_manager_players(game_world_id, current_team_id);

create index if not exists soccer_manager_players_world_rating_idx
  on public.soccer_manager_players(game_world_id, rating desc nulls last);

create index if not exists soccer_manager_players_current_team_idx
  on public.soccer_manager_players(current_team_id);

alter table public.soccer_manager_players enable row level security;

revoke all on table public.soccer_manager_players from anon, authenticated;
grant select on table public.soccer_manager_players to authenticated;
grant select, insert, update, delete on table public.soccer_manager_players to service_role;
grant usage, select on sequence public.soccer_manager_players_id_seq to service_role;

drop policy if exists "Global admins read Soccer Manager players" on public.soccer_manager_players;
create policy "Global admins read Soccer Manager players"
  on public.soccer_manager_players for select to authenticated
  using ((select public.is_admin()));

create table if not exists public.soccer_manager_player_snapshots (
  id bigint generated always as identity primary key,
  source_entity_key text not null,
  source_version integer not null check (source_version > 0),
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  player_id bigint not null references public.soccer_manager_players(id) on delete cascade,
  team_id bigint references public.teams(id) on delete set null,
  source_club_id text,
  age integer,
  rating integer,
  position text,
  position_id integer,
  nationality text,
  value bigint,
  wages bigint,
  contract integer,
  morale integer,
  condition integer,
  foot text,
  appearances integer,
  substitute_appearances integer,
  average_performance numeric,
  goals integer,
  assists integer,
  goalkeeper boolean,
  youth boolean,
  transfer_listed boolean,
  rating_changed_at text,
  captured_at timestamptz not null,
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_entity_key, source_version)
);

create index if not exists soccer_manager_player_snapshots_player_captured_idx
  on public.soccer_manager_player_snapshots(player_id, captured_at desc);

create index if not exists soccer_manager_player_snapshots_world_captured_idx
  on public.soccer_manager_player_snapshots(game_world_id, captured_at desc);

create index if not exists soccer_manager_player_snapshots_team_idx
  on public.soccer_manager_player_snapshots(team_id);

alter table public.soccer_manager_player_snapshots enable row level security;

revoke all on table public.soccer_manager_player_snapshots from anon, authenticated;
grant select on table public.soccer_manager_player_snapshots to authenticated;
grant select, insert, update, delete on table public.soccer_manager_player_snapshots to service_role;
grant usage, select on sequence public.soccer_manager_player_snapshots_id_seq to service_role;

drop policy if exists "Global admins read Soccer Manager player snapshots" on public.soccer_manager_player_snapshots;
create policy "Global admins read Soccer Manager player snapshots"
  on public.soccer_manager_player_snapshots for select to authenticated
  using ((select public.is_admin()));

create table if not exists public.soccer_manager_transfers (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  source_entity_key text not null unique,
  source_transfer_id text,
  source_version integer not null default 1 check (source_version > 0),
  player_id bigint not null references public.soccer_manager_players(id) on delete cascade,
  from_team_id bigint references public.teams(id) on delete set null,
  to_team_id bigint references public.teams(id) on delete set null,
  from_manager_id bigint references public.managers(id) on delete set null,
  to_manager_id bigint references public.managers(id) on delete set null,
  from_source_club_id text,
  from_club_name text,
  to_source_club_id text,
  to_club_name text,
  player_name text,
  player_surname text,
  rating integer,
  age integer,
  nationality text,
  position text,
  player_value bigint,
  amount bigint,
  accepted_date text,
  source_turn integer,
  status integer,
  status_label text,
  illegal boolean,
  illegal_reason text,
  player_offers jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists soccer_manager_transfers_world_seen_idx
  on public.soccer_manager_transfers(game_world_id, last_seen_at desc);

create index if not exists soccer_manager_transfers_player_idx
  on public.soccer_manager_transfers(player_id, last_seen_at desc);

create index if not exists soccer_manager_transfers_from_team_idx
  on public.soccer_manager_transfers(from_team_id, last_seen_at desc);

create index if not exists soccer_manager_transfers_to_team_idx
  on public.soccer_manager_transfers(to_team_id, last_seen_at desc);

create index if not exists soccer_manager_transfers_from_manager_idx
  on public.soccer_manager_transfers(from_manager_id, last_seen_at desc);

create index if not exists soccer_manager_transfers_to_manager_idx
  on public.soccer_manager_transfers(to_manager_id, last_seen_at desc);

alter table public.soccer_manager_transfers enable row level security;

revoke all on table public.soccer_manager_transfers from anon, authenticated;
grant select on table public.soccer_manager_transfers to authenticated;
grant select, insert, update, delete on table public.soccer_manager_transfers to service_role;
grant usage, select on sequence public.soccer_manager_transfers_id_seq to service_role;

drop policy if exists "Global admins read Soccer Manager transfers" on public.soccer_manager_transfers;
create policy "Global admins read Soccer Manager transfers"
  on public.soccer_manager_transfers for select to authenticated
  using ((select public.is_admin()));

create table if not exists public.soccer_manager_player_changes (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  source_entity_key text not null unique,
  source_version integer not null default 1 check (source_version > 0),
  player_id bigint not null references public.soccer_manager_players(id) on delete cascade,
  team_id bigint references public.teams(id) on delete set null,
  source_club_id text,
  event_kind text,
  change_type text,
  old_rating integer,
  new_rating integer,
  rating_difference integer,
  position text,
  position_id integer,
  old_position_id integer,
  new_position_id integer,
  value bigint,
  event_date text,
  source_turn integer,
  source_data jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists soccer_manager_player_changes_player_captured_idx
  on public.soccer_manager_player_changes(player_id, captured_at desc);

create index if not exists soccer_manager_player_changes_world_captured_idx
  on public.soccer_manager_player_changes(game_world_id, captured_at desc);

create index if not exists soccer_manager_player_changes_team_idx
  on public.soccer_manager_player_changes(team_id);

alter table public.soccer_manager_player_changes enable row level security;

revoke all on table public.soccer_manager_player_changes from anon, authenticated;
grant select on table public.soccer_manager_player_changes to authenticated;
grant select, insert, update, delete on table public.soccer_manager_player_changes to service_role;
grant usage, select on sequence public.soccer_manager_player_changes_id_seq to service_role;

drop policy if exists "Global admins read Soccer Manager player changes" on public.soccer_manager_player_changes;
create policy "Global admins read Soccer Manager player changes"
  on public.soccer_manager_player_changes for select to authenticated
  using ((select public.is_admin()));

create or replace function public.apply_soccer_manager_player_transfer_archive(
  target_setup_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id uuid := (select auth.uid());
  setup_id text := nullif(trim(target_setup_id), '');
  v_world_id bigint;
  row_data record;
  v_player_id bigint;
  v_source_player_id text;
  v_source_squad_player_id text;
  v_team_id bigint;
  v_from_team_id bigint;
  v_to_team_id bigint;
  v_from_manager_id bigint;
  v_to_manager_id bigint;
  v_source_club_id text;
  v_from_club_id text;
  v_to_club_id text;
  v_from_manager_source_id text;
  v_to_manager_source_id text;
  v_captured_at timestamptz;
  squad_players_applied integer := 0;
  player_snapshots_applied integer := 0;
  transfers_applied integer := 0;
  player_changes_applied integer := 0;
  unmapped_transfer_clubs integer := 0;
begin
  if user_id is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;

  if setup_id is null or setup_id !~ '^[0-9]+$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('soccer-manager-player-transfer-archive:' || setup_id, 0)
  );

  select id
    into v_world_id
  from public.game_worlds
  where external_world_id = setup_id::bigint
  order by id
  limit 1;

  if v_world_id is null then
    raise exception 'Apply the core Soccer Manager archive for world % first', setup_id;
  end if;

  -- Current squad state. playerDataId is the cross-surface player identity where available;
  -- playerId is retained as the world-specific squad identity.
  for row_data in
    select entity_key, data, version, last_approved_at
    from public.soccer_manager_canonical_entities
    where entity_type = 'squad_player'
      and data->>'setupId' = setup_id
    order by entity_key
  loop
    v_source_player_id := nullif(trim(coalesce(row_data.data->>'playerDataId', row_data.data->>'playerId')), '');
    v_source_squad_player_id := nullif(trim(row_data.data->>'playerId'), '');
    v_source_club_id := nullif(trim(row_data.data->>'clubId'), '');

    if v_source_player_id is null then
      continue;
    end if;

    v_team_id := null;
    if v_source_club_id is not null then
      select link.target_id
        into v_team_id
      from public.soccer_manager_archive_links link
      join public.teams team on team.id = link.target_id
      where link.source_type = 'club'
        and link.source_key = setup_id || ':' || v_source_club_id
        and link.target_type = 'team';
    end if;

    insert into public.soccer_manager_players (
      game_world_id, source_player_id, source_squad_player_id,
      name, surname, nationality, age, rating, position, position_id,
      current_team_id, current_source_club_id,
      value, wages, contract, morale, condition, foot,
      appearances, substitute_appearances, average_performance, goals, assists,
      goalkeeper, youth, transfer_listed, photo, rating_changed_at,
      last_seen_at, updated_at
    ) values (
      v_world_id, v_source_player_id, v_source_squad_player_id,
      nullif(trim(row_data.data->>'name'), ''),
      nullif(trim(row_data.data->>'surname'), ''),
      nullif(trim(row_data.data->>'nationality'), ''),
      case when coalesce(row_data.data->>'age','') ~ '^[0-9]+$' then (row_data.data->>'age')::integer else null end,
      case when coalesce(row_data.data->>'rating','') ~ '^[0-9]+$' then (row_data.data->>'rating')::integer else null end,
      nullif(trim(row_data.data->>'position'), ''),
      case when coalesce(row_data.data->>'positionId','') ~ '^[0-9]+$' then (row_data.data->>'positionId')::integer else null end,
      v_team_id, v_source_club_id,
      case when coalesce(row_data.data->>'value','') ~ '^[0-9]+$' then (row_data.data->>'value')::bigint else null end,
      case when coalesce(row_data.data->>'wages','') ~ '^[0-9]+$' then (row_data.data->>'wages')::bigint else null end,
      case when coalesce(row_data.data->>'contract','') ~ '^-?[0-9]+$' then (row_data.data->>'contract')::integer else null end,
      case when coalesce(row_data.data->>'morale','') ~ '^-?[0-9]+$' then (row_data.data->>'morale')::integer else null end,
      case when coalesce(row_data.data->>'condition','') ~ '^-?[0-9]+$' then (row_data.data->>'condition')::integer else null end,
      nullif(trim(row_data.data->>'foot'), ''),
      case when coalesce(row_data.data->>'appearances','') ~ '^-?[0-9]+$' then (row_data.data->>'appearances')::integer else null end,
      case when coalesce(row_data.data->>'substituteAppearances','') ~ '^-?[0-9]+$' then (row_data.data->>'substituteAppearances')::integer else null end,
      case when coalesce(row_data.data->>'averagePerformance','') ~ '^-?[0-9]+(?:\.[0-9]+)?$' then (row_data.data->>'averagePerformance')::numeric else null end,
      case when coalesce(row_data.data->>'goals','') ~ '^-?[0-9]+$' then (row_data.data->>'goals')::integer else null end,
      case when coalesce(row_data.data->>'assists','') ~ '^-?[0-9]+$' then (row_data.data->>'assists')::integer else null end,
      case when lower(coalesce(row_data.data->>'goalkeeper','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'goalkeeper','')) in ('false','0','no') then false else null end,
      case when lower(coalesce(row_data.data->>'youth','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'youth','')) in ('false','0','no') then false else null end,
      case when lower(coalesce(row_data.data->>'transferListed','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'transferListed','')) in ('false','0','no') then false else null end,
      nullif(trim(row_data.data->>'photo'), ''),
      nullif(trim(row_data.data->>'ratingChangedAt'), ''),
      coalesce(row_data.last_approved_at, now()),
      now()
    )
    on conflict (game_world_id, source_player_id) do update
      set source_squad_player_id = coalesce(excluded.source_squad_player_id, public.soccer_manager_players.source_squad_player_id),
          name = coalesce(excluded.name, public.soccer_manager_players.name),
          surname = coalesce(excluded.surname, public.soccer_manager_players.surname),
          nationality = coalesce(excluded.nationality, public.soccer_manager_players.nationality),
          age = excluded.age,
          rating = excluded.rating,
          position = excluded.position,
          position_id = excluded.position_id,
          current_team_id = excluded.current_team_id,
          current_source_club_id = excluded.current_source_club_id,
          value = excluded.value,
          wages = excluded.wages,
          contract = excluded.contract,
          morale = excluded.morale,
          condition = excluded.condition,
          foot = excluded.foot,
          appearances = excluded.appearances,
          substitute_appearances = excluded.substitute_appearances,
          average_performance = excluded.average_performance,
          goals = excluded.goals,
          assists = excluded.assists,
          goalkeeper = excluded.goalkeeper,
          youth = excluded.youth,
          transfer_listed = excluded.transfer_listed,
          photo = coalesce(excluded.photo, public.soccer_manager_players.photo),
          rating_changed_at = excluded.rating_changed_at,
          last_seen_at = greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at),
          updated_at = now()
    returning id into v_player_id;

    squad_players_applied := squad_players_applied + 1;
  end loop;

  -- Immutable snapshots from every approved squad-player state.
  for row_data in
    select approved.entity_key, approved.source_version, approved.captured_at, approved.data
    from (
      select
        change.entity_key,
        row_number() over (
          partition by change.entity_key
          order by coalesce(change.reviewed_at, run.captured_at, change.created_at), change.id
        )::integer as source_version,
        run.captured_at,
        change.after_data as data
      from public.soccer_manager_sync_changes change
      join public.soccer_manager_sync_runs run on run.id = change.run_id
      where change.entity_type = 'squad_player'
        and change.status = 'approved'
        and change.after_data->>'setupId' = setup_id
    ) approved
    order by approved.entity_key, approved.source_version
  loop
    v_source_player_id := nullif(trim(coalesce(row_data.data->>'playerDataId', row_data.data->>'playerId')), '');
    v_source_club_id := nullif(trim(row_data.data->>'clubId'), '');

    if v_source_player_id is null then
      continue;
    end if;

    select id
      into v_player_id
    from public.soccer_manager_players
    where game_world_id = v_world_id
      and source_player_id = v_source_player_id;

    if v_player_id is null then
      continue;
    end if;

    v_team_id := null;
    if v_source_club_id is not null then
      select link.target_id
        into v_team_id
      from public.soccer_manager_archive_links link
      join public.teams team on team.id = link.target_id
      where link.source_type='club'
        and link.source_key=setup_id || ':' || v_source_club_id
        and link.target_type='team';
    end if;

    insert into public.soccer_manager_player_snapshots (
      source_entity_key, source_version, game_world_id, player_id, team_id, source_club_id,
      age, rating, position, position_id, nationality, value, wages, contract, morale, condition, foot,
      appearances, substitute_appearances, average_performance, goals, assists,
      goalkeeper, youth, transfer_listed, rating_changed_at, captured_at, source_data
    ) values (
      row_data.entity_key, row_data.source_version, v_world_id, v_player_id, v_team_id, v_source_club_id,
      case when coalesce(row_data.data->>'age','') ~ '^[0-9]+$' then (row_data.data->>'age')::integer else null end,
      case when coalesce(row_data.data->>'rating','') ~ '^[0-9]+$' then (row_data.data->>'rating')::integer else null end,
      nullif(trim(row_data.data->>'position'),''),
      case when coalesce(row_data.data->>'positionId','') ~ '^[0-9]+$' then (row_data.data->>'positionId')::integer else null end,
      nullif(trim(row_data.data->>'nationality'),''),
      case when coalesce(row_data.data->>'value','') ~ '^[0-9]+$' then (row_data.data->>'value')::bigint else null end,
      case when coalesce(row_data.data->>'wages','') ~ '^[0-9]+$' then (row_data.data->>'wages')::bigint else null end,
      case when coalesce(row_data.data->>'contract','') ~ '^-?[0-9]+$' then (row_data.data->>'contract')::integer else null end,
      case when coalesce(row_data.data->>'morale','') ~ '^-?[0-9]+$' then (row_data.data->>'morale')::integer else null end,
      case when coalesce(row_data.data->>'condition','') ~ '^-?[0-9]+$' then (row_data.data->>'condition')::integer else null end,
      nullif(trim(row_data.data->>'foot'),''),
      case when coalesce(row_data.data->>'appearances','') ~ '^-?[0-9]+$' then (row_data.data->>'appearances')::integer else null end,
      case when coalesce(row_data.data->>'substituteAppearances','') ~ '^-?[0-9]+$' then (row_data.data->>'substituteAppearances')::integer else null end,
      case when coalesce(row_data.data->>'averagePerformance','') ~ '^-?[0-9]+(?:\.[0-9]+)?$' then (row_data.data->>'averagePerformance')::numeric else null end,
      case when coalesce(row_data.data->>'goals','') ~ '^-?[0-9]+$' then (row_data.data->>'goals')::integer else null end,
      case when coalesce(row_data.data->>'assists','') ~ '^-?[0-9]+$' then (row_data.data->>'assists')::integer else null end,
      case when lower(coalesce(row_data.data->>'goalkeeper','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'goalkeeper','')) in ('false','0','no') then false else null end,
      case when lower(coalesce(row_data.data->>'youth','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'youth','')) in ('false','0','no') then false else null end,
      case when lower(coalesce(row_data.data->>'transferListed','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'transferListed','')) in ('false','0','no') then false else null end,
      nullif(trim(row_data.data->>'ratingChangedAt'),''),
      coalesce(row_data.captured_at, now()),
      row_data.data
    )
    on conflict (source_entity_key, source_version) do nothing;

    if found then
      player_snapshots_applied := player_snapshots_applied + 1;
    end if;
  end loop;

  -- Latest transfer record for each stable transfer entity. A transfer may be observed before a squad capture,
  -- so a minimal player identity is created and later enriched by squad data.
  for row_data in
    select entity_key, data, version, last_approved_at
    from public.soccer_manager_canonical_entities
    where entity_type='transfer'
      and data->>'setupId'=setup_id
    order by entity_key
  loop
    v_source_player_id := nullif(trim(row_data.data->>'playerId'), '');
    if v_source_player_id is null then
      continue;
    end if;

    insert into public.soccer_manager_players (
      game_world_id, source_player_id, name, surname, nationality, age, rating, position, value,
      last_seen_at, updated_at
    ) values (
      v_world_id,
      v_source_player_id,
      nullif(trim(row_data.data->>'playerName'),''),
      nullif(trim(row_data.data->>'playerSurname'),''),
      nullif(trim(row_data.data->>'nationality'),''),
      case when coalesce(row_data.data->>'age','') ~ '^[0-9]+$' then (row_data.data->>'age')::integer else null end,
      case when coalesce(row_data.data->>'rating','') ~ '^[0-9]+$' then (row_data.data->>'rating')::integer else null end,
      nullif(trim(row_data.data->>'position'),''),
      case when coalesce(row_data.data->>'playerValue','') ~ '^[0-9]+$' then (row_data.data->>'playerValue')::bigint else null end,
      coalesce(row_data.last_approved_at, now()),
      now()
    )
    on conflict (game_world_id, source_player_id) do update
      set name=coalesce(public.soccer_manager_players.name, excluded.name),
          surname=coalesce(public.soccer_manager_players.surname, excluded.surname),
          nationality=coalesce(public.soccer_manager_players.nationality, excluded.nationality),
          age=coalesce(public.soccer_manager_players.age, excluded.age),
          rating=coalesce(public.soccer_manager_players.rating, excluded.rating),
          position=coalesce(public.soccer_manager_players.position, excluded.position),
          value=coalesce(public.soccer_manager_players.value, excluded.value),
          last_seen_at=greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at),
          updated_at=now()
    returning id into v_player_id;

    v_from_club_id := nullif(trim(row_data.data->>'fromClubId'),'');
    v_to_club_id := nullif(trim(row_data.data->>'toClubId'),'');
    v_from_team_id := null;
    v_to_team_id := null;

    if v_from_club_id is not null and v_from_club_id <> '0' then
      select link.target_id into v_from_team_id
      from public.soccer_manager_archive_links link
      join public.teams team on team.id=link.target_id
      where link.source_type='club'
        and link.source_key=setup_id || ':' || v_from_club_id
        and link.target_type='team';
      if v_from_team_id is null then unmapped_transfer_clubs := unmapped_transfer_clubs + 1; end if;
    end if;

    if v_to_club_id is not null and v_to_club_id <> '0' then
      select link.target_id into v_to_team_id
      from public.soccer_manager_archive_links link
      join public.teams team on team.id=link.target_id
      where link.source_type='club'
        and link.source_key=setup_id || ':' || v_to_club_id
        and link.target_type='team';
      if v_to_team_id is null then unmapped_transfer_clubs := unmapped_transfer_clubs + 1; end if;
    end if;

    v_from_manager_source_id := nullif(trim(row_data.data->>'fromManagerId'),'');
    v_to_manager_source_id := nullif(trim(row_data.data->>'toManagerId'),'');
    v_from_manager_id := null;
    v_to_manager_id := null;

    if v_from_manager_source_id is not null and v_from_manager_source_id <> '0' then
      select link.target_id into v_from_manager_id
      from public.soccer_manager_archive_links link
      join public.managers manager on manager.id=link.target_id
      where link.source_type='manager'
        and link.source_key=setup_id || ':' || v_from_manager_source_id
        and link.target_type='manager';
    end if;

    if v_to_manager_source_id is not null and v_to_manager_source_id <> '0' then
      select link.target_id into v_to_manager_id
      from public.soccer_manager_archive_links link
      join public.managers manager on manager.id=link.target_id
      where link.source_type='manager'
        and link.source_key=setup_id || ':' || v_to_manager_source_id
        and link.target_type='manager';
    end if;

    insert into public.soccer_manager_transfers (
      game_world_id, source_entity_key, source_transfer_id, source_version, player_id,
      from_team_id, to_team_id, from_manager_id, to_manager_id,
      from_source_club_id, from_club_name, to_source_club_id, to_club_name,
      player_name, player_surname, rating, age, nationality, position,
      player_value, amount, accepted_date, source_turn, status, status_label,
      illegal, illegal_reason, player_offers, first_seen_at, last_seen_at, source_data, updated_at
    ) values (
      v_world_id,
      row_data.entity_key,
      nullif(trim(row_data.data->>'transferId'),''),
      row_data.version,
      v_player_id,
      v_from_team_id, v_to_team_id, v_from_manager_id, v_to_manager_id,
      v_from_club_id, nullif(trim(row_data.data->>'fromClubName'),''),
      v_to_club_id, nullif(trim(row_data.data->>'toClubName'),''),
      nullif(trim(row_data.data->>'playerName'),''),
      nullif(trim(row_data.data->>'playerSurname'),''),
      case when coalesce(row_data.data->>'rating','') ~ '^[0-9]+$' then (row_data.data->>'rating')::integer else null end,
      case when coalesce(row_data.data->>'age','') ~ '^[0-9]+$' then (row_data.data->>'age')::integer else null end,
      nullif(trim(row_data.data->>'nationality'),''),
      nullif(trim(row_data.data->>'position'),''),
      case when coalesce(row_data.data->>'playerValue','') ~ '^[0-9]+$' then (row_data.data->>'playerValue')::bigint else null end,
      case when coalesce(row_data.data->>'amount','') ~ '^-?[0-9]+$' then (row_data.data->>'amount')::bigint else null end,
      nullif(trim(row_data.data->>'acceptedDate'),''),
      case when coalesce(row_data.data->>'turn','') ~ '^[0-9]+$' then (row_data.data->>'turn')::integer else null end,
      case when coalesce(row_data.data->>'status','') ~ '^-?[0-9]+$' then (row_data.data->>'status')::integer else null end,
      nullif(trim(row_data.data->>'statusLabel'),''),
      case when lower(coalesce(row_data.data->>'illegal','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'illegal','')) in ('false','0','no') then false else null end,
      nullif(trim(row_data.data->>'illegalReason'),''),
      coalesce(row_data.data->'playerOffers','[]'::jsonb),
      coalesce(row_data.last_approved_at, now()),
      coalesce(row_data.last_approved_at, now()),
      row_data.data,
      now()
    )
    on conflict (source_entity_key) do update
      set source_transfer_id=excluded.source_transfer_id,
          source_version=excluded.source_version,
          player_id=excluded.player_id,
          from_team_id=excluded.from_team_id,
          to_team_id=excluded.to_team_id,
          from_manager_id=excluded.from_manager_id,
          to_manager_id=excluded.to_manager_id,
          from_source_club_id=excluded.from_source_club_id,
          from_club_name=excluded.from_club_name,
          to_source_club_id=excluded.to_source_club_id,
          to_club_name=excluded.to_club_name,
          player_name=excluded.player_name,
          player_surname=excluded.player_surname,
          rating=excluded.rating,
          age=excluded.age,
          nationality=excluded.nationality,
          position=excluded.position,
          player_value=excluded.player_value,
          amount=excluded.amount,
          accepted_date=excluded.accepted_date,
          source_turn=excluded.source_turn,
          status=excluded.status,
          status_label=excluded.status_label,
          illegal=excluded.illegal,
          illegal_reason=excluded.illegal_reason,
          player_offers=excluded.player_offers,
          last_seen_at=greatest(public.soccer_manager_transfers.last_seen_at, excluded.last_seen_at),
          source_data=excluded.source_data,
          updated_at=now();

    transfers_applied := transfers_applied + 1;
  end loop;

  -- Occurrence-keyed player changes are immutable identities, but their normalized data can be corrected by a later approval.
  for row_data in
    select entity_key, data, version, last_approved_at
    from public.soccer_manager_canonical_entities
    where entity_type='player_change'
      and data->>'setupId'=setup_id
    order by entity_key
  loop
    v_source_player_id := nullif(trim(row_data.data->>'playerId'),'');
    if v_source_player_id is null then
      continue;
    end if;

    insert into public.soccer_manager_players (
      game_world_id, source_player_id, name, age, rating, position, position_id, nationality, value,
      last_seen_at, updated_at
    ) values (
      v_world_id, v_source_player_id,
      nullif(trim(row_data.data->>'name'),''),
      case when coalesce(row_data.data->>'age','') ~ '^[0-9]+$' then (row_data.data->>'age')::integer else null end,
      case when coalesce(row_data.data->>'rating','') ~ '^[0-9]+$' then (row_data.data->>'rating')::integer else null end,
      nullif(trim(row_data.data->>'position'),''),
      case when coalesce(row_data.data->>'positionId','') ~ '^[0-9]+$' then (row_data.data->>'positionId')::integer else null end,
      nullif(trim(row_data.data->>'nationality'),''),
      case when coalesce(row_data.data->>'value','') ~ '^[0-9]+$' then (row_data.data->>'value')::bigint else null end,
      coalesce(row_data.last_approved_at, now()),
      now()
    )
    on conflict (game_world_id, source_player_id) do update
      set name=coalesce(public.soccer_manager_players.name, excluded.name),
          age=coalesce(public.soccer_manager_players.age, excluded.age),
          rating=coalesce(public.soccer_manager_players.rating, excluded.rating),
          position=coalesce(public.soccer_manager_players.position, excluded.position),
          position_id=coalesce(public.soccer_manager_players.position_id, excluded.position_id),
          nationality=coalesce(public.soccer_manager_players.nationality, excluded.nationality),
          value=coalesce(public.soccer_manager_players.value, excluded.value),
          last_seen_at=greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at),
          updated_at=now()
    returning id into v_player_id;

    v_source_club_id := nullif(trim(row_data.data->>'clubId'),'');
    v_team_id := null;
    if v_source_club_id is not null and v_source_club_id <> '0' then
      select link.target_id into v_team_id
      from public.soccer_manager_archive_links link
      join public.teams team on team.id=link.target_id
      where link.source_type='club'
        and link.source_key=setup_id || ':' || v_source_club_id
        and link.target_type='team';
    end if;

    v_captured_at := coalesce(row_data.last_approved_at, now());

    insert into public.soccer_manager_player_changes (
      game_world_id, source_entity_key, source_version, player_id, team_id, source_club_id,
      event_kind, change_type, old_rating, new_rating, rating_difference,
      position, position_id, old_position_id, new_position_id, value,
      event_date, source_turn, source_data, captured_at, updated_at
    ) values (
      v_world_id, row_data.entity_key, row_data.version, v_player_id, v_team_id, v_source_club_id,
      nullif(trim(row_data.data->>'eventKind'),''),
      nullif(trim(row_data.data->>'changeType'),''),
      case when coalesce(row_data.data->>'oldRating','') ~ '^-?[0-9]+$' then (row_data.data->>'oldRating')::integer else null end,
      case when coalesce(row_data.data->>'newRating','') ~ '^-?[0-9]+$' then (row_data.data->>'newRating')::integer else null end,
      case when coalesce(row_data.data->>'ratingDifference','') ~ '^-?[0-9]+$' then (row_data.data->>'ratingDifference')::integer else null end,
      nullif(trim(row_data.data->>'position'),''),
      case when coalesce(row_data.data->>'positionId','') ~ '^[0-9]+$' then (row_data.data->>'positionId')::integer else null end,
      case when coalesce(row_data.data->>'oldPositionId','') ~ '^-?[0-9]+$' then (row_data.data->>'oldPositionId')::integer else null end,
      case when coalesce(row_data.data->>'newPositionId','') ~ '^-?[0-9]+$' then (row_data.data->>'newPositionId')::integer else null end,
      case when coalesce(row_data.data->>'value','') ~ '^-?[0-9]+$' then (row_data.data->>'value')::bigint else null end,
      nullif(trim(row_data.data->>'eventDate'),''),
      case when coalesce(row_data.data->>'turn','') ~ '^[0-9]+$' then (row_data.data->>'turn')::integer else null end,
      row_data.data,
      v_captured_at,
      now()
    )
    on conflict (source_entity_key) do update
      set source_version=excluded.source_version,
          player_id=excluded.player_id,
          team_id=excluded.team_id,
          source_club_id=excluded.source_club_id,
          event_kind=excluded.event_kind,
          change_type=excluded.change_type,
          old_rating=excluded.old_rating,
          new_rating=excluded.new_rating,
          rating_difference=excluded.rating_difference,
          position=excluded.position,
          position_id=excluded.position_id,
          old_position_id=excluded.old_position_id,
          new_position_id=excluded.new_position_id,
          value=excluded.value,
          event_date=excluded.event_date,
          source_turn=excluded.source_turn,
          source_data=excluded.source_data,
          captured_at=excluded.captured_at,
          updated_at=now();

    player_changes_applied := player_changes_applied + 1;
  end loop;

  insert into public.audit_log(entity_type, entity_id, action, new_data, changed_by)
  values (
    'soccer_manager_archive',
    v_world_id,
    'apply_player_transfer_archive',
    jsonb_build_object(
      'setupId', setup_id,
      'squadPlayers', squad_players_applied,
      'playerSnapshots', player_snapshots_applied,
      'transfers', transfers_applied,
      'playerChanges', player_changes_applied,
      'unmappedTransferClubs', unmapped_transfer_clubs
    ),
    user_id::text
  );

  return jsonb_build_object(
    'setupId', setup_id,
    'gameWorldId', v_world_id,
    'squadPlayers', squad_players_applied,
    'playerSnapshots', player_snapshots_applied,
    'transfers', transfers_applied,
    'playerChanges', player_changes_applied,
    'unmappedTransferClubs', unmapped_transfer_clubs
  );
end;
$$;

revoke all on function public.apply_soccer_manager_player_transfer_archive(text) from public, anon;
grant execute on function public.apply_soccer_manager_player_transfer_archive(text) to authenticated, service_role;
