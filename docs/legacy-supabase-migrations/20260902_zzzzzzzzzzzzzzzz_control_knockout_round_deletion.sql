-- Prevent partial deletion of knockout-only rounds while preserving controlled
-- whole-round rollback and global-admin tournament teardown.

create or replace function public.guard_knockout_predecessor_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.knockout_controlled_delete', true) = 'on' then
    return old;
  end if;

  if old.stage = 'knockout'
     and public.is_knockout_only_tournament(old.tournament_id) then
    raise exception 'Knockout-only matches cannot be deleted individually; roll back the current round as a whole';
  end if;

  return old;
end;
$$;

revoke all on function public.guard_knockout_predecessor_delete() from public, anon, authenticated;
grant execute on function public.guard_knockout_predecessor_delete() to service_role;

create or replace function public.rollback_knockout_latest_round_atomic(p_tournament_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  latest_round text;
  deleted_count integer := 0;
begin
  if not public.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have organiser access to this tournament';
  end if;

  perform pg_advisory_xact_lock(public.knockout_roster_lock_key(p_tournament_id));

  select * into tournament_row
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament not found';
  end if;
  if tournament_row.tournament_structure is distinct from 'knockout_only' then
    raise exception 'Round rollback is only available for knockout-only tournaments';
  end if;

  select m.round into latest_round
  from public.matches m
  where m.tournament_id = p_tournament_id
    and m.stage = 'knockout'
    and coalesce(m.bracket, 'Cup') = 'Cup'
  order by public.knockout_round_rank(m.round) desc nulls last
  limit 1;

  if latest_round is null then
    raise exception 'No knockout round exists to roll back';
  end if;

  perform set_config('app.knockout_controlled_delete', 'on', true);

  delete from public.matches m
  where m.tournament_id = p_tournament_id
    and m.stage = 'knockout'
    and coalesce(m.bracket, 'Cup') = 'Cup'
    and m.round = latest_round;
  get diagnostics deleted_count = row_count;

  return jsonb_build_object('round', latest_round, 'deleted_matches', deleted_count);
end;
$$;

revoke all on function public.rollback_knockout_latest_round_atomic(bigint) from public, anon;
grant execute on function public.rollback_knockout_latest_round_atomic(bigint) to authenticated;

create or replace function public.delete_knockout_matches_for_tournament_teardown(p_tournament_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  perform pg_advisory_xact_lock(public.knockout_roster_lock_key(p_tournament_id));

  if not public.is_knockout_only_tournament(p_tournament_id) then
    return 0;
  end if;

  perform set_config('app.knockout_controlled_delete', 'on', true);
  delete from public.matches where tournament_id = p_tournament_id and stage = 'knockout';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_knockout_matches_for_tournament_teardown(bigint) from public, anon, authenticated;
grant execute on function public.delete_knockout_matches_for_tournament_teardown(bigint) to service_role;
