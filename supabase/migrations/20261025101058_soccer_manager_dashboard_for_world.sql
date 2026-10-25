-- Squad & transfers always loaded the account's home world, so a Top 100 Regen entry linked to the
-- Top 100 squad. get_my_soccer_manager_dashboard_for_world returns the dashboard for any game world
-- (the manager identity spans worlds); the original function keeps returning the home world.
-- The world-aware version is derived from the current definition so the two cannot drift.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_my_soccer_manager_dashboard()'::regprocedure);
  derived text;
begin
  derived := replace(definition,
    'FUNCTION public.get_my_soccer_manager_dashboard()',
    'FUNCTION public.get_my_soccer_manager_dashboard_for_world(target_game_world_id bigint)');
  derived := replace(derived,
    E'    account.manager_id,\n    account.game_world_id,',
    E'    account.manager_id,\n    world.id,');
  derived := replace(derived,
    'join public.game_worlds world on world.id = account.game_world_id',
    'join public.game_worlds world on world.id = coalesce(target_game_world_id, account.game_world_id)');
  if position('get_my_soccer_manager_dashboard_for_world(target_game_world_id bigint)' in derived) = 0
     or position(E'account.manager_id,\n    world.id,' in derived) = 0
     or position('coalesce(target_game_world_id, account.game_world_id)' in derived) = 0 then
    raise exception 'get_my_soccer_manager_dashboard has an unexpected shape; derive the world version by hand';
  end if;
  execute derived;
end
$migration$;

create or replace function public.get_my_soccer_manager_dashboard()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.get_my_soccer_manager_dashboard_for_world(null);
$$;

revoke all on function public.get_my_soccer_manager_dashboard_for_world(bigint) from public, anon;
grant execute on function public.get_my_soccer_manager_dashboard_for_world(bigint) to authenticated;
revoke all on function public.get_my_soccer_manager_dashboard() from public, anon;
grant execute on function public.get_my_soccer_manager_dashboard() to authenticated;
