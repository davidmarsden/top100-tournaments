alter table public.soccer_manager_sync_runs
  add column if not exists import_id uuid;

create index if not exists soccer_manager_sync_runs_import_idx
  on public.soccer_manager_sync_runs(import_id, id)
  where import_id is not null;

create or replace function public.stage_soccer_manager_sync(
  target_payload jsonb,
  target_entities jsonb,
  target_captured_at timestamptz default now(),
  target_import_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id uuid := (select auth.uid());
  new_run_id bigint;
  entity_total integer;
  source_total integer;
  changed_total integer;
begin
  if user_id is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if jsonb_typeof(target_payload) <> 'array' then raise exception 'Normalized payload must be a JSON array'; end if;
  if jsonb_typeof(target_entities) <> 'array' then raise exception 'Normalized entities must be a JSON array'; end if;

  source_total := jsonb_array_length(target_payload);
  entity_total := jsonb_array_length(target_entities);
  if source_total > 100 then raise exception 'Too many Soccer Manager source payloads in one sync'; end if;
  if entity_total > 5000 then raise exception 'Too many Soccer Manager entities in one sync'; end if;

  insert into public.soccer_manager_sync_runs (
    captured_at, source_count, entity_count, normalized_payload, created_by, import_id
  ) values (
    coalesce(target_captured_at, now()), source_total, entity_total, target_payload, user_id, target_import_id
  ) returning id into new_run_id;

  insert into public.soccer_manager_sync_changes (
    run_id, entity_type, entity_key, scope_key, change_kind, before_data, baseline_version, after_data
  )
  select new_run_id, entity.entity_type, entity.entity_key, entity.scope_key,
    case when canonical.entity_key is null then 'new' else 'changed' end,
    canonical.data, canonical.version, entity.data
  from (
    select nullif(trim(item->>'entityType'), '') entity_type,
      nullif(trim(item->>'entityKey'), '') entity_key,
      nullif(trim(item->>'scopeKey'), '') scope_key,
      item->'data' data
    from jsonb_array_elements(target_entities) item
  ) entity
  left join public.soccer_manager_canonical_entities canonical
    on canonical.entity_type = entity.entity_type and canonical.entity_key = entity.entity_key
  where entity.entity_type is not null and entity.entity_key is not null and entity.data is not null
    and (canonical.entity_key is null or canonical.data is distinct from entity.data);

  get diagnostics changed_total = row_count;
  update public.soccer_manager_sync_runs set change_count = changed_total where id = new_run_id;
  return new_run_id;
end;
$$;

revoke all on function public.stage_soccer_manager_sync(jsonb, jsonb, timestamptz, uuid) from public;
grant execute on function public.stage_soccer_manager_sync(jsonb, jsonb, timestamptz, uuid) to authenticated;
grant execute on function public.stage_soccer_manager_sync(jsonb, jsonb, timestamptz, uuid) to service_role;
