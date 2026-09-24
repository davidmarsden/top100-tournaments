-- Manager-scoped Soccer Manager squad dashboard.
-- Raw archive tables remain private; this RPC exposes only the signed-in manager's own team.

create or replace function public.get_my_soccer_manager_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_manager_id bigint;
  v_game_world_id bigint;
  v_manager_name text;
  v_world_name text;
  v_team_id bigint;
  v_team_name text;
  v_players jsonb := '[]'::jsonb;
  v_transfers jsonb := '[]'::jsonb;
  v_standing jsonb := null;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Sign in required';
  end if;

  select
    account.manager_id,
    account.game_world_id,
    coalesce(manager.display_name, manager.name),
    world.name
  into
    v_manager_id,
    v_game_world_id,
    v_manager_name,
    v_world_name
  from public.manager_portal_accounts account
  join public.managers manager on manager.id = account.manager_id
  join public.game_worlds world on world.id = account.game_world_id
  where account.auth_user_id = v_user_id
    and account.active = true
  order by account.id desc
  limit 1;

  if v_manager_id is null or v_game_world_id is null then
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

  if v_team_id is null then
    return jsonb_build_object(
      'managerId', v_manager_id,
      'managerName', v_manager_name,
      'gameWorldId', v_game_world_id,
      'gameWorldName', v_world_name,
      'teamId', null,
      'teamName', null,
      'players', '[]'::jsonb,
      'transfers', '[]'::jsonb,
      'standing', null
    );
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', player.id,
      'sourcePlayerId', player.source_player_id,
      'sourceSquadPlayerId', player.source_squad_player_id,
      'name', player.name,
      'surname', player.surname,
      'nationality', player.nationality,
      'age', player.age,
      'rating', player.rating,
      'position', player.position,
      'positionId', player.position_id,
      'value', player.value,
      'wages', player.wages,
      'contract', player.contract,
      'morale', player.morale,
      'condition', player.condition,
      'foot', player.foot,
      'appearances', player.appearances,
      'substituteAppearances', player.substitute_appearances,
      'averagePerformance', player.average_performance,
      'goals', player.goals,
      'assists', player.assists,
      'goalkeeper', player.goalkeeper,
      'youth', player.youth,
      'transferListed', player.transfer_listed,
      'photo', player.photo,
      'ratingChangedAt', player.rating_changed_at,
      'lastSeenAt', player.last_seen_at
    )
    order by player.rating desc nulls last, player.age asc nulls last, player.name
  ), '[]'::jsonb),
  max(player.last_seen_at)
  into v_players, v_updated_at
  from public.soccer_manager_players player
  where player.game_world_id = v_game_world_id
    and player.current_team_id = v_team_id;

  select coalesce(jsonb_agg(transfer_row.payload order by transfer_row.sort_seen desc, transfer_row.sort_id desc), '[]'::jsonb)
    into v_transfers
  from (
    select
      transfer.last_seen_at as sort_seen,
      transfer.id as sort_id,
      jsonb_build_object(
        'id', transfer.id,
        'sourceTransferId', transfer.source_transfer_id,
        'playerName', coalesce(nullif(trim(transfer.player_name), ''), nullif(trim(transfer.player_surname), ''), 'Unknown player'),
        'rating', transfer.rating,
        'age', transfer.age,
        'position', transfer.position,
        'amount', transfer.amount,
        'playerValue', transfer.player_value,
        'acceptedDate', transfer.accepted_date,
        'turn', transfer.source_turn,
        'status', transfer.status,
        'statusLabel', transfer.status_label,
        'illegal', transfer.illegal,
        'illegalReason', transfer.illegal_reason,
        'direction', case when transfer.to_team_id = v_team_id then 'in' else 'out' end,
        'counterpartyClubId', case when transfer.to_team_id = v_team_id then transfer.from_source_club_id else transfer.to_source_club_id end,
        'counterpartyClubName', case when transfer.to_team_id = v_team_id then transfer.from_club_name else transfer.to_club_name end,
        'counterpartyIsTop100', case when transfer.to_team_id = v_team_id then transfer.from_team_id is not null else transfer.to_team_id is not null end,
        'firstSeenAt', transfer.first_seen_at,
        'lastSeenAt', transfer.last_seen_at
      ) as payload
    from public.soccer_manager_transfers transfer
    where transfer.game_world_id = v_game_world_id
      and (transfer.from_team_id = v_team_id or transfer.to_team_id = v_team_id)
    order by transfer.last_seen_at desc, transfer.id desc
    limit 50
  ) transfer_row;

  select jsonb_build_object(
    'division', standing.division,
    'position', standing.position,
    'previousPosition', standing.previous_position,
    'played', standing.played,
    'won', standing.won,
    'drawn', standing.drawn,
    'lost', standing.lost,
    'goalsFor', standing.goals_for,
    'goalsAgainst', standing.goals_against,
    'goalDifference', standing.goal_difference,
    'points', standing.points,
    'form', standing.form,
    'capturedAt', standing.captured_at
  )
  into v_standing
  from public.league_standing_snapshots standing
  where standing.game_world_id = v_game_world_id
    and standing.team_id = v_team_id
  order by standing.captured_at desc, standing.id desc
  limit 1;

  return jsonb_build_object(
    'managerId', v_manager_id,
    'managerName', v_manager_name,
    'gameWorldId', v_game_world_id,
    'gameWorldName', v_world_name,
    'teamId', v_team_id,
    'teamName', v_team_name,
    'updatedAt', v_updated_at,
    'players', v_players,
    'transfers', v_transfers,
    'standing', v_standing
  );
end;
$$;

revoke all on function public.get_my_soccer_manager_dashboard() from public, anon;
grant execute on function public.get_my_soccer_manager_dashboard() to authenticated, service_role;
