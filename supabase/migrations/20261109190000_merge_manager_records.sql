-- Duplicate manager records and stale names.
--
-- A Youth Cup entry or an old import sometimes created a manager record of its
-- own ("MrTRX", "Pedro", "Melvin Udall") beside the record Soccer Manager Sync
-- keeps for the same person by their Soccer Manager ID ("Mister TRX", "Pedro
-- Vilar", "Melvin Udall 5️⃣8️⃣"). Account approval then matched the wrong one
-- ("This manager is inactive in Top 100"). Sync also kept the first name it saw,
-- so renamed accounts kept old names ("Steven Gerrard" for Jim Wilko).
--
-- 1. merge_manager_records(from, into): moves everything that refers to one
--    record onto the other (every foreign key to managers, plus Sync's identity
--    links), drops rows that would duplicate the target's own (a membership the
--    target already has) and deletes the merged record, returning what moved.
--    Administrators only.
-- 2. Every manager Sync links to a Soccer Manager ID takes that account's current
--    Soccer Manager name, and Sync keeps it current from now on.
-- 3. The duplicates found on 9 November 2026 are merged into the Sync record.
-- 4. Seven former Regen managers without a club have their Regen memberships closed.
--
-- Patched in place (Sync): the anchor must match exactly once, or nothing changes.

create or replace function public.merge_manager_records(p_from bigint, p_into bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref record;
  v_row record;
  v_member public.manager_game_world_memberships;
  v_moved integer := 0;
  v_dropped integer := 0;
  v_links integer := 0;
  v_from_name text;
  v_into_name text;
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if p_from is null or p_into is null or p_from = p_into then
    raise exception 'Choose two different manager records';
  end if;
  select display_name into v_from_name from public.managers where id = p_from for update;
  if not found then raise exception 'Manager % not found', p_from; end if;
  select display_name into v_into_name from public.managers where id = p_into for update;
  if not found then raise exception 'Manager % not found', p_into; end if;

  -- Game world memberships first: the target keeps its own; one it lacks is moved
  -- by deleting and re-adding, so the Top 100 cap of 100 active managers never
  -- counts the same manager twice during the move.
  for v_member in select * from public.manager_game_world_memberships where manager_id = p_from loop
    delete from public.manager_game_world_memberships where manager_id = p_from and game_world_id = v_member.game_world_id;
    if exists (select 1 from public.manager_game_world_memberships where manager_id = p_into and game_world_id = v_member.game_world_id) then
      v_dropped := v_dropped + 1;
    else
      insert into public.manager_game_world_memberships (manager_id, game_world_id, active, created_at, updated_at)
      values (p_into, v_member.game_world_id, v_member.active, v_member.created_at, now());
      v_moved := v_moved + 1;
    end if;
  end loop;

  -- Every other single-column foreign key to managers.id.
  for v_ref in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.managers'::regclass and array_length(c.conkey, 1) = 1
  loop
    for v_row in execute format('select ctid from %s where %I = $1', v_ref.tbl, v_ref.col) using p_from loop
      begin
        execute format('update %s set %I = $1 where ctid = $2', v_ref.tbl, v_ref.col) using p_into, v_row.ctid;
        v_moved := v_moved + 1;
      exception when unique_violation then
        -- The target already has this row (e.g. the same game world membership).
        execute format('delete from %s where ctid = $1', v_ref.tbl) using v_row.ctid;
        v_dropped := v_dropped + 1;
      end;
    end loop;
  end loop;

  update public.soccer_manager_archive_links
  set target_id = p_into, updated_at = now()
  where target_type = 'manager' and target_id = p_from;
  get diagnostics v_links = row_count;

  delete from public.managers where id = p_from;

  return jsonb_build_object('merged', p_from, 'merged_name', v_from_name, 'into', p_into, 'into_name', v_into_name,
    'moved', v_moved, 'dropped_duplicates', v_dropped, 'identity_links', v_links);
end;
$$;

revoke all on function public.merge_manager_records(bigint, bigint) from public, anon;
grant execute on function public.merge_manager_records(bigint, bigint) to authenticated, service_role;

-- 2. Current Soccer Manager names for every Sync-linked manager.
update public.managers m
set name = latest.source_name, display_name = latest.source_name, canonical_name = latest.source_name
from (
  select distinct on (target_id) target_id, nullif(trim(source_name), '') as source_name
  from public.soccer_manager_archive_links
  where source_type = 'manager' and target_type = 'manager' and source_key like 'manager:%'
  order by target_id, updated_at desc
) latest
where latest.target_id = m.id and latest.source_name is not null
  and (m.display_name is distinct from latest.source_name or m.name is distinct from latest.source_name);

do $migration$
declare
  v_anchor text := E'      update public.managers\n        set active = true\n      where id = v_manager_id;';
  v_patch text := E'      -- The person keeps their record; the name follows their Soccer Manager account.\n'
    || E'      update public.managers\n'
    || E'        set active = true,\n'
    || E'            name = coalesce(nullif(trim(v_manager_name), ''''), name),\n'
    || E'            display_name = coalesce(nullif(trim(v_manager_name), ''''), display_name),\n'
    || E'            canonical_name = coalesce(nullif(trim(v_manager_name), ''''), canonical_name)\n'
    || E'      where id = v_manager_id;';
  v_ddl text;
begin
  v_ddl := pg_get_functiondef('public.apply_soccer_manager_core_archive(text)'::regprocedure);
  if (length(v_ddl) - length(replace(v_ddl, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'apply_soccer_manager_core_archive anchor was not found exactly once; refusing an unsafe migration';
  end if;
  execute replace(v_ddl, v_anchor, v_patch);
end;
$migration$;

revoke all on function public.apply_soccer_manager_core_archive(text) from public;
grant execute on function public.apply_soccer_manager_core_archive(text) to authenticated;
grant execute on function public.apply_soccer_manager_core_archive(text) to service_role;

-- 3. Duplicates found on 9 November 2026 (each merged only if both records still exist).
do $merges$
declare
  pair bigint[];
begin
  foreach pair slice 1 in array array[
    [99, 140],   -- MrTRX (S28 Youth Cup, Sevilla) -> Mister TRX
    [100, 526],  -- Pedro (S28 Youth Cup, Tottenham) -> Pedro Vilar
    [130, 89],   -- James McKenzie (import) -> James Mckenzie
    [533, 94],   -- Sir Stephen Beddows (God) (import) -> Sync record
    [536, 96],   -- Steven Allington (import) -> Sync record
    [87, 515]    -- Melvin Udall (S28 Youth Cup, entries already moved) -> Melvin Udall
  ]::bigint[][] loop
    if exists (select 1 from public.managers where id = pair[1]) and exists (select 1 from public.managers where id = pair[2]) then
      perform public.merge_manager_records(pair[1], pair[2]);
    end if;
  end loop;
end;
$merges$;

-- 4. Former Top 100 Regen managers who no longer have a club (confirmed by the
--    administrators, 9 November 2026): their Regen memberships close. Their records
--    and history stay.
update public.manager_game_world_memberships mm
set active = false, updated_at = now()
from public.game_worlds w
where w.id = mm.game_world_id and w.slug = 'regen' and mm.active
  and mm.manager_id in (
    477, -- ⚔ Andrea Marchese ⚔
    474, -- Alexandre Almeida
    484, -- Chris Waters
    490, -- des wild
    503, -- john james
    510, -- mackem in andeʀlecht
    537  -- Tharanidharan
  );
