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
fetch_top100_file "ops/top100-chat/gateway.mjs" "${GATEWAY_DIR}/gateway.mjs"
fetch_top100_file "ops/top100-chat/shell.html" "${GATEWAY_DIR}/shell.html"
fetch_top100_file "ops/top100-chat/apply-overlay.mjs" "${GATEWAY_DIR}/apply-overlay.mjs"
fetch_top100_file "ops/top100-chat/verify-overlay.mjs" "${GATEWAY_DIR}/verify-overlay.mjs"
fetch_top100_file "ops/top100-chat/top100-chat-gateway.service" "${tmpdir}/top100-chat-gateway.service"
fetch_top100_file "ops/top100-chat/top100-rsschat.service" "${tmpdir}/top100-rsschat.service"
fetch_top100_file "ops/top100-chat/Caddyfile.example" "${tmpdir}/top100-chat.caddy"

node "${GATEWAY_DIR}/apply-overlay.mjs" "${RSS_DIR}/rssnetwork.js"
node "${GATEWAY_DIR}/verify-overlay.mjs" "${RSS_DIR}/rssnetwork.js"

cat > "${RSS_DIR}/config.json" <<'JSON'
{
  "note": "Private Top 100 Chat. Separate from Ealing Civic Commons Chat.",
  "productName": "top100Chat",
  "productNameForDisplay": "Top 100 Chat",
  "urlServerHomePageSource": "https://code.scripting.com/rsschat/index.html",
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
chown -R www-data:www-data "${RSS_DIR}" "${GATEWAY_DIR}"

echo "Installing rss.chat dependencies..."
(
  cd "${RSS_DIR}"
  npm install --omit=dev --no-audit --no-fund
)
chown -R www-data:www-data "${RSS_DIR}"

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
systemctl restart top100-rsschat.service
systemctl restart top100-chat-gateway.service

sleep 2
systemctl --quiet is-active top100-rsschat.service
systemctl --quiet is-active top100-chat-gateway.service
curl -fsS --max-time 5 http://127.0.0.1:1470/login >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:1430/ >/dev/null

if ! ss -lnt | grep -Eq '127\.0\.0\.1:1430|0\.0\.0\.0:1430|\[::\]:1430'; then
  echo "Top 100 rss.chat HTTP port 1430 is not listening." >&2
  exit 1
fi
if ! ss -lnt | grep -Eq '127\.0\.0\.1:1470|0\.0\.0\.0:1470|\[::\]:1470'; then
  echo "Top 100 auth gateway port 1470 is not listening." >&2
  exit 1
fi
if ! ss -lnt | grep -Eq ':1463[[:space:]]'; then
  echo "Top 100 rss.chat WebSocket port 1463 is not listening." >&2
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
