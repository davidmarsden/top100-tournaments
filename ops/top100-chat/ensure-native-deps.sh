#!/usr/bin/env bash
set -euo pipefail

RSS_DIR="${TOP100_CHAT_RSS_DIR:-/opt/top100-rsschat}"
NODE_BIN="${TOP100_CHAT_NODE_BIN:-/usr/bin/node}"
NPM_BIN="${TOP100_CHAT_NPM_BIN:-/usr/bin/npm}"

cd "${RSS_DIR}"

probe_sqlite() {
  "${NODE_BIN}" -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.prepare('select 1').get(); db.close();"
}

if probe_sqlite >/dev/null 2>&1; then
  echo "better-sqlite3 is compatible with $("${NODE_BIN}" --version)."
  exit 0
fi

echo "better-sqlite3 is not compatible with $("${NODE_BIN}" --version); rebuilding the native addon..." >&2

# npm rebuild will use a compatible prebuilt binary when available and compile
# locally otherwise. Do not use npm's deprecated --build-from-source CLI flag.
"${NPM_BIN}" rebuild better-sqlite3 --no-audit --no-fund

if ! probe_sqlite >/dev/null 2>&1; then
  echo "better-sqlite3 still cannot be loaded after rebuild." >&2
  exit 1
fi

echo "better-sqlite3 rebuild succeeded."
