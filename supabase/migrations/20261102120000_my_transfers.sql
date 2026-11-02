-- Transfers for the Manager Portal: the signed-in manager's completed buys and sales in a game
-- world, and the latest completed deals there, from the transfers Sync captures.
create or replace function public.get_my_transfers(p_game_world_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_manager bigint;
  v_world bigint;
begin
  select account.manager_id, coalesce(p_game_world_id, account.game_world_id) into v_manager, v_world
  from public.manager_portal_accounts account
  where account.auth_user_id = auth.uid() and account.active
  order by account.id limit 1;
  if v_manager is null then return null; end if;

  return jsonb_build_object(
    'worldId', v_world,
    'mine', coalesce((select jsonb_agg(row order by row->>'seenAt' desc) from (
      select jsonb_build_object(
        'id', transfer.id, 'player', transfer.player_name, 'position', transfer.position, 'rating', transfer.rating,
        'age', transfer.age, 'fee', transfer.amount, 'from', transfer.from_club_name, 'to', transfer.to_club_name,
        'direction', case when transfer.to_manager_id = v_manager then 'in' else 'out' end,
        'seenAt', transfer.first_seen_at) as row
      from public.soccer_manager_transfers transfer
      where transfer.game_world_id = v_world and transfer.status = 9
        and v_manager in (transfer.from_manager_id, transfer.to_manager_id)
      order by transfer.first_seen_at desc limit 10) mine), '[]'::jsonb),
    'latest', coalesce((select jsonb_agg(row order by row->>'seenAt' desc) from (
      select jsonb_build_object(
        'id', transfer.id, 'player', transfer.player_name, 'position', transfer.position, 'rating', transfer.rating,
        'age', transfer.age, 'fee', transfer.amount, 'from', transfer.from_club_name, 'to', transfer.to_club_name,
        'seenAt', transfer.first_seen_at) as row
      from public.soccer_manager_transfers transfer
      where transfer.game_world_id = v_world and transfer.status = 9
      order by transfer.first_seen_at desc, transfer.id desc limit 15) latest), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_my_transfers(bigint) from public, anon;
grant execute on function public.get_my_transfers(bigint) to authenticated;
