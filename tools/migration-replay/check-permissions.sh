#!/usr/bin/env bash
# Migration permissions gate (see docs/migration-permissions.md).
#   tools/migration-replay/check-permissions.sh [base-ref]      default base-ref: origin/main
# Builds a throwaway database "replay" from the base ref's migrations, then applies only the
# migrations this branch adds and checks the grants on every object they create.
# Needs psql on PATH and a disposable PostgreSQL 17 server (PGHOST/PGPORT/PGUSER), with the pg_net
# stub from tools/migration-replay/pg_net-stub/ installed. Never point it at a hosted project.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
base_ref=${1:-origin/main}
here=tools/migration-replay
merge_base=$(git merge-base "$base_ref" HEAD)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Base migrations exactly as they are on the base branch.
base=()
while IFS= read -r f; do
  out="$tmp/base/$(basename "$f")"; mkdir -p "$tmp/base"
  git show "$merge_base:$f" > "$out"; base+=("$out")
done < <(git ls-tree --name-only "$merge_base" supabase/migrations/ | grep '\.sql$' | sort)

mapfile -t new < <(git diff --name-only --diff-filter=A "$merge_base" HEAD -- 'supabase/migrations/*.sql' | sort)
mapfile -t modified < <(git diff --name-only --diff-filter=M "$merge_base" HEAD -- 'supabase/migrations/*.sql' | sort)

if [ ${#new[@]} -eq 0 ] && [ ${#modified[@]} -eq 0 ]; then
  echo "No new or modified migrations; nothing to check."; exit 0
fi

psql -X -q -d postgres -c "drop database if exists replay with (force)" -c "create database replay" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d replay -f "$here/platform-scaffold.sql" >/dev/null
PGDATABASE=replay python3 "$here/check_permissions.py" --base "${base[@]}" --new "${new[@]}" --modified "${modified[@]}"
