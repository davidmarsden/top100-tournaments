#!/usr/bin/env bash
set -euo pipefail

PINNED_RSS_CHAT_COMMIT="0a77f7b0cdb6d61291248ded69daa6b78f10860a"
TOP100_REPO="https://raw.githubusercontent.com/davidmarsden/top100-tournaments"
TOP100_REF="${TOP100_CHAT_REF:-main}"
RSS_DIR="/opt/top100-rsschat"
GATEWAY_DIR="/opt/top100-chat"
CADDY_FILE="/etc/caddy/Caddyfile"
ENV_FILE="/etc/top100-chat.env"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root (sudo)." >&2
  exit 1
fi

if [[ -z "${TOP100_CHAT_SSO_SECRET:-}" || "${#TOP100_CHAT_SSO_SECRET}" -lt 32 ]]; then
  echo "TOP100_CHAT_SSO_SECRET must be supplied and be at least 32 characters." >&2
  exit 1
fi

for command in git curl node npm systemctl caddy rsync; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "Required command not found: ${command}" >&2
    exit 1
  }
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

echo "Installing Top 100 Chat beside the existing Commons Chat instance."
echo "Commons Chat is left untouched (HTTP 1420 / WebSocket 1462)."
echo "Top 100 Chat will use HTTP 1430 / WebSocket 1463 / auth gateway 1470."

install -d -m 0755 "${RSS_DIR}" "${GATEWAY_DIR}"

echo "Fetching pinned rss.chat ${PINNED_RSS_CHAT_COMMIT}..."
git clone --quiet https://github.com/scripting/rss.chat.git "${tmpdir}/rss.chat"
git -C "${tmpdir}/rss.chat" checkout --quiet "${PINNED_RSS_CHAT_COMMIT}"

# Preserve the private instance database and runtime prefs across redeploys.
rsync -a --delete \
  --exclude data/ \
  --exclude config.json \
  --exclude prefs.json \
  "${tmpdir}/rss.chat/server/code/" "${RSS_DIR}/"

fetch_top100_file () {
  local path="$1"
  local dest="$2"
  curl -fsSL "${TOP100_REPO}/${TOP100_REF}/${path}" -o "${dest}"
}

echo "Fetching Top 100 privacy gateway and reproducible rss.chat overlay..."
fetch_top100_file "ops/top100-chat/gateway.mjs" "${tmpdir}/gateway.mjs"
fetch_top100_file "ops/top100-chat/shell.html" "${tmpdir}/shell.html"
fetch_top100_file "ops/top100-chat/apply-overlay.mjs" "${tmpdir}/apply-overlay.mjs"
fetch_top100_file "ops/top100-chat/verify-overlay.mjs" "${tmpdir}/verify-overlay.mjs"
fetch_top100_file "ops/top100-chat/top100-chat-gateway.service" "${tmpdir}/top100-chat-gateway.service"
fetch_top100_file "ops/top100-chat/top100-rsschat.service" "${tmpdir}/top100-rsschat.service"
fetch_top100_file "ops/top100-chat/ensure-native-deps.sh" "${tmpdir}/ensure-native-deps.sh"
fetch_top100_file "ops/top100-chat/smoke-test.sh" "${tmpdir}/smoke-test.sh"
fetch_top100_file "ops/top100-chat/Caddyfile.example" "${tmpdir}/top100-chat.caddy"

node "${tmpdir}/apply-overlay.mjs" "${RSS_DIR}/rssnetwork.js"
node "${tmpdir}/verify-overlay.mjs" "${RSS_DIR}/rssnetwork.js"

# Older installs may leave this directory owned by www-data. Harden the
# destination before installing any executable into it so the running gateway
# cannot replace a root-owned helper between install and execution.
chown root:root "${GATEWAY_DIR}"
chmod 0755 "${GATEWAY_DIR}"

