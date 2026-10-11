do $migration$
declare
  function_ddl text;
  old_guard constant text := E'if user_id is null or not public.is_admin() then\n    raise exception ''Global admin access required'';\n  end if;';
  new_guard constant text := E'if coalesce(auth.role(), '''') <> ''service_role''\n     and (user_id is null or not public.is_admin()) then\n    raise exception ''Global admin access required'';\n  end if;';
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

  if position(old_guard in function_ddl) = 0 then
    raise exception 'Expected core archive authorization guard was not found; refusing an unsafe migration';
  end if;

  function_ddl := replace(function_ddl, old_guard, new_guard);
  execute function_ddl;
end;
$migration$;

revoke all on function public.apply_soccer_manager_core_archive(text) from public;
grant execute on function public.apply_soccer_manager_core_archive(text) to authenticated;
grant execute on function public.apply_soccer_manager_core_archive(text) to service_role;