-- Bounded adapter for large approved Soccer Manager match imports.
-- Processes a stable entity-key window per transaction so world-scale archives do not hit statement timeouts.

create or replace function public.apply_soccer_manager_match_archive_batch(
  target_setup_id text,
  target_after_entity_key text default null,
  target_limit integer default 25
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
  v_snapshot_id bigint;
  v_home_team_id bigint;
  v_away_team_id bigint;
  v_home_source_club_id text;
  v_away_source_club_id text;
  row_data record;
  child jsonb;
  snapshots_applied integer := 0;
  players_applied integer := 0;
  events_applied integer := 0;
  domination_applied integer := 0;
  world_scores_applied integer := 0;
  unmapped_clubs integer := 0;
  batch_limit integer := greatest(1, least(coalesce(target_limit, 25), 100));
  after_entity_key text := coalesce(target_after_entity_key, '');
  last_entity_key text := null;
  has_more boolean := false;
begin
  if user_id is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;

  if setup_id is null or setup_id !~ '^[0-9]+$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('soccer-manager-match-archive:' || setup_id, 0)
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
    with candidate_keys as (
      select distinct change.entity_key
      from public.soccer_manager_sync_changes change
      where change.entity_type = 'match_snapshot'
        and change.status = 'approved'
        and change.after_data->'source'->>'setupId' = setup_id
        and change.entity_key > after_entity_key
      order by change.entity_key
      limit batch_limit
    )
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
      join candidate_keys keys on keys.entity_key = change.entity_key
      where change.entity_type = 'match_snapshot'
        and change.status = 'approved'
        and change.after_data->'source'->>'setupId' = setup_id
    ) approved
    order by approved.entity_key, approved.source_version
  loop
    last_entity_key := row_data.entity_key;
    if nullif(trim(row_data.data->'source'->>'fixtureId'), '') is null then
      continue;
    end if;

    v_home_source_club_id := nullif(trim(row_data.data->'fixture'->>'homeClubId'), '');
    v_away_source_club_id := nullif(trim(row_data.data->'fixture'->>'awayClubId'), '');
    if v_home_source_club_id is null or v_away_source_club_id is null then
      continue;
    end if;

    v_home_team_id := null;
    select link.target_id
      into v_home_team_id
    from public.soccer_manager_archive_links link
    where link.source_type = 'club'
      and link.source_key = setup_id || ':' || v_home_source_club_id
      and link.target_type = 'team';

    v_away_team_id := null;
    select link.target_id
      into v_away_team_id
    from public.soccer_manager_archive_links link
    where link.source_type = 'club'
      and link.source_key = setup_id || ':' || v_away_source_club_id
      and link.target_type = 'team';

    if v_home_team_id is null then unmapped_clubs := unmapped_clubs + 1; end if;
    if v_away_team_id is null then unmapped_clubs := unmapped_clubs + 1; end if;

    v_snapshot_id := null;

    insert into public.soccer_manager_match_snapshots (
      source_entity_key,
      source_version,
      game_world_id,
      source_fixture_id,
      competition_code,
      competition_name,
      home_team_id,
      away_team_id,
      home_source_club_id,
      away_source_club_id,
      home_name,
      away_name,
      home_score,
      away_score,
      captured_at,
      source_data
    ) values (
      row_data.entity_key,
      row_data.source_version,
      v_world_id,
      row_data.data->'source'->>'fixtureId',
      nullif(trim(row_data.data->'competition'->>'code'), ''),
      nullif(trim(row_data.data->'competition'->>'name'), ''),
      v_home_team_id,
      v_away_team_id,
      v_home_source_club_id,
      v_away_source_club_id,
      nullif(trim(row_data.data->'fixture'->>'homeName'), ''),
      nullif(trim(row_data.data->'fixture'->>'awayName'), ''),
      nullif(row_data.data->'fixture'->>'homeScore', '')::integer,
      nullif(row_data.data->'fixture'->>'awayScore', '')::integer,
      coalesce(row_data.captured_at, now()),
      row_data.data
    )
    on conflict (source_entity_key, source_version) do nothing
    returning id into v_snapshot_id;

    if v_snapshot_id is not null then
      snapshots_applied := snapshots_applied + 1;
    else
      select id into v_snapshot_id
      from public.soccer_manager_match_snapshots
      where source_entity_key = row_data.entity_key
        and source_version = row_data.source_version;
    end if;

    if v_snapshot_id is null then
      continue;
    end if;

    for child in select value from jsonb_array_elements(coalesce(row_data.data->'players', '[]'::jsonb))
    loop
      insert into public.soccer_manager_match_players (
        match_snapshot_id, source_player_id, team_side, player_name, source_data
      ) values (
        v_snapshot_id,
        nullif(trim(child->>'playerId'), ''),
        nullif(trim(child->>'teamSide'), ''),
        nullif(trim(child->>'name'), ''),
        child
      )
      on conflict (match_snapshot_id, source_player_id, team_side) do nothing;
      if found then players_applied := players_applied + 1; end if;
    end loop;

    for child in select value from jsonb_array_elements(coalesce(row_data.data->'keyEvents', '[]'::jsonb))
    loop
      insert into public.soccer_manager_match_events (
        match_snapshot_id, event_kind, source_sequence, minute, event_type, team_side,
        source_player_id, secondary_source_player_id, outcome, attack_type, source_data
      ) values (
        v_snapshot_id, 'key_event', coalesce((child->>'sequence')::integer, 0),
        nullif(child->>'minute', '')::integer,
        nullif(trim(child->>'type'), ''),
        nullif(trim(child->>'clubSide'), ''),
        nullif(trim(child->>'playerId'), ''),
        nullif(trim(child->>'secondaryPlayerId'), ''),
        case when child->>'type' in ('goal', 'yellow', 'red') then child->>'type' else null end,
        nullif(trim(child->>'attackType'), ''),
        child
      )
      on conflict (match_snapshot_id, event_kind, source_sequence) do nothing;
      if found then events_applied := events_applied + 1; end if;
    end loop;

    for child in select value from jsonb_array_elements(coalesce(row_data.data->'chances', '[]'::jsonb))
    loop
      insert into public.soccer_manager_match_events (
        match_snapshot_id, event_kind, source_sequence, minute, event_type, team_side,
        source_player_id, secondary_source_player_id, goalkeeper_source_player_id,
        outcome, attack_type, details_2d, source_data
      ) values (
        v_snapshot_id, 'chance', coalesce((child->>'sequence')::integer, 0),
        nullif(child->>'minute', '')::integer,
        'chance',
        nullif(trim(child->>'teamSide'), ''),
        nullif(trim(child->'player'->>'playerId'), ''),
        nullif(trim(child->'secondaryPlayer'->>'playerId'), ''),
        nullif(trim(child->'goalkeeper'->>'playerId'), ''),
        nullif(trim(child->>'outcome'), ''),
        nullif(trim(child->>'attackType'), ''),
        nullif(trim(child->>'details2D'), ''),
        child
      )
      on conflict (match_snapshot_id, event_kind, source_sequence) do nothing;
      if found then events_applied := events_applied + 1; end if;
    end loop;

    for child in select value from jsonb_array_elements(coalesce(row_data.data->'substitutions', '[]'::jsonb))
    loop
      insert into public.soccer_manager_match_events (
        match_snapshot_id, event_kind, source_sequence, minute, event_type, team_side, source_data
      ) values (
        v_snapshot_id, 'substitution', coalesce((child->>'sequence')::integer, 0),
        nullif(child->>'minute', '')::integer,
        'substitution_batch',
        nullif(trim(child->>'teamSide'), ''),
        child
      )
      on conflict (match_snapshot_id, event_kind, source_sequence) do nothing;
      if found then events_applied := events_applied + 1; end if;
    end loop;

    for child in select value from jsonb_array_elements(coalesce(row_data.data->'domination', '[]'::jsonb))
    loop
      insert into public.soccer_manager_match_domination (
        match_snapshot_id, minute, left_value, source_data
      ) values (
        v_snapshot_id,
        (child->>'minute')::integer,
        (child->>'leftValue')::integer,
        child
      )
      on conflict (match_snapshot_id, minute) do nothing;
      if found then domination_applied := domination_applied + 1; end if;
    end loop;

    for child in select value from jsonb_array_elements(coalesce(row_data.data->'worldScores', '[]'::jsonb))
    loop
      insert into public.soccer_manager_match_world_scores (
        match_snapshot_id, source_key, minute, source_fixture_id, team_side,
        competition_code, source_player_id, player_name, source_data
      ) values (
        v_snapshot_id,
        concat_ws(':',
          coalesce(child->>'sequence', ''),
          coalesce(child->>'minute', ''),
          coalesce(child->>'fixtureId', ''),
          coalesce(child->>'teamSide', ''),
          coalesce(child->>'playerId', ''),
          coalesce(child->>'playerName', '')
        ),
        nullif(child->>'minute', '')::integer,
        nullif(trim(child->>'fixtureId'), ''),
        nullif(trim(child->>'teamSide'), ''),
        nullif(trim(child->>'competitionCode'), ''),
        nullif(trim(child->>'playerId'), ''),
        nullif(trim(child->>'playerName'), ''),
        child
      )
      on conflict (match_snapshot_id, source_key) do nothing;
      if found then world_scores_applied := world_scores_applied + 1; end if;
    end loop;
  end loop;

  if last_entity_key is not null then
    select exists (
      select 1
      from public.soccer_manager_sync_changes change
      where change.entity_type = 'match_snapshot'
        and change.status = 'approved'
        and change.after_data->'source'->>'setupId' = setup_id
        and change.entity_key > last_entity_key
    ) into has_more;
  end if;

  insert into public.audit_log(entity_type, entity_id, action, new_data, changed_by)
  values (
    'soccer_manager_archive',
    v_world_id,
    'apply_match_archive',
    jsonb_build_object(
      'setupId', setup_id,
      'snapshotsApplied', snapshots_applied,
      'playersApplied', players_applied,
      'eventsApplied', events_applied,
      'dominationApplied', domination_applied,
      'worldScoresApplied', world_scores_applied,
      'unmappedClubs', unmapped_clubs,
      'lastEntityKey', last_entity_key,
      'hasMore', has_more
    ),
    user_id::text
  );

  return jsonb_build_object(
    'setupId', setup_id,
    'gameWorldId', v_world_id,
    'matchSnapshots', snapshots_applied,
    'matchPlayers', players_applied,
    'matchEvents', events_applied,
    'dominationMinutes', domination_applied,
    'worldScoreEvents', world_scores_applied,
    'unmappedClubs', unmapped_clubs,
    'lastEntityKey', last_entity_key,
    'hasMore', has_more
  );
end;
$$;

revoke all on function public.apply_soccer_manager_match_archive_batch(text, text, integer) from public, anon;
grant execute on function public.apply_soccer_manager_match_archive_batch(text, text, integer) to authenticated, service_role;
