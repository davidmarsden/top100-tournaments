# Supabase baseline reconstruction — 11 October 2026

Companion to PR #321 (recovered migration history). This records how the pre-9 August database was reconstructed so that a fresh database (Supabase Preview) can replay the full migration history, and every failure met on the way.

## Result

- `supabase/migrations/` now holds **132 files**: the 130 versions recorded in production, plus `20260808000000_baseline_pre_migration_history.sql` and `20260824171250_bridge_tournament_is_public.sql`.
- Replayed into an empty PostgreSQL 17 database, those 132 files produce a `public` schema whose fingerprint is **identical to production across 1,940 objects**: every column (type, nullability, default, identity), constraint, index, function body (whitespace-normalised), function grant, RLS flag, policy, trigger, view and table grant. Storage-bucket policies also match.
- That includes, by name, manager authentication and hand-off (`create_manager_auth_handoff`, `manager_auth_handoffs`), account linking and claims (`approve_manager_portal_claim*`, `find_manager_portal_claim_match*`, `link_manager_to_sm_assignment`, `manager_soccer_manager_identities`), and voting (`submit_voting_ballot`, `open_voting_event`, `get_voting_results`, `voting_*` tables and policies).


### Supabase Preview verification (11 Oct 2026, commit `0c080a2`)

- The Supabase Preview check on PR #322 is **green**. The preview database applied all 132 migrations, `20260808000000` to `20261004213749`.
- The same fingerprint query was run read-only on the preview and on production minutes apart: **identical across all 1,940 objects**, grants included. Storage policies, the `match-evidence` bucket and the `ensure_rls` event trigger also match.
- Production's fingerprint was also unchanged from the start of the session.
- Only difference outside `public`: `pg_net` is installed in the `extensions` schema on the preview and in `public` in production. That's a platform default; the `net.*` functions are the same either way.
- Getting a real run took three corrections that only Supabase could reveal: F12 (`pg_trgm`), F13 (default privileges), and closing and reopening the PR, because Supabase creates preview branches only when a PR is opened.

## Method

1. **Catalog extraction (read-only).** 20 tables in production are created by no SQL file anywhere in the repository's full git history (1,963 commits): `achievements, admin_users, attachments, audit_log, competitions, forfeits, groups, honours, manager_clubs, managers, matches, seasons, settings, team_aliases, teams, tournament_entries, tournament_formats, tournament_rounds, tournament_stages, tournaments`. They were made in the dashboard before July. Their definitions came from production's catalog, **minus every column and constraint that later repo SQL adds**, so the historical scripts still add those themselves. Also from the catalog: `is_admin()` and four public-read policies with no repo source. File: `tools/migration-replay/catalog-objects-not-in-repo.sql`.
2. **Historical replay.** Foundational scripts (`sql/`, `database/`, `supabase/v2-*.sql`, `supabase/match-comments.sql`), then the July migrations, in **first-commit order** (`tools/migration-replay/reconstruct-baseline.order`). Every failure was stopped on, explained and corrected. None was patched blindly.
3. **Baseline.** That state was dumped schema-only and cleaned into the baseline migration. It adds the reference rows the foundational scripts themselves insert (F11) and the auto-RLS event trigger.
4. **Full replay and diff.** Baseline, bridge and the 130 recorded migrations were replayed, then fingerprinted against production (`tools/migration-replay/fingerprint-hash.sql`, run read-only on both). The table below includes the differences that diff exposed.

Diagnostic or data-only scripts were not replayed: `database/2026-07-05-clean-test-tournaments.sql`, `supabase/diagnose-s27-challonge-import.sql`, `supabase/repair-challonge-match-entry-links.sql`.

## Findings

