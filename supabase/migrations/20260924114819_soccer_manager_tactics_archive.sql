-- Immutable private archive for approved Soccer Manager tactics captures.

create table if not exists public.soccer_manager_tactics_snapshots (
  id bigint generated always as identity primary key,
  source_entity_key text not null,
  source_version integer not null check (source_version > 0),
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  team_id bigint references public.teams(id) on delete set null,
  source_club_id text not null,
  turn_date text,
  formation_id text,
  instructions jsonb not null default '{}'::jsonb,
  players jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null,
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_entity_key, source_version)
);

create index if not exists soccer_manager_tactics_snapshots_world_captured_idx
  on public.soccer_manager_tactics_snapshots(game_world_id, captured_at desc);

create index if not exists soccer_manager_tactics_snapshots_team_captured_idx
  on public.soccer_manager_tactics_snapshots(team_id, captured_at desc);

alter table public.soccer_manager_tactics_snapshots enable row level security;

revoke all on table public.soccer_manager_tactics_snapshots from anon, authenticated;
grant select on table public.soccer_manager_tactics_snapshots to authenticated;
grant select, insert, update, delete on table public.soccer_manager_tactics_snapshots to service_role;
grant usage, select on sequence public.soccer_manager_tactics_snapshots_id_seq to service_role;

drop policy if exists "Global admins read Soccer Manager tactics snapshots"
  on public.soccer_manager_tactics_snapshots;
create policy "Global admins read Soccer Manager tactics snapshots"
  on public.soccer_manager_tactics_snapshots for select to authenticated
  using ((select public.is_admin()));

create or replace function public.apply_soccer_manager_tactics_archive(
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
  v_team_id bigint;
  v_source_club_id text;
  row_data record;
  snapshots_applied integer := 0;
  unmapped_clubs integer := 0;
begin
  if user_id is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;

  if setup_id is null or setup_id !~ '^[0-9]+$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('soccer-manager-tactics-archive:' || setup_id, 0)
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

  for row_data in
    select
      approved.entity_key,
      approved.source_version,
      approved.captured_at,
      approved.data
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
      where change.entity_type = 'tactics_snapshot'
        and change.status = 'approved'
        and change.after_data->>'setupId' = setup_id
    ) approved
    order by approved.entity_key, approved.source_version
  loop
    v_source_club_id := nullif(trim(row_data.data->>'clubId'), '');
    if v_source_club_id is null then
      continue;
    end if;

    v_team_id := null;
    select link.target_id
      into v_team_id
    from public.soccer_manager_archive_links link
    join public.teams team on team.id = link.target_id
    where link.source_type = 'club'
      and link.source_key = setup_id || ':' || v_source_club_id
      and link.target_type = 'team';

    if v_team_id is null then
      unmapped_clubs := unmapped_clubs + 1;
    end if;

    insert into public.soccer_manager_tactics_snapshots (
      source_entity_key,
      source_version,
      game_world_id,
      team_id,
      source_club_id,
      turn_date,
      formation_id,
      instructions,
      players,
      captured_at,
      source_data
    ) values (
      row_data.entity_key,
      row_data.source_version,
      v_world_id,
      v_team_id,
      v_source_club_id,
      nullif(trim(row_data.data->>'turnDate'), ''),
      nullif(trim(row_data.data->>'formationId'), ''),
      coalesce(row_data.data->'instructions', '{}'::jsonb),
      coalesce(row_data.data->'players', '[]'::jsonb),
      coalesce(row_data.captured_at, now()),
      row_data.data
    )
    on conflict (source_entity_key, source_version) do nothing;

    if found then
      snapshots_applied := snapshots_applied + 1;
    end if;
  end loop;

  insert into public.audit_log(entity_type, entity_id, action, new_data, changed_by)
  values (
    'soccer_manager_archive',
    v_world_id,
    'apply_tactics_archive',
    jsonb_build_object(
      'setupId', setup_id,
      'snapshotsApplied', snapshots_applied,
      'unmappedClubs', unmapped_clubs
    ),
    user_id::text
  );

  return jsonb_build_object(
    'setupId', setup_id,
    'gameWorldId', v_world_id,
    'tacticsSnapshots', snapshots_applied,
    'unmappedClubs', unmapped_clubs
  );
end;
$$;

revoke all on function public.apply_soccer_manager_tactics_archive(text) from public, anon;
grant execute on function public.apply_soccer_manager_tactics_archive(text) to authenticated, service_role;
