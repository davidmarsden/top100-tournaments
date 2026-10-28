-- Approved squad-player changes, for numbering player snapshot versions from the index alone
-- (apply_soccer_manager_player_transfer_archive_step, snapshots step) without reading each
-- change's after_data. See 20261028180953_faster_player_snapshot_archive.sql.
create index if not exists soccer_manager_sync_changes_squad_player_approved_idx
  on public.soccer_manager_sync_changes (entity_key, id)
  include (run_id, reviewed_at, created_at)
  where entity_type = 'squad_player' and status = 'approved';

analyze public.soccer_manager_sync_changes;
