-- Follow-up for already-applied v0.3 sync staging: record canonical baseline versions
-- and reject approvals when the canonical source has changed since staging.

alter table public.soccer_manager_sync_changes
  add column if not exists baseline_version integer;

update public.soccer_manager_sync_changes change
set baseline_version = canonical.version
from public.soccer_manager_canonical_entities canonical
where change.baseline_version is null
  and change.before_data is not null
  and canonical.entity_type = change.entity_type
  and canonical.entity_key = change.entity_key
  and canonical.data = change.before_data;

create or replace function public.stage_soccer_manager_sync(
  target_payload jsonb,
  target_entities jsonb,
  target_captured_at timestamptz default now()
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

  if jsonb_typeof(target_payload) <> 'array' then
    raise exception 'Normalized payload must be a JSON array';
  end if;
  if jsonb_typeof(target_entities) <> 'array' then
    raise exception 'Normalized entities must be a JSON array';
  end if;

  source_total := jsonb_array_length(target_payload);
  entity_total := jsonb_array_length(target_entities);

  if source_total > 100 then
    raise exception 'Too many Soccer Manager source payloads in one sync';
  end if;
  if entity_total > 5000 then
    raise exception 'Too many Soccer Manager entities in one sync';
  end if;

  insert into public.soccer_manager_sync_runs (
    captured_at,
    source_count,
    entity_count,
    normalized_payload,
    created_by
  ) values (
    coalesce(target_captured_at, now()),
    source_total,
    entity_total,
    target_payload,
    user_id
  )
  returning id into new_run_id;

  insert into public.soccer_manager_sync_changes (
    run_id,
    entity_type,
    entity_key,
    scope_key,
    change_kind,
    before_data,
    baseline_version,
    after_data
  )
  select
    new_run_id,
    entity.entity_type,
    entity.entity_key,
    entity.scope_key,
    case when canonical.entity_key is null then 'new' else 'changed' end,
    canonical.data,
    canonical.version,
    entity.data
  from (
    select
      nullif(trim(item->>'entityType'), '') as entity_type,
      nullif(trim(item->>'entityKey'), '') as entity_key,
      nullif(trim(item->>'scopeKey'), '') as scope_key,
      item->'data' as data
    from jsonb_array_elements(target_entities) item
  ) entity
  left join public.soccer_manager_canonical_entities canonical
    on canonical.entity_type = entity.entity_type
   and canonical.entity_key = entity.entity_key
  where entity.entity_type is not null
    and entity.entity_key is not null
    and entity.data is not null
    and canonical.data is distinct from entity.data;

  get diagnostics changed_total = row_count;

  update public.soccer_manager_sync_runs
    set change_count = changed_total,
        status = case when changed_total = 0 then 'reviewed' else 'staged' end,
        reviewed_at = case when changed_total = 0 then now() else null end
  where id = new_run_id;

  return new_run_id;
end;
$$;

create or replace function public.review_soccer_manager_sync_change(
  target_change_id bigint,
  target_decision text
)
returns public.soccer_manager_sync_changes
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id uuid := (select auth.uid());
  change_row public.soccer_manager_sync_changes%rowtype;
  current_data jsonb;
  current_version integer;
  canonical_found boolean;
  remaining_pending integer;
begin
  if user_id is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if target_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select *
  into change_row
  from public.soccer_manager_sync_changes
  where id = target_change_id
  for update;

  if not found then
    raise exception 'Soccer Manager sync change not found';
  end if;
  if change_row.status <> 'pending' then
    return change_row;
  end if;

  if target_decision = 'approved' then
    select data, version
    into current_data, current_version
    from public.soccer_manager_canonical_entities
    where entity_type = change_row.entity_type
      and entity_key = change_row.entity_key
    for update;
    canonical_found := found;

    if change_row.before_data is null then
      if canonical_found then
        raise exception 'Stale Soccer Manager sync change: canonical entity was created after this run was staged';
      end if;
    elsif not canonical_found
       or current_version is distinct from change_row.baseline_version
       or current_data is distinct from change_row.before_data then
      raise exception 'Stale Soccer Manager sync change: canonical entity changed after this run was staged';
    end if;

    insert into public.soccer_manager_canonical_entities (
      entity_type,
      entity_key,
      scope_key,
      data,
      version,
      first_approved_at,
      last_approved_at,
      approved_by,
      last_run_id
    ) values (
      change_row.entity_type,
      change_row.entity_key,
      change_row.scope_key,
      change_row.after_data,
      1,
      now(),
      now(),
      user_id,
      change_row.run_id
    )
    on conflict (entity_type, entity_key) do update
      set scope_key = excluded.scope_key,
          data = excluded.data,
          version = public.soccer_manager_canonical_entities.version + 1,
          last_approved_at = now(),
          approved_by = user_id,
          last_run_id = change_row.run_id;
  end if;

  update public.soccer_manager_sync_changes
    set status = target_decision,
        reviewed_by = user_id,
        reviewed_at = now()
  where id = change_row.id
  returning * into change_row;

  select count(*)::integer
  into remaining_pending
  from public.soccer_manager_sync_changes
  where run_id = change_row.run_id
    and status = 'pending';

  update public.soccer_manager_sync_runs
    set status = case when remaining_pending = 0 then 'reviewed' else 'partially_reviewed' end,
        reviewed_at = case when remaining_pending = 0 then now() else null end
  where id = change_row.run_id;

  return change_row;
end;
$$;

create or replace function public.review_soccer_manager_sync_run(
  target_run_id bigint,
  target_decision text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id uuid := (select auth.uid());
  reviewed_count integer := 0;
begin
  if user_id is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if target_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  perform 1
  from public.soccer_manager_sync_runs
  where id = target_run_id
  for update;
  if not found then
    raise exception 'Soccer Manager sync run not found';
  end if;

  if target_decision = 'approved' then
    perform 1
    from public.soccer_manager_canonical_entities canonical
    join public.soccer_manager_sync_changes change
      on change.entity_type = canonical.entity_type
     and change.entity_key = canonical.entity_key
    where change.run_id = target_run_id
      and change.status = 'pending'
    for update of canonical;

    if exists (
      select 1
      from public.soccer_manager_sync_changes change
      left join public.soccer_manager_canonical_entities canonical
        on canonical.entity_type = change.entity_type
       and canonical.entity_key = change.entity_key
      where change.run_id = target_run_id
        and change.status = 'pending'
        and (
          (change.before_data is null and canonical.entity_key is not null)
          or
          (change.before_data is not null and (
            canonical.entity_key is null
            or canonical.version is distinct from change.baseline_version
            or canonical.data is distinct from change.before_data
          ))
        )
    ) then
      raise exception 'Stale Soccer Manager sync run: canonical source changed after this run was staged; review the newer state before bulk approval';
    end if;

    insert into public.soccer_manager_canonical_entities (
      entity_type,
      entity_key,
      scope_key,
      data,
      version,
      first_approved_at,
      last_approved_at,
      approved_by,
      last_run_id
    )
    select
      change.entity_type,
      change.entity_key,
      change.scope_key,
      change.after_data,
      1,
      now(),
      now(),
      user_id,
      change.run_id
    from public.soccer_manager_sync_changes change
    where change.run_id = target_run_id
      and change.status = 'pending'
    on conflict (entity_type, entity_key) do update
      set scope_key = excluded.scope_key,
          data = excluded.data,
          version = public.soccer_manager_canonical_entities.version + 1,
          last_approved_at = now(),
          approved_by = user_id,
          last_run_id = target_run_id;
  end if;

  update public.soccer_manager_sync_changes
    set status = target_decision,
        reviewed_by = user_id,
        reviewed_at = now()
  where run_id = target_run_id
    and status = 'pending';

  get diagnostics reviewed_count = row_count;

  update public.soccer_manager_sync_runs
    set status = 'reviewed',
        reviewed_at = now()
  where id = target_run_id;

  return reviewed_count;
end;
$$;



revoke all on function public.stage_soccer_manager_sync(jsonb,jsonb,timestamptz) from public, anon;
revoke all on function public.review_soccer_manager_sync_change(bigint,text) from public, anon;
revoke all on function public.review_soccer_manager_sync_run(bigint,text) from public, anon;

grant execute on function public.stage_soccer_manager_sync(jsonb,jsonb,timestamptz) to authenticated, service_role;
grant execute on function public.review_soccer_manager_sync_change(bigint,text) to authenticated, service_role;
grant execute on function public.review_soccer_manager_sync_run(bigint,text) to authenticated, service_role;
