-- When a Soccer Manager club changes manager, apply_soccer_manager_core_archive moved the club's
-- assignment to the new manager but left the outgoing manager's world membership active. In
-- Top 100 that tripped the 100-active-manager cap (enforce_top100_active_manager_cap) as soon as
-- the new manager's membership was activated. The outgoing manager now leaves the world, unless
-- they still run another club in it (for example after a swap between two clubs).
--
-- The function is patched in place so the rest of its body stays exactly as deployed. It is left
-- alone if it already has the change.
do $migration$
declare
  definition text;
  patched text;
  anchor constant text := '    insert into public.soccer_manager_world_manager_assignments (';
begin
  definition := pg_get_functiondef('public.apply_soccer_manager_core_archive(text)'::regprocedure);
  if position('outgoing manager leaves this world' in definition) > 0 then
    return;
  end if;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'apply_soccer_manager_core_archive did not match the expected definition';
  end if;

  patched := replace(definition, anchor,
'    -- The club changed manager: the outgoing manager leaves this world unless they still run
    -- another club in it. Done before the new membership is activated (Top 100 caps active managers).
    update public.manager_game_world_memberships membership
      set active = false,
          updated_at = now()
    where membership.game_world_id = v_world_id
      and membership.active = true
      and membership.manager_id in (
        select assignment.manager_id
        from public.soccer_manager_world_manager_assignments assignment
        where assignment.game_world_id = v_world_id
          and assignment.team_id = v_team_id
          and assignment.manager_id is distinct from v_manager_id
      )
      and not exists (
        select 1
        from public.soccer_manager_world_manager_assignments other
        where other.game_world_id = v_world_id
          and other.manager_id = membership.manager_id
          and other.team_id <> v_team_id
      );

' || anchor);
  execute patched;
end;
$migration$;