# Only after all root-executed deployment helpers have run do we replace the
# live gateway files. This avoids ever executing service-writable code as root
# during upgrades from older installations.
install -o root -g root -m 0644 "${tmpdir}/gateway.mjs" "${GATEWAY_DIR}/gateway.mjs"
install -o root -g root -m 0644 "${tmpdir}/shell.html" "${GATEWAY_DIR}/shell.html"
install -o root -g root -m 0644 "${tmpdir}/apply-overlay.mjs" "${GATEWAY_DIR}/apply-overlay.mjs"
install -o root -g root -m 0644 "${tmpdir}/verify-overlay.mjs" "${GATEWAY_DIR}/verify-overlay.mjs"
install -o root -g root -m 0755 "${tmpdir}/ensure-native-deps.sh" "${GATEWAY_DIR}/ensure-native-deps.sh"
install -o root -g root -m 0755 "${tmpdir}/smoke-test.sh" "${GATEWAY_DIR}/smoke-test.sh"

cat > "${RSS_DIR}/config.json" <<'JSON'
{
  "note": "Private Top 100 Chat. Separate from Ealing Civic Commons Chat.",
  "productName": "top100Chat",
  "productNameForDisplay": "Top 100 Chat",
  "urlServerHomePageSource": "http://127.0.0.1:1470/client-home",
  "myDomain": "chat.smtop100.blog",
  "urlServerForClient": "https://chat.smtop100.blog/",
  "urlServerForEmail": "https://chat.smtop100.blog/",
  "port": 1430,
  "flWebsocketEnabled": true,
  "websocketPort": 1463,
  "flSecureWebsocket": true,
  "urlWebsocketServerForClient": "wss://chat.smtop100.blog/",
  "prefsPath": "prefs.json",
  "dataPath": "data/",
  "flFeedsInDatabase": true,
  "flRssCloudEnabled": false,
  "flWebsubEnabled": false,
  "database": {
    "flUseSqlite": true
  }
}
JSON

install -d -m 0750 "${RSS_DIR}/data"
chown -R www-data:www-data "${RSS_DIR}"

echo "Installing rss.chat dependencies..."
(
  cd "${RSS_DIR}"
  npm install --omit=dev --no-audit --no-fund
)
chown -R www-data:www-data "${RSS_DIR}"

# better-sqlite3 is a native addon. Verify it against the currently installed
# Node ABI now, and let the same helper protect future service restarts after
# unattended Node upgrades.
"${GATEWAY_DIR}/ensure-native-deps.sh"

umask 077
cat > "${ENV_FILE}" <<EOF
TOP100_CHAT_SSO_SECRET=${TOP100_CHAT_SSO_SECRET}
TOP100_CHAT_GATEWAY_HOST=127.0.0.1
TOP100_CHAT_GATEWAY_PORT=1470
TOP100_CHAT_RSS_PORT=1430
TOP100_CHAT_SESSION_SECONDS=43200
EOF
chmod 0600 "${ENV_FILE}"
chown root:root "${ENV_FILE}"

install -m 0644 "${tmpdir}/top100-rsschat.service" /etc/systemd/system/top100-rsschat.service
install -m 0644 "${tmpdir}/top100-chat-gateway.service" /etc/systemd/system/top100-chat-gateway.service

systemctl daemon-reload
systemctl enable top100-rsschat.service
systemctl enable top100-chat-gateway.service
systemctl restart top100-chat-gateway.service
systemctl restart top100-rsschat.service

wait_for_http_status () {
  local name="$1"
  local url="$2"
  local expected_status="$3"
  local attempts="${4:-20}"
  local delay="${5:-1}"
  local attempt status

  for ((attempt=1; attempt<=attempts; attempt++)); do
    status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "${url}" 2>/dev/null || true)"
    if [[ "${status}" == "${expected_status}" ]]; then
      echo "${name} is ready (${status})."
      return 0
    fi
    if ! systemctl --quiet is-active top100-rsschat.service || ! systemctl --quiet is-active top100-chat-gateway.service; then
      echo "A Top 100 Chat service stopped while waiting for readiness." >&2
      systemctl status top100-rsschat.service top100-chat-gateway.service --no-pager -l >&2 || true
      return 1
    fi
    sleep "${delay}"
  done

  echo "${name} did not return expected HTTP ${expected_status} after ${attempts} attempts (last status: ${status:-none})." >&2
  return 1
}

systemctl --quiet is-active top100-rsschat.service
systemctl --quiet is-active top100-chat-gateway.service
wait_for_http_status "Top 100 auth gateway" "http://127.0.0.1:1470/login" "200"
wait_for_http_status "Top 100 rss.chat HTTP" "http://127.0.0.1:1430/" "404"

