# SQL comparison findings — 11 October 2026

Read-only comparisons of stored `supabase_migrations.schema_migrations.statements` with the current `top100-tournaments` SQL files:

| Remote version | Remote name | Local file | Comparison |
|---|---|---|---|
| 20261004081416 | sm_id_manager_identities | 20261004083000_sm_id_manager_identities.sql | **Different SQL** (5,345 vs 6,205 characters) |
| 20261004093216 | derive_manager_assignments_from_matches | 20261004113000_derive_manager_assignments_from_matches.sql | **Different SQL** (4,284 vs 4,688 characters) |
| 20261004102738 | allow_service_manager_assignment_refresh | 20261004114500_allow_service_manager_assignment_refresh.sql | **Different SQL** (3,573 vs 4,737 characters) |
| 20261002154123 | audited_voting_deadline_edits | 20261002_audited_voting_deadline_edits.sql | Equal after trimming trailing whitespace |

**Do not rename the first three local files to the remote versions.** Their contents are not identical, despite matching names. They may be revisions or different implementations; the SQL differences require review before any reconciliation.

The companion CSV lists all 130 remote IDs and filename-based candidates across both repositories, with leading legacy `z_` prefixes normalized. It is **candidate mapping only**, not proof of equivalence.

No production SQL was changed or executed; only read-only migration-history queries were used.
