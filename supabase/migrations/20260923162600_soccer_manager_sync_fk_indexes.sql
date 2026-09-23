-- Cover foreign keys introduced by Soccer Manager sync staging.
create index if not exists soccer_manager_sync_runs_created_by_idx
  on public.soccer_manager_sync_runs(created_by)
  where created_by is not null;

create index if not exists soccer_manager_sync_changes_reviewed_by_idx
  on public.soccer_manager_sync_changes(reviewed_by)
  where reviewed_by is not null;

create index if not exists soccer_manager_canonical_approved_by_idx
  on public.soccer_manager_canonical_entities(approved_by)
  where approved_by is not null;

create index if not exists soccer_manager_canonical_last_run_idx
  on public.soccer_manager_canonical_entities(last_run_id)
  where last_run_id is not null;
