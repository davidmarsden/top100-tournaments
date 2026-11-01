-- Follow-up to 20261101180000: compare the Manager List reading with the time the
-- league-table row was captured (its sync run), not when it was approved. A delayed
-- review would otherwise make an older standing look newer than a caretaker's
-- Manager List reading and drop the caretaker.

do $migration$
declare
  function_ddl text;
  old_text constant text := E'    end, standing.last_approved_at\n      into v_club_managed, v_standing_at\n';
  new_text constant text := E'    end,\n'
    || E'    coalesce(\n'
    || E'      (select run.captured_at from public.soccer_manager_sync_runs run where run.id = standing.last_run_id),\n'
    || E'      standing.last_approved_at\n'
    || E'    )\n'
    || E'      into v_club_managed, v_standing_at\n';
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

  if (length(function_ddl) - length(replace(function_ddl, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'Expected standing timestamp anchor was not found exactly once; refusing an unsafe migration';
  end if;

  execute replace(function_ddl, old_text, new_text);
end;
$migration$;

revoke all on function public.apply_soccer_manager_core_archive(text) from public;
grant execute on function public.apply_soccer_manager_core_archive(text) to authenticated;
grant execute on function public.apply_soccer_manager_core_archive(text) to service_role;
