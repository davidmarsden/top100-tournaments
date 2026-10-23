-- Re-apply an archived transfer when its player, club or manager mapping now resolves differently,
-- for example after core data is approved later than the transfer. The version-only check in
-- 20261022232256 would otherwise leave such transfers unmapped for good.

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
  change_row record;
  v_player_id bigint;
  v_source_player_id text;
  v_team_id bigint;
  v_source_club_id text;
  v_captured_at timestamptz;
  squad_players_applied integer := 0;
  squad_memberships_cleared integer := 0;
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
  -- playerId is retained as the world-specific squad identity. If two entities share a player
  -- identity, the last by entity key wins, as in the earlier row-by-row version.
  with squad as materialized (
    select entity_key, data, last_approved_at,
           nullif(trim(coalesce(data->>'playerDataId', data->>'playerId')), '') as source_player_id,
           nullif(trim(data->>'playerId'), '') as source_squad_player_id,
           nullif(trim(data->>'clubId'), '') as source_club_id
    from public.soccer_manager_canonical_entities
    where entity_type = 'squad_player'
      and data->>'setupId' = setup_id
      and nullif(trim(coalesce(data->>'playerDataId', data->>'playerId')), '') is not null
  ),
  upserted as (
    insert into public.soccer_manager_players (
      game_world_id, source_player_id, source_squad_player_id,
      name, surname, nationality, age, rating, position, position_id, main_position, main_position_id,
      current_team_id, current_source_club_id,
      value, wages, contract, morale, condition, foot,
      appearances, substitute_appearances, average_performance, goals, assists,
      career_appearances, career_average_performance, career_goals, career_assists,
      career_man_of_the_match, career_yellow_cards, career_red_cards,
      goalkeeper, youth, transfer_listed, loaned,
      recent_club_id, recent_club_name, recent_club_country, recent_club_country_id,
      photo, rating_change, rating_changed_at,
      last_seen_at, updated_at
    )
    select
      v_world_id, row_data.source_player_id, row_data.source_squad_player_id,
      nullif(trim(row_data.data->>'name'), ''),
      nullif(trim(row_data.data->>'surname'), ''),
      nullif(trim(row_data.data->>'nationality'), ''),
      case when coalesce(row_data.data->>'age','') ~ '^[0-9]+$' then (row_data.data->>'age')::integer else null end,
      case when coalesce(row_data.data->>'rating','') ~ '^[0-9]+$' then (row_data.data->>'rating')::integer else null end,
      nullif(trim(row_data.data->>'position'), ''),
      case when coalesce(row_data.data->>'positionId','') ~ '^[0-9]+$' then (row_data.data->>'positionId')::integer else null end,
      nullif(trim(row_data.data->>'mainPosition'), ''),
      case when coalesce(row_data.data->>'mainPositionId','') ~ '^[0-9]+$' then (row_data.data->>'mainPositionId')::integer else null end,
      row_data.team_id, row_data.source_club_id,
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
      case when coalesce(row_data.data->>'careerAppearances','') ~ '^-?[0-9]+$' then (row_data.data->>'careerAppearances')::integer else null end,
      case when coalesce(row_data.data->>'careerAveragePerformance','') ~ '^-?[0-9]+(?:\.[0-9]+)?$' then (row_data.data->>'careerAveragePerformance')::numeric else null end,
      case when coalesce(row_data.data->>'careerGoals','') ~ '^-?[0-9]+$' then (row_data.data->>'careerGoals')::integer else null end,
      case when coalesce(row_data.data->>'careerAssists','') ~ '^-?[0-9]+$' then (row_data.data->>'careerAssists')::integer else null end,
      case when coalesce(row_data.data->>'careerManOfTheMatch','') ~ '^-?[0-9]+$' then (row_data.data->>'careerManOfTheMatch')::integer else null end,
      case when coalesce(row_data.data->>'careerYellowCards','') ~ '^-?[0-9]+$' then (row_data.data->>'careerYellowCards')::integer else null end,
      case when coalesce(row_data.data->>'careerRedCards','') ~ '^-?[0-9]+$' then (row_data.data->>'careerRedCards')::integer else null end,
      case when lower(coalesce(row_data.data->>'goalkeeper','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'goalkeeper','')) in ('false','0','no') then false else null end,
      case when lower(coalesce(row_data.data->>'youth','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'youth','')) in ('false','0','no') then false else null end,
      case when lower(coalesce(row_data.data->>'transferListed','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'transferListed','')) in ('false','0','no') then false else null end,
      case when lower(coalesce(row_data.data->>'loaned','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'loaned','')) in ('false','0','no') then false else null end,
      nullif(trim(row_data.data->>'recentClubId'), ''),
      nullif(trim(row_data.data->>'recentClubName'), ''),
      nullif(trim(row_data.data->>'recentClubCountry'), ''),
      nullif(trim(row_data.data->>'recentClubCountryId'), ''),
      nullif(trim(row_data.data->>'photo'), ''),
      case when coalesce(row_data.data->>'ratingChange','') ~ '^-?[0-9]+$' then (row_data.data->>'ratingChange')::integer else null end,
      nullif(trim(row_data.data->>'ratingChangedAt'), ''),
      coalesce(row_data.last_approved_at, now()),
      now()
    from (
      select distinct on (squad.source_player_id)
        squad.*,
        case when squad.source_club_id is not null then (select link.target_id
           from public.soccer_manager_archive_links link
           join public.teams team on team.id=link.target_id
           where link.source_type='club'
             and link.source_key=setup_id || ':' || squad.source_club_id
             and link.target_type='team') end as team_id
      from squad
      order by squad.source_player_id, squad.entity_key desc
    ) row_data
    on conflict (game_world_id, source_player_id) do update
      set source_squad_player_id = coalesce(excluded.source_squad_player_id, public.soccer_manager_players.source_squad_player_id),
          name = coalesce(excluded.name, public.soccer_manager_players.name),
          surname = coalesce(excluded.surname, public.soccer_manager_players.surname),
          nationality = coalesce(excluded.nationality, public.soccer_manager_players.nationality),
          age = excluded.age,
          rating = excluded.rating,
          position = excluded.position,
          position_id = excluded.position_id,
          main_position = excluded.main_position,
          main_position_id = excluded.main_position_id,
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
          career_appearances = excluded.career_appearances,
          career_average_performance = excluded.career_average_performance,
          career_goals = excluded.career_goals,
          career_assists = excluded.career_assists,
          career_man_of_the_match = excluded.career_man_of_the_match,
          career_yellow_cards = excluded.career_yellow_cards,
          career_red_cards = excluded.career_red_cards,
          goalkeeper = excluded.goalkeeper,
          youth = excluded.youth,
          transfer_listed = excluded.transfer_listed,
          loaned = excluded.loaned,
          recent_club_id = excluded.recent_club_id,
          recent_club_name = excluded.recent_club_name,
          recent_club_country = excluded.recent_club_country,
          recent_club_country_id = excluded.recent_club_country_id,
          photo = coalesce(excluded.photo, public.soccer_manager_players.photo),
          rating_change = excluded.rating_change,
          rating_changed_at = excluded.rating_changed_at,
          last_seen_at = greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at),
          updated_at = now()
    where (
           public.soccer_manager_players.source_squad_player_id,
           public.soccer_manager_players.name,
           public.soccer_manager_players.surname,
           public.soccer_manager_players.nationality,
           public.soccer_manager_players.age,
           public.soccer_manager_players.rating,
           public.soccer_manager_players.position,
           public.soccer_manager_players.position_id,
           public.soccer_manager_players.main_position,
           public.soccer_manager_players.main_position_id,
           public.soccer_manager_players.current_team_id,
           public.soccer_manager_players.current_source_club_id,
           public.soccer_manager_players.value,
           public.soccer_manager_players.wages,
           public.soccer_manager_players.contract,
           public.soccer_manager_players.morale,
           public.soccer_manager_players.condition,
           public.soccer_manager_players.foot,
           public.soccer_manager_players.appearances,
           public.soccer_manager_players.substitute_appearances,
           public.soccer_manager_players.average_performance,
           public.soccer_manager_players.goals,
           public.soccer_manager_players.assists,
           public.soccer_manager_players.career_appearances,
           public.soccer_manager_players.career_average_performance,
           public.soccer_manager_players.career_goals,
           public.soccer_manager_players.career_assists,
           public.soccer_manager_players.career_man_of_the_match,
           public.soccer_manager_players.career_yellow_cards,
           public.soccer_manager_players.career_red_cards,
           public.soccer_manager_players.goalkeeper,
           public.soccer_manager_players.youth,
           public.soccer_manager_players.transfer_listed,
           public.soccer_manager_players.loaned,
           public.soccer_manager_players.recent_club_id,
           public.soccer_manager_players.recent_club_name,
           public.soccer_manager_players.recent_club_country,
           public.soccer_manager_players.recent_club_country_id,
           public.soccer_manager_players.photo,
           public.soccer_manager_players.rating_change,
           public.soccer_manager_players.rating_changed_at,
           public.soccer_manager_players.last_seen_at
          ) is distinct from (
           coalesce(excluded.source_squad_player_id, public.soccer_manager_players.source_squad_player_id),
           coalesce(excluded.name, public.soccer_manager_players.name),
           coalesce(excluded.surname, public.soccer_manager_players.surname),
           coalesce(excluded.nationality, public.soccer_manager_players.nationality),
           excluded.age,
           excluded.rating,
           excluded.position,
           excluded.position_id,
           excluded.main_position,
           excluded.main_position_id,
           excluded.current_team_id,
           excluded.current_source_club_id,
           excluded.value,
           excluded.wages,
           excluded.contract,
           excluded.morale,
           excluded.condition,
           excluded.foot,
           excluded.appearances,
           excluded.substitute_appearances,
           excluded.average_performance,
           excluded.goals,
           excluded.assists,
           excluded.career_appearances,
           excluded.career_average_performance,
           excluded.career_goals,
           excluded.career_assists,
           excluded.career_man_of_the_match,
           excluded.career_yellow_cards,
           excluded.career_red_cards,
           excluded.goalkeeper,
           excluded.youth,
           excluded.transfer_listed,
           excluded.loaned,
           excluded.recent_club_id,
           excluded.recent_club_name,
           excluded.recent_club_country,
           excluded.recent_club_country_id,
           coalesce(excluded.photo, public.soccer_manager_players.photo),
           excluded.rating_change,
           excluded.rating_changed_at,
           greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at)
          )
    returning 1
  )
  select count(*)::integer into squad_players_applied from squad;

  -- Approved squad-scope markers are authoritative current rosters.
  -- They are reviewed canonical entities, so removals (including an empty squad)
  -- are explicit source truth rather than inferred from accumulated player rows.
  with scopes as (
    select scope.data->'rosterPlayerIds' as roster,
           (select link.target_id
           from public.soccer_manager_archive_links link
           join public.teams team on team.id=link.target_id
           where link.source_type='club'
             and link.source_key=setup_id || ':' || nullif(trim(scope.data->>'clubId'),'')
             and link.target_type='team') as team_id
    from public.soccer_manager_canonical_entities scope
    where scope.entity_type='squad_scope'
      and scope.data->>'setupId'=setup_id
      and nullif(trim(scope.data->>'clubId'),'') is not null
  )
  update public.soccer_manager_players player
    set current_team_id = null,
        current_source_club_id = null,
        updated_at = now()
  where player.game_world_id = v_world_id
    and exists (
      select 1
      from scopes
      where scopes.team_id = player.current_team_id
        and not exists (
          select 1
          from jsonb_array_elements_text(coalesce(scopes.roster, '[]'::jsonb)) roster(source_player_id)
          where roster.source_player_id = player.source_player_id
        )
    );

  get diagnostics squad_memberships_cleared = row_count;

  -- Immutable snapshots from every approved squad-player state. Squad-player entity keys start with
  -- the setup id, so versions are numbered without reading every change's after_data.
    insert into public.soccer_manager_player_snapshots (
      source_entity_key, source_version, game_world_id, player_id, team_id, source_club_id,
      age, rating, position, position_id, main_position, main_position_id, nationality, value, wages, contract, morale, condition, foot,
      appearances, substitute_appearances, average_performance, goals, assists,
      career_appearances, career_average_performance, career_goals, career_assists,
      career_man_of_the_match, career_yellow_cards, career_red_cards,
      goalkeeper, youth, transfer_listed, loaned,
      recent_club_id, recent_club_name, recent_club_country, recent_club_country_id,
      rating_change, rating_changed_at, captured_at, source_data
    )
    select
      row_data.entity_key, row_data.source_version, v_world_id, player.id,
      case when row_data.source_club_id is not null then (select link.target_id
           from public.soccer_manager_archive_links link
           join public.teams team on team.id=link.target_id
           where link.source_type='club'
             and link.source_key=setup_id || ':' || row_data.source_club_id
             and link.target_type='team') end,
      row_data.source_club_id,
      case when coalesce(row_data.data->>'age','') ~ '^[0-9]+$' then (row_data.data->>'age')::integer else null end,
      case when coalesce(row_data.data->>'rating','') ~ '^[0-9]+$' then (row_data.data->>'rating')::integer else null end,
      nullif(trim(row_data.data->>'position'),''),
      case when coalesce(row_data.data->>'positionId','') ~ '^[0-9]+$' then (row_data.data->>'positionId')::integer else null end,
      nullif(trim(row_data.data->>'mainPosition'),''),
      case when coalesce(row_data.data->>'mainPositionId','') ~ '^[0-9]+$' then (row_data.data->>'mainPositionId')::integer else null end,
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
      case when coalesce(row_data.data->>'careerAppearances','') ~ '^-?[0-9]+$' then (row_data.data->>'careerAppearances')::integer else null end,
      case when coalesce(row_data.data->>'careerAveragePerformance','') ~ '^-?[0-9]+(?:\.[0-9]+)?$' then (row_data.data->>'careerAveragePerformance')::numeric else null end,
      case when coalesce(row_data.data->>'careerGoals','') ~ '^-?[0-9]+$' then (row_data.data->>'careerGoals')::integer else null end,
      case when coalesce(row_data.data->>'careerAssists','') ~ '^-?[0-9]+$' then (row_data.data->>'careerAssists')::integer else null end,
      case when coalesce(row_data.data->>'careerManOfTheMatch','') ~ '^-?[0-9]+$' then (row_data.data->>'careerManOfTheMatch')::integer else null end,
      case when coalesce(row_data.data->>'careerYellowCards','') ~ '^-?[0-9]+$' then (row_data.data->>'careerYellowCards')::integer else null end,
      case when coalesce(row_data.data->>'careerRedCards','') ~ '^-?[0-9]+$' then (row_data.data->>'careerRedCards')::integer else null end,
      case when lower(coalesce(row_data.data->>'goalkeeper','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'goalkeeper','')) in ('false','0','no') then false else null end,
      case when lower(coalesce(row_data.data->>'youth','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'youth','')) in ('false','0','no') then false else null end,
      case when lower(coalesce(row_data.data->>'transferListed','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'transferListed','')) in ('false','0','no') then false else null end,
      case when lower(coalesce(row_data.data->>'loaned','')) in ('true','1','yes') then true when lower(coalesce(row_data.data->>'loaned','')) in ('false','0','no') then false else null end,
      nullif(trim(row_data.data->>'recentClubId'),''),
      nullif(trim(row_data.data->>'recentClubName'),''),
      nullif(trim(row_data.data->>'recentClubCountry'),''),
      nullif(trim(row_data.data->>'recentClubCountryId'),''),
      case when coalesce(row_data.data->>'ratingChange','') ~ '^-?[0-9]+$' then (row_data.data->>'ratingChange')::integer else null end,
      nullif(trim(row_data.data->>'ratingChangedAt'),''),
      coalesce(row_data.captured_at, now()),
      row_data.data
    from (
      select approved.entity_key, approved.source_version, approved.captured_at, change.after_data as data,
             nullif(trim(coalesce(change.after_data->>'playerDataId', change.after_data->>'playerId')), '') as source_player_id,
             nullif(trim(change.after_data->>'clubId'), '') as source_club_id
      from (
        select
          change.id,
          change.entity_key,
          row_number() over (
            partition by change.entity_key
            order by coalesce(change.reviewed_at, run.captured_at, change.created_at), change.id
          )::integer as source_version,
          run.captured_at
        from public.soccer_manager_sync_changes change
        join public.soccer_manager_sync_runs run on run.id = change.run_id
        where change.entity_type = 'squad_player'
          and change.status = 'approved'
          and change.entity_key like setup_id || ':%'
      ) approved
      join public.soccer_manager_sync_changes change on change.id = approved.id
      where not exists (
        select 1
        from public.soccer_manager_player_snapshots existing
        where existing.source_entity_key = approved.entity_key
          and existing.source_version = approved.source_version
      )
        and change.after_data->>'setupId' = setup_id
    ) row_data
    join public.soccer_manager_players player
      on player.game_world_id = v_world_id
     and player.source_player_id = row_data.source_player_id
    on conflict (source_entity_key, source_version) do nothing;

  get diagnostics player_snapshots_applied = row_count;

  -- Latest transfer record for each stable transfer entity. A transfer is (re)applied when it is new, its
  -- approved version changed, or its player, club or manager mapping now resolves differently. A transfer
  -- may be observed before a squad capture, so a minimal player identity is created for new versions and
  -- later enriched by squad data. Existing player fields win; a new player takes its details from its first
  -- transfer by entity key. transfers counts the transfers applied by this call.
    insert into public.soccer_manager_players (
      game_world_id, source_player_id, name, surname, nationality, age, rating, position, value,
      last_seen_at, updated_at
    )
    select
      v_world_id,
      row_data.source_player_id,
      nullif(trim(row_data.data->>'playerName'),''),
      nullif(trim(row_data.data->>'playerSurname'),''),
      nullif(trim(row_data.data->>'nationality'),''),
      case when coalesce(row_data.data->>'age','') ~ '^[0-9]+$' then (row_data.data->>'age')::integer else null end,
      case when coalesce(row_data.data->>'rating','') ~ '^[0-9]+$' then (row_data.data->>'rating')::integer else null end,
      nullif(trim(row_data.data->>'position'),''),
      case when coalesce(row_data.data->>'playerValue','') ~ '^[0-9]+$' then (row_data.data->>'playerValue')::bigint else null end,
      row_data.last_seen_at,
      now()
    from (
      select distinct on (transfer.source_player_id)
        transfer.*,
        max(coalesce(transfer.last_approved_at, now())) over (partition by transfer.source_player_id) as last_seen_at
      from (
        select entity_key, data, last_approved_at, nullif(trim(data->>'playerId'), '') as source_player_id
        from public.soccer_manager_canonical_entities canonical_transfer
        where entity_type='transfer'
          and data->>'setupId'=setup_id
          and not exists (
            select 1
            from public.soccer_manager_transfers archived
            where archived.source_entity_key = canonical_transfer.entity_key
              and archived.source_version = canonical_transfer.version
          )
      ) transfer
      where transfer.source_player_id is not null
      order by transfer.source_player_id, transfer.entity_key
    ) row_data
    on conflict (game_world_id, source_player_id) do update
      set name=coalesce(public.soccer_manager_players.name, excluded.name),
          surname=coalesce(public.soccer_manager_players.surname, excluded.surname),
          nationality=coalesce(public.soccer_manager_players.nationality, excluded.nationality),
          age=coalesce(public.soccer_manager_players.age, excluded.age),
          rating=coalesce(public.soccer_manager_players.rating, excluded.rating),
          position=coalesce(public.soccer_manager_players.position, excluded.position),
          value=coalesce(public.soccer_manager_players.value, excluded.value),
          last_seen_at=greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at),
          updated_at=now();

  with transfer_rows as (
    select transfer.*,
           case when transfer.from_club_id <> '0' then (select link.target_id
           from public.soccer_manager_archive_links link
           join public.teams team on team.id=link.target_id
           where link.source_type='club'
             and link.source_key=setup_id || ':' || transfer.from_club_id
             and link.target_type='team') end as from_team_id,
           case when transfer.to_club_id <> '0' then (select link.target_id
           from public.soccer_manager_archive_links link
           join public.teams team on team.id=link.target_id
           where link.source_type='club'
             and link.source_key=setup_id || ':' || transfer.to_club_id
             and link.target_type='team') end as to_team_id,
           case when transfer.from_manager_source_id <> '0' then (select link.target_id
           from public.soccer_manager_archive_links link
           join public.managers manager on manager.id=link.target_id
           where link.source_type='manager'
             and link.source_key=setup_id || ':' || transfer.from_manager_source_id
             and link.target_type='manager') end as from_manager_id,
           case when transfer.to_manager_source_id <> '0' then (select link.target_id
           from public.soccer_manager_archive_links link
           join public.managers manager on manager.id=link.target_id
           where link.source_type='manager'
             and link.source_key=setup_id || ':' || transfer.to_manager_source_id
             and link.target_type='manager') end as to_manager_id
    from (
      select entity_key, data, version, first_approved_at, last_approved_at,
             nullif(trim(data->>'playerId'), '') as source_player_id,
             nullif(trim(data->>'fromClubId'),'') as from_club_id,
             nullif(trim(data->>'toClubId'),'') as to_club_id,
             nullif(trim(data->>'fromManagerId'),'') as from_manager_source_id,
             nullif(trim(data->>'toManagerId'),'') as to_manager_source_id
      from public.soccer_manager_canonical_entities
      where entity_type='transfer'
        and data->>'setupId'=setup_id
    ) transfer
    where transfer.source_player_id is not null
  ),
  applied as (
      insert into public.soccer_manager_transfers (
        game_world_id, source_entity_key, source_transfer_id, source_version, player_id,
        from_team_id, to_team_id, from_manager_id, to_manager_id,
        from_source_club_id, from_club_name, to_source_club_id, to_club_name,
        player_name, player_surname, rating, age, nationality, position,
        player_value, amount, accepted_date, source_turn, status, status_label,
        illegal, illegal_reason, player_offers, first_seen_at, last_seen_at, source_data, updated_at
      )
      select
        v_world_id,
        row_data.entity_key,
        nullif(trim(row_data.data->>'transferId'),''),
        row_data.version,
        player.id,
        row_data.from_team_id, row_data.to_team_id, row_data.from_manager_id, row_data.to_manager_id,
        row_data.from_club_id, nullif(trim(row_data.data->>'fromClubName'),''),
        row_data.to_club_id, nullif(trim(row_data.data->>'toClubName'),''),
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
        coalesce(row_data.first_approved_at, row_data.last_approved_at, now()),
        coalesce(row_data.last_approved_at, row_data.first_approved_at, now()),
        row_data.data,
        now()
      from transfer_rows row_data
      join public.soccer_manager_players player
        on player.game_world_id = v_world_id
       and player.source_player_id = row_data.source_player_id
      left join public.soccer_manager_transfers archived
        on archived.source_entity_key = row_data.entity_key
      where archived.id is null
         or archived.source_version is distinct from row_data.version
         or (archived.player_id, archived.from_team_id, archived.to_team_id, archived.from_manager_id, archived.to_manager_id)
            is distinct from (player.id, row_data.from_team_id, row_data.to_team_id, row_data.from_manager_id, row_data.to_manager_id)
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
            updated_at=now()
      returning 1
  )
  select
    (select count(*)::integer from applied),
    (select (count(*) filter (where from_club_id <> '0' and from_team_id is null)
           + count(*) filter (where to_club_id <> '0' and to_team_id is null))::integer
     from transfer_rows)
    into transfers_applied, unmapped_transfer_clubs;

  -- Occurrence-keyed player changes are immutable identities, but their normalized data can be corrected by a later approval.
  for change_row in
    select canonical.entity_key, canonical.data, canonical.version,
           canonical.last_approved_at, run.captured_at as source_captured_at
    from public.soccer_manager_canonical_entities canonical
    left join public.soccer_manager_sync_runs run on run.id=canonical.last_run_id
    where canonical.entity_type='player_change'
      and canonical.data->>'setupId'=setup_id
    order by canonical.entity_key
  loop
    v_source_player_id := nullif(trim(coalesce(change_row.data->>'playerDataId', change_row.data->>'playerId')),'');
    if v_source_player_id = '0' then
      v_source_player_id := null;
    end if;
    if v_source_player_id is null then
      continue;
    end if;

    insert into public.soccer_manager_players (
      game_world_id, source_player_id, name, age, rating, position, position_id, main_position, main_position_id, nationality, value,
      last_seen_at, updated_at
    ) values (
      v_world_id, v_source_player_id,
      nullif(trim(change_row.data->>'name'),''),
      case when coalesce(change_row.data->>'age','') ~ '^[0-9]+$' then (change_row.data->>'age')::integer else null end,
      case when coalesce(change_row.data->>'rating','') ~ '^[0-9]+$' then (change_row.data->>'rating')::integer else null end,
      nullif(trim(change_row.data->>'position'),''),
      case when coalesce(change_row.data->>'positionId','') ~ '^[0-9]+$' then (change_row.data->>'positionId')::integer else null end,
      nullif(trim(change_row.data->>'mainPosition'),''),
      case when coalesce(change_row.data->>'mainPositionId','') ~ '^[0-9]+$' then (change_row.data->>'mainPositionId')::integer else null end,
      nullif(trim(change_row.data->>'nationality'),''),
      case when coalesce(change_row.data->>'value','') ~ '^[0-9]+$' then (change_row.data->>'value')::bigint else null end,
      coalesce(change_row.last_approved_at, now()),
      now()
    )
    on conflict (game_world_id, source_player_id) do update
      set name=coalesce(public.soccer_manager_players.name, excluded.name),
          age=coalesce(public.soccer_manager_players.age, excluded.age),
          rating=coalesce(public.soccer_manager_players.rating, excluded.rating),
          position=coalesce(public.soccer_manager_players.position, excluded.position),
          position_id=coalesce(public.soccer_manager_players.position_id, excluded.position_id),
          main_position=coalesce(public.soccer_manager_players.main_position, excluded.main_position),
          main_position_id=coalesce(public.soccer_manager_players.main_position_id, excluded.main_position_id),
          nationality=coalesce(public.soccer_manager_players.nationality, excluded.nationality),
          value=coalesce(public.soccer_manager_players.value, excluded.value),
          last_seen_at=greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at),
          updated_at=now()
    returning id into v_player_id;

    v_source_club_id := nullif(trim(change_row.data->>'clubId'),'');
    v_team_id := null;
    if v_source_club_id is not null and v_source_club_id <> '0' then
      select link.target_id into v_team_id
      from public.soccer_manager_archive_links link
      join public.teams team on team.id=link.target_id
      where link.source_type='club'
        and link.source_key=setup_id || ':' || v_source_club_id
        and link.target_type='team';
    end if;

    v_captured_at := coalesce(change_row.source_captured_at, change_row.last_approved_at, now());

    insert into public.soccer_manager_player_changes (
      game_world_id, source_entity_key, source_version, player_id, team_id, source_club_id,
      event_kind, change_type, old_rating, new_rating, rating_difference,
      position, position_id, old_position_id, new_position_id, value,
      event_date, source_turn, source_data, captured_at, updated_at
    ) values (
      v_world_id, change_row.entity_key, change_row.version, v_player_id, v_team_id, v_source_club_id,
      nullif(trim(change_row.data->>'eventKind'),''),
      nullif(trim(change_row.data->>'changeType'),''),
      case when coalesce(change_row.data->>'oldRating','') ~ '^-?[0-9]+$' then (change_row.data->>'oldRating')::integer else null end,
      case when coalesce(change_row.data->>'newRating','') ~ '^-?[0-9]+$' then (change_row.data->>'newRating')::integer else null end,
      case when coalesce(change_row.data->>'ratingDifference','') ~ '^-?[0-9]+$' then (change_row.data->>'ratingDifference')::integer else null end,
      nullif(trim(change_row.data->>'position'),''),
      case when coalesce(change_row.data->>'positionId','') ~ '^[0-9]+$' then (change_row.data->>'positionId')::integer else null end,
      case when coalesce(change_row.data->>'oldPositionId','') ~ '^-?[0-9]+$' then (change_row.data->>'oldPositionId')::integer else null end,
      case when coalesce(change_row.data->>'newPositionId','') ~ '^-?[0-9]+$' then (change_row.data->>'newPositionId')::integer else null end,
      case when coalesce(change_row.data->>'value','') ~ '^-?[0-9]+$' then (change_row.data->>'value')::bigint else null end,
      nullif(trim(change_row.data->>'eventDate'),''),
      case when coalesce(change_row.data->>'turn','') ~ '^[0-9]+$' then (change_row.data->>'turn')::integer else null end,
      change_row.data,
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
      'squadMembershipsCleared', squad_memberships_cleared,
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
    'squadMembershipsCleared', squad_memberships_cleared,
    'playerSnapshots', player_snapshots_applied,
    'transfers', transfers_applied,
    'playerChanges', player_changes_applied,
    'unmappedTransferClubs', unmapped_transfer_clubs
  );
end;
$$;

revoke all on function public.apply_soccer_manager_player_transfer_archive(text) from public, anon;
grant execute on function public.apply_soccer_manager_player_transfer_archive(text) to authenticated, service_role;
