#!/usr/bin/env bash
# Replay Supabase migrations into a throwaway local PostgreSQL 17 database and stop at the first failure.
# Read-only with respect to Supabase: it never connects to any hosted project.
#
#   tools/migration-replay/replay.sh migrations    # platform scaffold + every file in supabase/migrations
#   tools/migration-replay/replay.sh reconstruct   # platform scaffold + reconstruct-baseline.order (pre-9 Aug history)
#
# Needs: psql on PATH, a disposable PostgreSQL 17 server, and the pg_net stub in pg_net-stub/ copied into
# that server's share/extension directory. Connection via PGHOST/PGPORT/PGUSER (database "replay" is
# dropped and recreated each run).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
here=tools/migration-replay
mode=${1:-migrations}
psql_base=(psql -X -q -v ON_ERROR_STOP=1)

case "$mode" in
  migrations)  files=("$here/platform-scaffold.sql" supabase/migrations/*.sql) ;;
  reconstruct) mapfile -t rest < "$here/reconstruct-baseline.order"; files=("$here/platform-scaffold.sql" "${rest[@]}") ;;
  *) echo "usage: $0 migrations|reconstruct" >&2; exit 2 ;;
esac

"${psql_base[@]}" -d postgres -c "drop database if exists replay with (force)" -c "create database replay"
n=0
for f in "${files[@]}"; do
  n=$((n+1))
  if ! out=$("${psql_base[@]}" -d replay --single-transaction -f "$f" 2>&1); then
    echo "FAIL [$n] $f"; echo "$out" | grep -E 'ERROR|DETAIL|HINT|LINE' | head -8; exit 1
  fi
done
echo "ALL $n FILES APPLIED"
echo "Fingerprint (compare with the same query run read-only on production):"
"${psql_base[@]}" -d replay -At -f "$here/fingerprint-hash.sql" > /tmp/replay-fingerprint.txt
wc -l < /tmp/replay-fingerprint.txt
