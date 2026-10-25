-- My Matches gets a game-world switcher: the app home also returns every world where the
-- signed-in manager currently has a club, so the page can offer one tab per world.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_my_top100_app_home_for_world(bigint)'::regprocedure);
  derived text;
begin
  derived := replace(definition,
    E'    ''nextFixture'', v_next\n  );',
    E'    ''nextFixture'', v_next,\n'
    || E'    ''worlds'', (\n'
    || E'      select coalesce(jsonb_agg(jsonb_build_object(''id'', world.id, ''name'', world.name, ''slug'', world.slug, ''club'', team.name) order by world.id), ''[]''::jsonb)\n'
    || E'      from public.soccer_manager_world_manager_assignments assignment\n'
    || E'      join public.game_worlds world on world.id = assignment.game_world_id\n'
    || E'      join public.teams team on team.id = assignment.team_id\n'
    || E'      where assignment.manager_id = v_manager_id\n'
    || E'    )\n'
    || E'  );');
  if position('''worlds'', (' in derived) = 0 then
    raise exception 'get_my_top100_app_home_for_world has an unexpected shape; add worlds by hand';
  end if;
  execute derived;
end
$migration$;
