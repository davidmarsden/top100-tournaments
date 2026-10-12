# Migration permissions guide

Every migration that creates a table, view or function must say who can use it. A CI check, **Migration permissions**, enforces this on every pull request that touches `supabase/migrations/`.

## Why this exists

Until October 2026, every new object in `public` was automatically granted in full to the API roles: `anon` (signed-out visitors), `authenticated` (signed-in managers and admins) and `service_role` (server code and edge functions). Row level security (RLS) was the only barrier.

Migration `20261011231200_tighten_default_privileges` changed that for **new** objects only:

| New object | API roles get by default |
|---|---|
| Table or view | Nothing useful: no `SELECT`, `INSERT`, `UPDATE` or `DELETE` |
| Sequence | Nothing (owner only) |
| Function | Nothing: not even `PUBLIC` can execute it |

Existing objects kept their grants. So a new table or RPC that the app needs **will not work until the migration grants it**. The usual symptom is `permission denied for table …` or `permission denied for function …` in the browser console.

## The rule

In the same migration that creates an object, do one of two things:

1. **Grant** exactly what each API role needs, or
2. **Declare it private**, with a reason, when no API role should ever touch it directly.

Grants and RLS do different jobs. A grant decides whether a role may touch the object at all; RLS policies then decide which rows it sees. A public table needs both.

## Patterns

### Public read-only table (fixtures, results, directories)
```sql
create table public.example_results (...);
alter table public.example_results enable row level security;
create policy "Anyone reads results" on public.example_results
  for select to anon, authenticated using (true);
grant select on public.example_results to anon, authenticated;
```

### Table managers read and write their own rows
```sql
alter table public.example_prefs enable row level security;
create policy "Managers manage own prefs" on public.example_prefs
  for all to authenticated
  using (account_id in (select id from public.manager_portal_accounts where auth_user_id = auth.uid()))
  with check (account_id in (select id from public.manager_portal_accounts where auth_user_id = auth.uid()));
grant select, insert, update, delete on public.example_prefs to authenticated;
```
If the table has an identity or serial column that clients insert into, they also need the sequence: `grant usage on sequence public.example_prefs_id_seq to authenticated;`.

### Admin-only table written through RPCs
```sql
alter table public.example_audit enable row level security;
create policy "Admins read audit" on public.example_audit for select to authenticated using (public.is_admin());
grant select on public.example_audit to authenticated;   -- reads; writes go through security definer RPCs
```

### RPC called from the app
```sql
create function public.example_submit(target bigint) returns bigint
language plpgsql security definer set search_path to 'public' as $$ ... $$;
revoke all on function public.example_submit(bigint) from public;
grant execute on function public.example_submit(bigint) to authenticated;
```
Grant `anon` only for genuinely public endpoints. A `security definer` function runs with its owner's rights, so it must check permissions itself (for example `if not public.is_admin() then raise exception ...`).

### Helper function used inside an RLS policy — the easy one to miss
A policy runs as the **caller**, so every role that queries the table must be able to execute every function the policy calls:
```sql
create function public.example_can_view(target bigint) returns boolean
language sql stable security definer set search_path to 'public' as $$ ... $$;
grant execute on function public.example_can_view(bigint) to anon, authenticated;
```
Forget this and **all** queries on the table fail with "permission denied", not just the rows the policy hides.

### Trigger functions
Functions returning `trigger` need no grants; the check ignores them.

### Deliberately private objects
Some objects should never be reachable through the API: staging tables written only by `security definer` RPCs, or internal helpers called only from other functions. Declare them in the migration that creates them, with a reason:
```sql
-- @permissions private public.example_sync_staging: written only by stage_soccer_manager_sync()
-- @permissions private public.example_rank_internal(bigint): called only by other security definer functions
```
- One line per object. Use the full name, `public.name` for tables and `public.name(arg types)` for functions; a function name without arguments covers all its overloads.
- A reason after the colon is required.
- The declaration must name an object the PR actually creates. Typos fail the check.
- An object declared private must not be granted to any API role. If it later needs access, remove the declaration and add the grant.

## Pitfalls

- **`drop function` + `create function` resets grants.** The new function starts with none. Re-grant it, or use `create or replace` when the signature is unchanged, which keeps the grants. The check flags this explicitly.
- **Changing a function's arguments creates a new function.** The old signature's grants don't carry over.
- **Never edit a migration that has already been applied.** Production will not run it again. Write a new migration instead. The check warns when an existing migration file changes.
- **RLS must stay enabled** on every table in `public`. New tables get it automatically (the `ensure_rls` event trigger), and the check fails if a migration disables it.

## What the CI check does

`.github/workflows/migration-permissions.yml` runs `tools/migration-replay/check-permissions.sh`:

1. It builds an empty PostgreSQL 17 database from the base branch's migrations, with Supabase's roles and default privileges stubbed in.
2. It records every table, view and function in `public`, then applies only the migrations this PR adds.
3. It inspects every object those migrations **created**. A dropped-and-recreated object counts as created, because it has a new identity.

| Result | When |
|---|---|
| **Fail** | A new table or view that `anon`, `authenticated` and `service_role` can neither read nor write, unless declared private |
| **Fail** | A new non-trigger function that none of them can execute, unless declared private |
| **Fail** | A new table with RLS disabled |
| **Fail** | A private object that is granted anyway, a declaration without a reason, or a declaration naming nothing the PR creates |
| **Fail** | A new migration that does not apply cleanly on top of the base branch |
| **Warn** | A new `security definer` function executable by `anon` |
| **Warn** | An existing migration file was modified |

The check proves that *some* grant decision was made. It can't judge whether the grant is right; that's still for review, and the Supabase Preview check proves the migrations apply on real Supabase.

## Running it locally

With a disposable local PostgreSQL 17 server, and the `pg_net` stub from `tools/migration-replay/pg_net-stub/` copied into its `share/extension` directory:

```sh
export PGHOST=localhost PGPORT=5432 PGUSER=postgres
tools/migration-replay/check-permissions.sh origin/main      # check your branch
tools/migration-replay/test-permissions-check.sh             # self-test the checker
```

Never point these scripts at a hosted Supabase project; they drop and recreate their working databases.

Examples of passing and failing migrations are in `tools/migration-replay/permission-tests/`.