| # | Step that failed | Error | Cause | Correction |
|---|---|---|---|---|
| F0 | First recorded migration `20260809210943` on an empty database | `relation public.manager_result_submissions does not exist` | Nothing in `supabase/migrations` creates the foundational schema; 20 core tables were never in any SQL file. | Baseline migration (method steps 1–3). |
| F1 | `database/2026-07-05-knockout-schedule-presets.sql` | FK `tournament_round_dates_tournament_id_fkey` cannot be implemented: uuid vs bigint | Script declares `id uuid` / `tournament_id uuid`; `tournaments.id` is bigint. Production has `bigint generated always as identity`, `tournament_id bigint`, `timestamptz` columns. The committed script is not what ran. | Baseline creates the table with the production definition; the script then no-ops (`create table if not exists`) and only adds its index. |
| F2 | `20260712_manager_claim_name_matching.sql` | relation `public.manager_portal_claims` does not exist | Ordering, not content. The July files have date-only names, so filename order puts `..._claim_name_matching` (committed 18 Jul) before `..._manager_portal_claims` (committed 12 Jul). | Pre-August files are applied in first-commit order. `20260720_manager_claim_email_notifications.sql` is excluded from the July set: it was committed 23 Aug and is the source of applied migration `20260823141300`. |
| F3 | `20260718_public_youth_winners_archive.sql` | syntax error at or near `position` in `returns table (... position integer ...)` | Genuine defect in the original script. Its successor `..._v2.sql` (committed 20 min later) says it exists to fix exactly this, and is written to work "whether or not the original function was created". The original therefore almost certainly failed in production too. | Skipped in replay; `_v2` supplies the function. No baseline change. |
| F4 | applied `20260824171251_database_hardening_and_io_optimisation.sql` | function `public.get_public_youth_winners()` does not exist | `20260718_remove_unused_public_youth_winners_rpc.sql` drops the function, and nothing re-creates it. But the applied 24 Aug migration revokes on it, and production still has it today. So the removal script was **never applied to production**. | Skipped in replay. **Product note:** an RPC the code meant to retire is still live in production; decide separately whether to drop it in a new migration. |
| F5 | applied `20260824171251_database_hardening_and_io_optimisation.sql` | function `public.rls_auto_enable()` does not exist | Production has `rls_auto_enable()` plus event trigger `ensure_rls`. No repo SQL creates them; they match the snippet in Supabase's RLS docs, so they were run by hand in the SQL editor. | Baseline creates both with the production definition. Its install date is unknown, so the replay installs it from the start (all later tables get RLS on create). |
| F6 | applied `20260824171251_database_hardening_and_io_optimisation.sql` | function `public.tournament_is_public(bigint)` does not exist | Out-of-order history. The function's defining migration `20260824174302_public_tournament_visibility` ran 31 minutes *after* the hardening migration that revokes on it. It must have been created outside migration history (SQL editor or `execute_sql`) in between. | Cannot go in the baseline: as `language sql` its body is validated at creation and needs `tournaments.is_public` (added later by `v2-1`). Corrected with a **bridge migration** `20260824171250_bridge_tournament_is_public`, using the definition from `20260824174302`, which later restates it. Like the baseline, it must be recorded as applied in production, never run there. |
| F7 | applied `20260928145209_snapshot_all_active_top100_managers_for_votes.sql` | FK violation: `voting_electorate.event_id = 5` not in `voting_events` | Production **data repair** inside a migration. It hard-codes poll id 5 (the then-open Level 5 poll), so it can only succeed on production. Seeded managers exist from earlier seed migrations, so the insert has rows to write. Any fresh database, including Supabase Preview, fails here. | Repo file gets a one-line guard `and exists (select 1 from public.voting_events where id = 5)`. On production this changes nothing: the version is already applied and is never re-run. The recovered original stays verbatim in `docs/recovered-supabase-migrations/`. |
| F8 | Schema diff (after full replay) | `find_manager_portal_claim_match(text,text)` differs from production | Production runs the scored "unique best candidate" version from `20260718_manager_claim_matching_v2.sql`. Replaying the files in commit order lets `20260718_manager_claim_suggestions.sql` (committed 7 h later) overwrite it with an older simple version. So that part of `..._suggestions.sql` never took effect in production. Either it was run before `_v2` or `_v2` was re-run afterwards; the record cannot tell which. | Replay uses a copy of `..._suggestions.sql` without its `find_manager_portal_claim_match` redefinition; everything else in it is kept (production has its other objects). End state now matches production. |
| F9 | Schema diff | `canonical_manager_claim_club(text)` differs from production | `20260718_manager_claim_suggestions_v2.sql` ("Fix VfL club matching") adds `vfl/vfb/sv/rcd/rc/fk/sk` prefixes and a Wolfsburg rule. Production has neither, so **this script was never applied**. | Skipped in replay. **Product note:** the VfL/Wolfsburg claim-matching fix is not live; claims for such clubs may still fail to auto-match. |
| F10 | Schema diff | index `matches_tournament_stage_round_fixture_date_idx` exists in replay but not production | `sql/2026-07-05_fixture_dates.sql` adds column `fixture_date` and this index. Production has the column but not the index, and no migration drops it. Either only the column statement was run, or the index was dropped by hand. | Replay uses a copy without the index. |
| — | Schema diff | `is_admin()` body hash differed | Whitespace only: production's body has the stair-step indentation typical of SQL-editor pasting, and the hash compares single-spaced text. | Baseline uses production's text verbatim. Not a real difference. |
| F11 | Full replay from schema-only baseline | `20260901152015_seed_top100_clubs_1`: null `game_world_id` | The seed migrations look up the `top-100` game world, which `v2-1-multi-tournament-foundation.sql` inserted as reference data. A schema-only dump drops those rows. | Baseline carries the reference rows that the foundational scripts themselves insert: 2 game worlds, 2 competition types, 1 format, 10 round templates, 17 fixture templates, 6 qualification rules. These are not production data. |
| F12 | **Supabase Preview** (first real run), `20260928091521_improve_manager_claim_matching_current_directory` | `function similarity(text, text) does not exist` | `pg_trgm` was created by `20260718_manager_claim_suggestions.sql` in the `extensions` schema. The schema-only dump of `public` silently omitted it. The local replay missed this because its platform scaffold pre-installed `pg_trgm` — a scaffold error, since Supabase does not provide it by default. | Baseline restates `create extension if not exists pg_trgm with schema extensions`. The scaffold no longer pre-installs it, so the local replay now exercises the baseline's own extension creation. |
| F13 | **Supabase Preview** schema fingerprint vs production (Preview check itself was green) | 52 grant differences: functions and tables created *after* the baseline (voting, manager auth hand-off, match evidence, knockout helpers, organisers) had narrower privileges | New Supabase databases ship tighter default privileges for `postgres` in `public`: new tables give API roles only `DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN`, and new functions are executable only by `postgres`. Production predates this and grants `anon`, `authenticated` and `service_role` everything by default; later migrations rely on that implicitly. The local scaffold copied production's defaults, so it could not see this. | Baseline ends by restating production's `pg_default_acl` (`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public ...`). The scaffold now uses the new restrictive defaults; a negative test without the fix shows 52 differences, so the local replay catches this class of problem. **Product note:** production's broad defaults mean every new table relies entirely on RLS. Adopting the tighter defaults is worth a separate, deliberate change. |

