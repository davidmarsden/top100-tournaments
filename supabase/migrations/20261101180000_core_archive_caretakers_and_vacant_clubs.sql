-- A caretaker took over Fenerbahçe (Benny Hill), but the league table still says
-- the club is unmanaged, so the core archive dropped his assignment and reported it
-- as "skipped because no approved club mapping existed".
--
-- 1. A club also counts as managed when the latest Manager List reading for it
--    (manager_signal_snapshots) is newer than the league-table row and names the
--    same manager as the assignment.
-- 2. Vacant clubs are reported apart from assignments with no club mapping:
--    vacantClubs, vacantClubNames and unmappedAssignments. skippedAssignments stays
--    (their sum) for older callers.
--
-- Patched in place like 20261004164706: every anchor must be found, or nothing changes.

do $migration$
declare
  function_ddl text;
  patches text[][] := array[
    [
      E'  skipped_assignments integer := 0;\n',
      E'  skipped_assignments integer := 0;\n  vacant_clubs integer := 0;\n  vacant_club_names text[] := array[]::text[];\n  v_standing_at timestamptz;\n  v_signal_manager text;\n  v_signal_at timestamptz;\n'
    ],
    [
      E'    end\n      into v_club_managed\n',
      E'    end, standing.last_approved_at\n      into v_club_managed, v_standing_at\n'
    ],
    [
      E'    if coalesce(v_club_managed, false) = false then\n      update public.game_world_clubs\n',
      E'    -- The league table lags behind a change of manager (a caretaker shows as\n'
      || E'    -- unmanaged). A newer Manager List reading naming this manager wins.\n'
      || E'    if coalesce(v_club_managed, false) = false then\n'
      || E'      select signal.sm_manager_id, signal.captured_at\n'
      || E'        into v_signal_manager, v_signal_at\n'
      || E'      from public.manager_signal_snapshots signal\n'
      || E'      where signal.source_world_id::text = setup_id\n'
      || E'        and signal.source_club_id = v_club_id\n'
      || E'      order by signal.captured_at desc, signal.id desc\n'
      || E'      limit 1;\n\n'
      || E'      if v_signal_manager = v_manager_source_id\n'
      || E'         and (v_standing_at is null or v_signal_at > v_standing_at) then\n'
      || E'        v_club_managed := true;\n'
      || E'      end if;\n'
      || E'    end if;\n\n'
      || E'    if coalesce(v_club_managed, false) = false then\n      update public.game_world_clubs\n'
    ],
    [
      E'      skipped_assignments := skipped_assignments + 1;\n      continue;\n    end if;\n\n    -- Soccer Manager manager IDs are stable',
      E'      skipped_assignments := skipped_assignments + 1;\n'
      || E'      vacant_clubs := vacant_clubs + 1;\n'
      || E'      vacant_club_names := vacant_club_names || coalesce(v_existing_source_name, v_existing_team_name, v_club_id);\n'
      || E'      continue;\n    end if;\n\n    -- Soccer Manager manager IDs are stable'
    ],
    [
      E'      ''skippedAssignments'', skipped_assignments\n    ),',
      E'      ''skippedAssignments'', skipped_assignments,\n'
      || E'      ''unmappedAssignments'', skipped_assignments - vacant_clubs,\n'
      || E'      ''vacantClubs'', vacant_clubs,\n'
      || E'      ''vacantClubNames'', to_jsonb(vacant_club_names)\n    ),'
    ],
    [
      E'    ''skippedAssignments'', skipped_assignments\n  );',
      E'    ''skippedAssignments'', skipped_assignments,\n'
      || E'    ''unmappedAssignments'', skipped_assignments - vacant_clubs,\n'
      || E'    ''vacantClubs'', vacant_clubs,\n'
      || E'    ''vacantClubNames'', to_jsonb(vacant_club_names)\n  );'
    ]
  ];
  i integer;
begin
  select pg_get_functiondef(p.oid)
    into function_ddl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_soccer_manager_core_archive'
    and pg_get_function_identity_arguments(p.oid) = 'target_setup_id text';

  if function_ddl is null then
    raise exception 'apply_soccer_manager_core_archive(text) was not found';
  end if;

  for i in 1 .. array_length(patches, 1) loop
    if (length(function_ddl) - length(replace(function_ddl, patches[i][1], ''))) / length(patches[i][1]) <> 1 then
      raise exception 'Core archive patch % anchor was not found exactly once; refusing an unsafe migration', i;
    end if;
    function_ddl := replace(function_ddl, patches[i][1], patches[i][2]);
  end loop;

  execute function_ddl;
end;
$migration$;

revoke all on function public.apply_soccer_manager_core_archive(text) from public;
grant execute on function public.apply_soccer_manager_core_archive(text) to authenticated;
grant execute on function public.apply_soccer_manager_core_archive(text) to service_role;
