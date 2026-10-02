# Community Poll deadline editing

Administrators can change the closing date/time of a Community Poll while it is in `draft` or `open` status.

The deadline change is deliberately separate from poll creation and electorate snapshotting. Updating `closes_at` does **not** recreate the poll, change the frozen electorate, or alter existing ballots.

Deadline changes go through the admin-only `update_voting_event_deadline` RPC and are recorded in `voting_audit_log` as `event_deadline_updated`, including the old and new deadlines.

Closed/finalised polls cannot have their deadline changed through this control.
