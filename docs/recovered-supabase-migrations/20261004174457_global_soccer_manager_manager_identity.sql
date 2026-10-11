-- Resolve Soccer Manager manager identity globally by stable manager ID.
-- Club identity remains world-scoped elsewhere in the core archive adapter.
do $migration$
declare
  conflict_record record;
  alias_record record;
  function_ddl text;
  old_block constant text := E'    select target_id\n      into v_manager_id\n    from public.soccer_manager_archive_links\n    where source_type = ''manager''\n      and source_key = setup_id || '':'' || v_manager_source_id\n      and target_type = ''manager'';\n\n    if v_manager_id is not null\n       and not exists (select 1 from public.managers where id = v_manager_id) then\n      delete from public.soccer_manager_archive_links\n      where source_type = ''manager''\n        and source_key = setup_id || '':'' || v_manager_source_id;\n      v_manager_id := null;\n    end if;\n\n    if v_manager_id is null then\n      select count(*)::integer, min(id)\n        into v_case_matches, v_manager_id\n      from public.managers\n      where public.normal_registration_key(coalesce(display_name, canonical_name, name))\n        = public.normal_registration_key(v_manager_name);\n\n      if v_case_matches = 0 then\n        insert into public.managers(name, canonical_name, display_name, active)\n        values (v_manager_name, v_manager_name, v_manager_name, true)\n        returning id into v_manager_id;\n      elsif v_case_matches > 1 then\n        raise exception ''Ambiguous Top 100 manager match for Soccer Manager manager % (%)'', v_manager_name, v_manager_source_id;\n      end if;\n\n      insert into public.soccer_manager_archive_links (\n        source_type, source_key, target_type, target_id, source_name\n      ) values (\n        ''manager'', setup_id || '':'' || v_manager_source_id, ''manager'', v_manager_id, v_manager_name\n      )\n      on conflict (source_type, source_key) do update\n        set target_type = excluded.target_type,\n            target_id = excluded.target_id,\n            source_name = excluded.source_name,\n            updated_at = now();\n    else\n      update public.managers\n        set active = true\n      where id = v_manager_id;\n\n      update public.soccer_manager_archive_links\n        set source_name = v_manager_name,\n            updated_at = now()\n      where source_type = ''manager''\n        and source_key = setup_id || '':'' || v_manager_source_id\n        and target_type = ''manager''\n        and target_id = v_manager_id;\n    end if;';
  new_block constant text := E'    -- Soccer Manager manager IDs are stable across worlds. Resolve the person\n    -- globally; setup/world scoping belongs to the club assignment, not identity.\n    select target_id\n      into v_manager_id\n    from public.soccer_manager_archive_links\n    where source_type = ''manager''\n      and source_key = ''manager:'' || v_manager_source_id\n      and target_type = ''manager'';\n\n    if v_manager_id is not null\n       and not exists (select 1 from public.managers where id = v_manager_id) then\n      delete from public.soccer_manager_archive_links\n      where source_type = ''manager''\n        and source_key = ''manager:'' || v_manager_source_id;\n      v_manager_id := null;\n    end if;\n\n    if v_manager_id is null then\n      -- Migration/back-compat only: an existing setup-scoped stable-ID alias is\n      -- stronger evidence than a display name. Never merge by name here.\n      select count(distinct target_id)::integer, min(target_id)\n        into v_case_matches, v_manager_id\n      from public.soccer_manager_archive_links\n      where source_type = ''manager''\n        and source_key ~ (''^[^:]+:'' || v_manager_source_id || ''$'')\n        and target_type = ''manager'';\n\n      if v_case_matches > 1 then\n        raise exception ''Conflicting canonical managers for Soccer Manager manager ID %'', v_manager_source_id;\n      elsif v_case_matches = 0 then\n        insert into public.managers(name, canonical_name, display_name, active)\n        values (v_manager_name, v_manager_name, v_manager_name, true)\n        returning id into v_manager_id;\n      end if;\n\n      insert into public.soccer_manager_archive_links (\n        source_type, source_key, target_type, target_id, source_name\n      ) values (\n        ''manager'', ''manager:'' || v_manager_source_id, ''manager'', v_manager_id, v_manager_name\n      )\n      on conflict (source_type, source_key) do update\n        set target_type = excluded.target_type,\n            target_id = excluded.target_id,\n            source_name = excluded.source_name,\n            updated_at = now();\n    else\n      update public.managers\n        set active = true\n      where id = v_manager_id;\n\n      update public.soccer_manager_archive_links\n        set source_name = v_manager_name,\n            updated_at = now()\n      where source_type = ''manager''\n        and source_key = ''manager:'' || v_manager_source_id\n        and target_type = ''manager''\n        and target_id = v_manager_id;\n    end if;';
begin
  select stable_id, array_agg(distinct target_id order by target_id) as target_ids
    into conflict_record
  from (
    select regexp_replace(source_key, '^.*:', '') as stable_id, target_id
    from public.soccer_manager_archive_links
    where source_type = 'manager'
      and target_type = 'manager'
      and source_key ~ '^[^:]+:[^:]+$'
  ) aliases
  group by stable_id
  having count(distinct target_id) > 1
  limit 1;

  if conflict_record.stable_id is not null then
    raise exception 'Conflicting legacy aliases for Soccer Manager manager ID %: %', conflict_record.stable_id, conflict_record.target_ids;
  end if;

  for alias_record in
    select regexp_replace(source_key, '^.*:', '') as stable_id,
           min(target_id) as target_id,
           max(source_name) as source_name
    from public.soccer_manager_archive_links
    where source_type = 'manager'
      and target_type = 'manager'
      and source_key ~ '^[^:]+:[^:]+$'
    group by regexp_replace(source_key, '^.*:', '')
  loop
    insert into public.soccer_manager_archive_links (source_type, source_key, target_type, target_id, source_name)
    values ('manager', 'manager:' || alias_record.stable_id, 'manager', alias_record.target_id, alias_record.source_name)
    on conflict (source_type, source_key) do update
      set target_type = excluded.target_type,
          target_id = excluded.target_id,
          source_name = coalesce(excluded.source_name, public.soccer_manager_archive_links.source_name),
          updated_at = now()
    where public.soccer_manager_archive_links.target_id = excluded.target_id;
  end loop;

  select pg_get_functiondef(p.oid) into function_ddl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_soccer_manager_core_archive'
    and pg_get_function_identity_arguments(p.oid) = 'target_setup_id text';

  if function_ddl is null then raise exception 'apply_soccer_manager_core_archive(text) was not found'; end if;
  if position(old_block in function_ddl) = 0 then raise exception 'Expected setup-scoped manager identity block was not found; refusing an unsafe migration'; end if;
  function_ddl := replace(function_ddl, old_block, new_block);
  execute function_ddl;
end;
$migration$;