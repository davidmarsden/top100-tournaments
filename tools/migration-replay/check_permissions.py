#!/usr/bin/env python3
"""Migration permissions gate.

Applies the base branch's migrations to an empty database, records every table, view and function
in `public`, applies only the PR's NEW migration files, and then inspects the resulting database:

  FAIL  a new table/view that anon, authenticated and service_role can neither read nor write
  FAIL  a new function that none of those roles can execute (trigger functions are exempt)
  FAIL  a new table without row level security
  FAIL  an object declared private that is nevertheless granted to an API role
  FAIL  a private declaration without a reason, or naming an object the PR did not create
  WARN  a new SECURITY DEFINER function executable by anon (deliberate? say so in review)
  WARN  an existing migration file was modified (it will never re-run in production)

"New" means a new catalog object (by OID), so a DROP + CREATE of an existing function or table,
which silently resets its grants, is checked too. CREATE OR REPLACE keeps the OID and its grants.

Deliberately private objects are declared in the migration that creates them:

  -- @permissions private public.sync_staging: written only by security definer RPCs
  -- @permissions private public.recalculate_ranks(bigint): internal, called by other functions

See docs/migration-permissions.md.
"""
import json
import os
import re
import subprocess
import sys

API_ROLES = ("anon", "authenticated", "service_role")
PSQL = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", os.environ.get("PGDATABASE", "replay")]

INVENTORY_SQL = r"""
select coalesce(json_agg(o), '[]'::json) from (
  select 'table' as kind, c.oid::bigint as oid, ('public.' || quote_ident(c.relname)) as name,
         c.relkind::text as relkind, c.relrowsecurity as rls,
         array(select r from unnest(array['anon','authenticated','service_role']) r
               where has_table_privilege(r, c.oid, 'SELECT') or has_table_privilege(r, c.oid, 'INSERT')
                  or has_table_privilege(r, c.oid, 'UPDATE') or has_table_privilege(r, c.oid, 'DELETE')) as roles,
         null::text as returns, false as secdef
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
  union all
  select 'function', p.oid::bigint, p.oid::regprocedure::text, null, null,
         array(select r from unnest(array['anon','authenticated','service_role']) r
               where has_function_privilege(r, p.oid, 'EXECUTE')),
         p.prorettype::regtype::text, p.prosecdef
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
) o
"""

ANNOTATION = re.compile(r"--\s*@permissions\s+private\s+(?P<target>[^:\n]+?)\s*(?::\s*(?P<reason>.*))?$", re.M)


def run_sql_file(path):
    res = subprocess.run(PSQL + ["--single-transaction", "-f", path], capture_output=True, text=True)
    if res.returncode != 0:
        print(f"::error file={path}::migration failed to apply on top of the base branch")
        print("\n".join(l for l in res.stderr.splitlines() if "ERROR" in l or "LINE" in l or "DETAIL" in l)[:2000])
        sys.exit(1)


def inventory():
    # Empty search_path makes regprocedure print schema-qualified names (public.fn(bigint)).
    out = subprocess.run(PSQL + ["-At", "-c", "set search_path to ''", "-c", INVENTORY_SQL],
                         capture_output=True, text=True, check=True)
    return {o["oid"]: o for o in json.loads(out.stdout)}


def norm(name):
    """Normalise 'public.foo(bigint, text)' / 'foo' / 'public."foo"' for comparison."""
    name = name.strip().replace('"', "").replace(" ", "")
    if "." not in name.split("(")[0]:
        name = "public." + name
    return name.lower()


def main():
    base_files, new_files, modified = [], [], []
    mode = None
    for arg in sys.argv[1:]:
        if arg in ("--base", "--new", "--modified"):
            mode = arg
            continue
        {"--base": base_files, "--new": new_files, "--modified": modified}[mode].append(arg)

    for f in base_files:
        run_sql_file(f)
    before = inventory()
    for f in new_files:
        run_sql_file(f)
    after = inventory()

    created = {oid: o for oid, o in after.items() if oid not in before}
    names_before = {norm(o["name"]) for o in before.values()}

    private = {}  # normalised target -> (file, reason)
    failures, warnings = [], []
    for f in new_files:
        text = open(f, encoding="utf-8").read()
        for m in ANNOTATION.finditer(text):
            target, reason = norm(m.group("target")), (m.group("reason") or "").strip()
            if not reason:
                failures.append((f, f"@permissions private {target} needs a reason after a colon"))
            private[target] = (f, reason)

    matched_private = set()
    for o in sorted(created.values(), key=lambda o: (o["kind"], o["name"])):
        name = norm(o["name"])
        bare = name.split("(")[0]
        decl = private.get(name) or private.get(bare)
        if decl:
            matched_private.add(name if name in private else bare)
        roles = o["roles"] or []
        recreated = name in names_before
        what = "was dropped and recreated, which resets its grants, and" if recreated else "is new and"

        if o["kind"] == "table":
            label = "view" if o["relkind"] in ("v", "m") else "table"
            if o["relkind"] in ("r", "p") and not o["rls"]:
                failures.append((o["name"], f"new {label} has row level security disabled"))
            if decl and roles:
                failures.append((o["name"], f"declared private but granted to {', '.join(roles)}"))
            elif not decl and not roles:
                failures.append((o["name"], f"{label} {what} is not readable or writable by anon, authenticated or "
                                 f"service_role. Add GRANTs, or declare it: -- @permissions private {o['name']}: <reason>"))
        else:
            if o["returns"] in ("trigger", "event_trigger"):
                continue  # invoked by the trigger mechanism, not by API roles
            if decl and roles:
                failures.append((o["name"], f"declared private but executable by {', '.join(roles)}"))
            elif not decl and not roles:
                failures.append((o["name"], f"function {what} is not executable by anon, authenticated or service_role. "
                                 "Add GRANT EXECUTE (remember RLS helper functions need it too), or declare it: "
                                 f"-- @permissions private {o['name']}: <reason>"))
            if o["secdef"] and "anon" in roles:
                warnings.append((o["name"], "SECURITY DEFINER function executable by anon; check this is deliberate"))

    for target, (f, _) in private.items():
        if target not in matched_private:
            failures.append((f, f"@permissions private {target} does not match any object this PR creates"))
    for f in modified:
        warnings.append((f, "existing migration modified: production will never re-run it; prefer a new migration"))

    print(f"Base migrations: {len(base_files)}, new migrations: {len(new_files)}, "
          f"new objects checked: {len(created)}, declared private: {len(matched_private)}")
    for where, msg in warnings:
        print(f"::warning title=Migration permissions::{where}: {msg}")
    for where, msg in failures:
        print(f"::error title=Migration permissions::{where}: {msg}")
    if failures:
        print(f"{len(failures)} permission problem(s). See docs/migration-permissions.md.")
        sys.exit(1)
    print("Migration permissions check passed.")


if __name__ == "__main__":
    main()
