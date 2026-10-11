# Supabase migration reconciliation — 11 October 2026

## Confirmed

The `Supabase Preview` check on `main` commit `cf6a9a6` fails with `Remote migration versions not found in local migrations directory.`

Read-only comparison against Supabase project `xxntutejknolhmbssqdf`:

| Inventory | Count |
| --- | ---: |
| Applied migrations in `supabase_migrations.schema_migrations` | 130 |
| Local `supabase/migrations/*.sql` files | 130 |
| Exact version-identifier matches | 2 |
| Remote versions without matching local prefix | 128 |
| Local files without matching remote version | 128 |

The remote migration table includes original SQL statements. For example, remote `20261004081416_sm_id_manager_identities` begins with the same SQL header as local `20261004083000_sm_id_manager_identities.sql`. This is a **candidate match**, not yet proof of byte-for-byte identity.

Other remote migrations have no obvious local counterpart, including `20261004213749_manager_lab_match_cards`, `20261004174457_global_soccer_manager_manager_identity`, and `20260930185516_manager_lab_tackling`. Several likely originate from the Manager Lab project.

## Reconciliation procedure (no writes until verified)

1. Export the full `version, name, statements` inventory from `supabase_migrations.schema_migrations` using read-only SQL. Do not include secrets in repository artifacts.
2. Inventory every `supabase/migrations/*.sql` in this repository and the relevant Manager Lab migration sources. Match by normalized name, then compare normalized SQL and inspect substantive differences.
3. Recover exact original files/identifiers from Git history and the source repository wherever possible. Treat a shared-name match as **unverified** until SQL has been compared.
4. Decide on a **single authoritative migration stream** for this Supabase project. Multiple repositories writing independent migration histories will keep breaking preview checks.
5. Only after identifying the true source and exact equivalences, prepare a separately reviewed PR to align filenames/content and prevent duplicate execution. Never use placeholder migrations, blindly rename files, or modify `supabase_migrations.schema_migrations` to conceal drift.
6. Validate with a fresh Supabase preview/check. Leave production history untouched until the validated plan is approved.

## Why no bulk rename in this PR?

Only two exact version IDs match, and some remote migrations do not exist locally. A bulk rename would create apparent equivalence without checking SQL and could cause future migration replay errors or unexpected schema changes.

Related: #318.
