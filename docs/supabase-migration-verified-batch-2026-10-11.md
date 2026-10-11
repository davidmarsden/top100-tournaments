# Migration SQL verification — first batch

Source: read-only query of `supabase_migrations.schema_migrations` on project `xxntutejknolhmbssqdf`, compared with actual blob content on `main` in `top100-tournaments`. These are **raw SQL comparisons**, not parsed-statement equivalence proofs.

| Remote version | Migration | Local filename version | Result |
|---|---|---|---|
| 20260809210943 | manager_forfeit_submissions | 20260809 | Different raw SQL (10498 vs 14607 chars) |
| 20260809211038 | manager_forfeit_rpc_permissions | 20260809 | Different raw SQL (477 vs 704 chars) |
| 20260809211637 | fix_provisional_forfeit_finalisation | 202608092120 | Different raw SQL (7334 vs 7487 chars) |
| 20260816093438 | double_forfeits | 20260816 | Different raw SQL (5966 vs 6902 chars) |
| 20260823141300 | manager_claim_email_notifications | 20260720 | Equal after outer trim |
| 20260823141311 | manager_claim_notification_idempotency_key | 20260823 | Equal after outer trim |
| 20260824174302 | public_tournament_visibility | 20260824 | Equal after outer trim |
| 20260901084740 | tournament_scoped_organisers_and_manager_registration | 20260901 | Different raw SQL (22126 vs 23071 chars) |

**Important:** A Supabase migration's stored `statements` may differ from the original raw file due to parsing and trimming; the different-raw-SQL rows are not yet proven semantic differences. All eight remotely applied versions differ from the local filenames.

The remote history has 130 applied migration records. Across 130 tournament SQL files and 43 Manager Lab SQL files, 22 remote migration names have no direct filename candidate (the list is in the existing candidate inventory). The local version identifiers do not provide a safe basis for automatic renames or marking migrations as applied.

Three more missing remote originals recovered into `docs/recovered-supabase-migrations/`:

- `20260824171251_database_hardening_and_io_optimisation.sql`
- `20260824171332_security_definer_execute_grant_correction.sql`
- `20260901085032_remove_superseded_team_id_registration_rpc.sql`

**Repair gate:** Before replacing files under `supabase/migrations`, classify each local-only SQL change as already applied, superseded, or genuinely pending; compare parsed statements or database effects; then verify the proposed tree with a clean preview database. Do not alter production migration history or run `migration repair` until this is satisfied.
