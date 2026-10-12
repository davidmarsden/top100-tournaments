#!/usr/bin/env bash
# Self-test for the migration permissions gate: each file in permission-tests/ is applied as the only
# "new" migration on top of all current migrations, and must pass or fail as its name says.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
here=tools/migration-replay
mapfile -t base < <(ls supabase/migrations/*.sql | sort)
psql -X -q -d postgres -c "drop database if exists perm_template with (force)" -c "create database perm_template" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d perm_template -f "$here/platform-scaffold.sql" >/dev/null
for f in "${base[@]}"; do psql -X -q -v ON_ERROR_STOP=1 -d perm_template --single-transaction -f "$f" >/dev/null 2>&1 || { echo "base replay failed at $f"; exit 1; }; done
bad=0
for t in "$here"/permission-tests/*.sql; do
  want=$(basename "$t" | sed -E 's/.*\.(pass|fail)\.sql$/\1/')
  psql -X -q -d postgres -c "drop database if exists perm_case with (force)" -c "create database perm_case template perm_template" >/dev/null
  if out=$(PGDATABASE=perm_case python3 "$here/check_permissions.py" --new "$t" 2>&1); then got=pass; else got=fail; fi
  if [ "$got" = "$want" ]; then echo "ok    $(basename "$t")"; else bad=1; echo "WRONG $(basename "$t"): expected $want, got $got"; echo "$out" | sed 's/^/      /'; fi
done
psql -X -q -d postgres -c "drop database if exists perm_case with (force)" -c "drop database if exists perm_template with (force)" >/dev/null
exit $bad