if ! ss -lnt | grep -Eq '127\.0\.0\.1:1430|0\.0\.0\.0:1430|\[::\]:1430'; then
  echo "Top 100 rss.chat HTTP port 1430 is not listening." >&2
  exit 1
fi
if ! ss -lnt | grep -Eq '127\.0\.0\.1:1470|0\.0\.0\.0:1470|\[::\]:1470'; then
  echo "Top 100 auth gateway port 1470 is not listening." >&2
  exit 1
fi

websocket_ready=false
for attempt in {1..20}; do
  if ss -lnt | grep -Eq ':1463[[:space:]]'; then
    websocket_ready=true
    break
  fi
  if ! systemctl --quiet is-active top100-rsschat.service; then
    break
  fi
  sleep 1
done
if [[ "${websocket_ready}" != "true" ]]; then
  echo "Top 100 rss.chat WebSocket port 1463 did not become ready." >&2
  systemctl status top100-rsschat.service --no-pager -l >&2 || true
  exit 1
fi

if [[ ! -f "${CADDY_FILE}" ]]; then
  echo "Caddyfile not found at ${CADDY_FILE}." >&2
  exit 1
fi

backup="${CADDY_FILE}.pre-top100-chat-${timestamp}"
cp -a "${CADDY_FILE}" "${backup}"

# Replace the actual chat.smtop100.blog site block on every deployment rather
# than assuming any mention of the hostname means the current block is right.
# This upgrades older installs and ignores comments containing the hostname.
awk '
  BEGIN { skipping=0; depth=0 }
  {
    if (!skipping && $0 ~ /^[[:space:]]*chat\.smtop100\.blog[[:space:]]*\{[[:space:]]*$/) {
      skipping=1
      line=$0
      opens=gsub(/\{/, "{", line)
      closes=gsub(/\}/, "}", line)
      depth=opens-closes
      next
    }
    if (skipping) {
      line=$0
      opens=gsub(/\{/, "{", line)
      closes=gsub(/\}/, "}", line)
      depth += opens-closes
      if (depth <= 0) {
        skipping=0
        depth=0
      }
      next
    }
    print
  }
  END {
    if (skipping) exit 42
  }
' "${CADDY_FILE}" > "${tmpdir}/Caddyfile.without-top100" || {
  status=$?
  cp -a "${backup}" "${CADDY_FILE}"
  if [[ "${status}" -eq 42 ]]; then
    echo "Existing chat.smtop100.blog Caddy block is unbalanced; left Caddy unchanged." >&2
  else
    echo "Could not rewrite the Caddyfile; left Caddy unchanged." >&2
  fi
  exit 1
}

cat "${tmpdir}/Caddyfile.without-top100" > "${CADDY_FILE}"
printf '\n# Top 100 private chat — managed by install-on-droplet.sh (%s)\n' "${timestamp}" >> "${CADDY_FILE}"
cat "${tmpdir}/top100-chat.caddy" >> "${CADDY_FILE}"
caddy fmt --overwrite "${CADDY_FILE}"

if ! caddy validate --config "${CADDY_FILE}"; then
  cp -a "${backup}" "${CADDY_FILE}"
  echo "Caddy validation failed. Restored the previous Caddyfile." >&2
  exit 1
fi

systemctl reload caddy

# Verify the public Caddy routes against loopback so stale resolver state on
# the Droplet cannot turn a healthy deployment into a false failure.
TOP100_CHAT_RESOLVE_IP=127.0.0.1 "${GATEWAY_DIR}/smoke-test.sh" "https://chat.smtop100.blog"

echo
echo "Top 100 Chat services are installed."
echo "  rss.chat HTTP:     127.0.0.1:1430"
echo "  rss.chat WebSocket:1463"
echo "  auth gateway:      127.0.0.1:1470"
echo
echo "Next, verify DNS for chat.smtop100.blog points to this Droplet and run:"
echo "  curl -I https://chat.smtop100.blog/login"
echo "  curl -I https://chat.smtop100.blog/getrecentitems"
echo "  curl -I https://chat.smtop100.blog/data/subs.opml"
echo
echo "The login shell should be 200. Logged-out content routes must redirect to /login and disclose no chat content."
