-- Tighten privileges for private Soccer Manager sync staging tables.
-- RLS remains defense in depth; browser roles receive read-only table privileges.

revoke all on table public.soccer_manager_sync_runs from anon, authenticated;
revoke all on table public.soccer_manager_sync_changes from anon, authenticated;
revoke all on table public.soccer_manager_canonical_entities from anon, authenticated;

grant select on table public.soccer_manager_sync_runs to authenticated;
grant select on table public.soccer_manager_sync_changes to authenticated;
grant select on table public.soccer_manager_canonical_entities to authenticated;

grant select, insert, update, delete on table public.soccer_manager_sync_runs to service_role;
grant select, insert, update, delete on table public.soccer_manager_sync_changes to service_role;
grant select, insert, update, delete on table public.soccer_manager_canonical_entities to service_role;

grant usage, select on sequence public.soccer_manager_sync_runs_id_seq to service_role;
grant usage, select on sequence public.soccer_manager_sync_changes_id_seq to service_role;
