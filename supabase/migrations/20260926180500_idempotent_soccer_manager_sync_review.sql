-- Serialize Soccer Manager review transitions across runs and first-time canonical creation.

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
  change_run_id bigint;
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

  select run_id
  into change_run_id
  from public.soccer_manager_sync_changes
  where id = target_change_id;

  if not found then
    raise exception 'Soccer Manager sync change not found';
  end if;

  -- Serialize every review transition for this run before locking a change row.
  -- This keeps the pending-count/status transition correct under concurrent reviewers.
  perform 1
  from public.soccer_manager_sync_runs
  where id = change_run_id
  for update;

  if not found then
    raise exception 'Soccer Manager sync run not found';
  end if;

  select *
  into change_row
  from public.soccer_manager_sync_changes
  where id = target_change_id
  for update;

  if change_row.status <> 'pending' then
    return change_row;
  end if;

  if target_decision = 'approved' then
    -- Canonical rows may not exist yet, so row locks alone cannot serialize
    -- competing first approvals. Lock the stable entity identity as well.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(change_row.entity_type || E'\x1f' || change_row.entity_key, 0)
    );

    select data, version
    into current_data, current_version
    from public.soccer_manager_canonical_entities
    where entity_type = change_row.entity_type
      and entity_key = change_row.entity_key
    for update;
    canonical_found := found;

    -- Duplicate transport batches are safe when an earlier approval already
    -- produced exactly the value this staged change wants.
    if canonical_found and current_data is not distinct from change_row.after_data then
      null;
    else
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
  lock_row record;
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
    -- Lock every entity identity in deterministic order. Advisory locks also
    -- serialize the first approval when no canonical row exists yet.
    for lock_row in
      select change.entity_type, change.entity_key
      from public.soccer_manager_sync_changes change
      where change.run_id = target_run_id
        and change.status = 'pending'
      order by change.entity_type, change.entity_key
    loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(lock_row.entity_type || E'\x1f' || lock_row.entity_key, 0)
      );
    end loop;

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
        and canonical.data is distinct from change.after_data
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
    left join public.soccer_manager_canonical_entities current_canonical
      on current_canonical.entity_type = change.entity_type
     and current_canonical.entity_key = change.entity_key
    where change.run_id = target_run_id
      and change.status = 'pending'
      and (current_canonical.entity_key is null or current_canonical.data is distinct from change.after_data)
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


revoke all on function public.review_soccer_manager_sync_change(bigint,text) from public, anon;
revoke all on function public.review_soccer_manager_sync_run(bigint,text) from public, anon;
grant execute on function public.review_soccer_manager_sync_change(bigint,text) to authenticated, service_role;
grant execute on function public.review_soccer_manager_sync_run(bigint,text) to authenticated, service_role;
