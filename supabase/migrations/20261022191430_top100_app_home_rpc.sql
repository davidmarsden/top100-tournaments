create or replace function public.get_my_top100_app_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_account_id bigint;
  v_manager_id bigint;
  v_game_world_id bigint;
  v_world jsonb;
  v_setup_id bigint;
  v_team_id bigint;
  v_team_name text;
  v_source_club_id text;
  v_division integer;
  v_club jsonb := null;
  v_table jsonb := '[]'::jsonb;
  v_squad jsonb := null;
  v_next jsonb := null;
begin
  if v_user_id is null then
    raise exception 'Sign in required';
  end if;

  select account.id, account.manager_id, account.game_world_id, world.external_world_id,
         jsonb_build_object('id', world.id, 'name', world.name, 'slug', world.slug, 'setupId', world.external_world_id)
    into v_account_id, v_manager_id, v_game_world_id, v_setup_id, v_world
  from public.manager_portal_accounts account
  join public.game_worlds world on world.id = account.game_world_id
  where account.auth_user_id = v_user_id
    and account.active = true
  order by account.id desc
  limit 1;

  if v_account_id is null then
    raise exception 'Active Manager Portal account required';
  end if;

  select assignment.team_id, team.name
    into v_team_id, v_team_name
  from public.soccer_manager_world_manager_assignments assignment
  join public.teams team on team.id = assignment.team_id
  where assignment.game_world_id = v_game_world_id
    and assignment.manager_id = v_manager_id
  order by assignment.updated_at desc
  limit 1;

  if v_team_id is not null then
    select crosswalk.source_club_id
      into v_source_club_id
    from public.soccer_manager_club_crosswalk crosswalk
    where crosswalk.game_world_id = v_game_world_id
      and crosswalk.team_id = v_team_id
    limit 1;

    select standing.division
      into v_division
    from public.league_standings_current_by_club standing
    where standing.game_world_id = v_game_world_id
      and standing.source_club_id = v_source_club_id;

    -- clubDataId is Soccer Manager's club catalogue id, used by
    -- multiplayer.php?action=oppclub&clubdataid=… links.
    with club_data as (
      select distinct on (entity.data->>'clubId')
        entity.data->>'clubId' as source_club_id,
        nullif(entity.data->>'clubDataId', '') as club_data_id
      from public.soccer_manager_canonical_entities entity
      where entity.entity_type = 'standing'
        and entity.data->>'setupId' = v_setup_id::text
      order by entity.data->>'clubId', entity.last_approved_at desc
    )
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'clubName', standing.club_name,
        'sourceClubId', standing.source_club_id,
        'clubDataId', club_data.club_data_id,
        'position', standing.position,
        'played', standing.played,
        'won', standing.won,
        'drawn', standing.drawn,
        'lost', standing.lost,
        'goalDifference', standing.goal_difference,
        'points', standing.points,
        'form', standing.form,
        'isMine', standing.source_club_id = v_source_club_id
      ) order by standing.position) filter (where standing.division = v_division), '[]'::jsonb),
      (array_agg(jsonb_build_object(
        'name', v_team_name,
        'sourceClubId', standing.source_club_id,
        'clubDataId', club_data.club_data_id,
        'division', standing.division,
        'position', standing.position,
        'points', standing.points,
        'form', standing.form,
        'observedAt', standing.world_observed_at,
        'fresh', standing.observation_is_fresh
      )) filter (where standing.source_club_id = v_source_club_id))[1]
      into v_table, v_club
    from public.league_standings_current_by_club standing
    left join club_data on club_data.source_club_id = standing.source_club_id
    where standing.game_world_id = v_game_world_id;

    if v_club is null then
      v_club := jsonb_build_object('name', v_team_name, 'sourceClubId', v_source_club_id);
    end if;

    select jsonb_build_object(
      'players', count(*),
      'seniorPlayers', count(*) filter (where not coalesce(player.youth, false)),
      'youthPlayers', count(*) filter (where coalesce(player.youth, false)),
      'averageRating', round(avg(player.rating) filter (where not coalesce(player.youth, false)), 1),
      'totalValue', sum(player.value),
      'lastSeenAt', max(player.last_seen_at)
    )
      into v_squad
    from public.soccer_manager_players player
    where player.game_world_id = v_game_world_id
      and player.current_team_id = v_team_id;
  end if;

  -- Next unfinished tournament fixture, with the opponent's SM identifiers where known.
  select jsonb_build_object(
    'matchId', match.id,
    'tournament', tournament.name,
    'round', coalesce(match.round, match.stage),
    'fixtureDate', match.fixture_date,
    'home', match.home_entry_id = own_entry.id,
    'opponent', opponent_team.name,
    'opponentClubDataId', (
      select nullif(entity.data->>'clubDataId', '')
      from public.soccer_manager_club_crosswalk crosswalk
      join public.soccer_manager_canonical_entities entity
        on entity.entity_type = 'standing'
       and entity.data->>'setupId' = crosswalk.source_world_id::text
       and entity.data->>'clubId' = crosswalk.source_club_id
      where crosswalk.game_world_id = tournament.game_world_id
        and crosswalk.team_id = opponent_entry.team_id
      order by entity.last_approved_at desc
      limit 1
    )
  )
    into v_next
  from public.tournament_entries own_entry
  join public.tournaments tournament on tournament.id = own_entry.tournament_id
  join public.matches match
    on match.home_entry_id = own_entry.id or match.away_entry_id = own_entry.id
  left join public.tournament_entries opponent_entry
    on opponent_entry.id = case when match.home_entry_id = own_entry.id then match.away_entry_id else match.home_entry_id end
  left join public.teams opponent_team on opponent_team.id = opponent_entry.team_id
  where own_entry.manager_id = v_manager_id
    and tournament.game_world_id = v_game_world_id
    and tournament.is_public = true
    and coalesce(lower(match.status), 'scheduled') not in ('played', 'forfeit', 'voided', 'cancelled')
  order by match.fixture_date nulls last, match.id
  limit 1;

  return jsonb_build_object(
    'accountId', v_account_id,
    'world', v_world,
    'club', v_club,
    'divisionTable', v_table,
    'squad', v_squad,
    'nextFixture', v_next
  );
end;
$$;

revoke all on function public.get_my_top100_app_home() from public, anon;
grant execute on function public.get_my_top100_app_home() to authenticated;