## Product notes (outside this repair's scope)

- **F4:** `get_public_youth_winners()` was meant to be retired on 18 July but is still live in production.
- **F9:** the 18 July "Fix VfL club matching" change (`canonical_manager_claim_club`) never reached production, so claims for VfL/VfB/SV/Wolfsburg-style club names may still fail to auto-match.
- **F7:** migrations should not carry one-off production data repairs with hard-coded ids; use the SQL editor and record the action.

## Local environment notes (not SQL findings)

- PostgreSQL 17.10 locally; production runs 17.6.
- Supabase's own schemas (auth, storage, vault), roles and default grants are stubbed by `tools/migration-replay/platform-scaffold.sql`; Preview provides the real ones.
- `pg_net` is not in stock PostgreSQL, so a stub extension (`tools/migration-replay/pg_net-stub/`) provides `net.http_post`.
- The scaffold mirrors a new Supabase database's restrictive default privileges (F13), not production's.
- The replay runs as a superuser; Supabase runs migrations as the non-superuser `postgres` role. **A green local replay is necessary evidence, not proof: the Supabase Preview check is the real test.**
- No roles dump was taken or committed.

## Production steps — only after Supabase Preview is green on the repair PR

Both new versions already exist in production in substance, so they must be **recorded, never executed**:

```
supabase migration repair --status applied 20260808000000
supabase migration repair --status applied 20260824171250
```

Run these immediately before merging. Production then lists 132 applied versions matching the 132 files, and the GitHub integration has nothing new to run. Merging first would make the integration try to execute the baseline against production, which would fail on its first `CREATE TABLE`.
