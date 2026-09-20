#!/usr/bin/env bash
set -euo pipefail

base="${1:-https://chat.smtop100.blog}"

check_public () {
  local url="$1"
  local code
  code="$(curl -sS -o /tmp/top100-chat-smoke-body -w '%{http_code}' --max-time 10 "${url}")"
  if [[ "${code}" != "200" ]]; then
    echo "FAIL public shell: ${url} returned ${code}" >&2
    exit 1
  fi
  echo "PASS public shell: ${url} -> 200"
}

check_private () {
  local path="$1"
  local headers
  headers="$(mktemp)"
  trap 'rm -f "${headers}"' RETURN
  curl -sS -D "${headers}" -o /tmp/top100-chat-smoke-body --max-time 10 "${base}${path}" || true
  local status location
  status="$(awk 'NR==1 {print $2}' "${headers}")"
  location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {gsub("\r",""); print $2}' "${headers}" | tail -1)"
  if [[ "${status}" != "302" || "${location}" != "/login" ]]; then
    echo "FAIL private route: ${path} returned ${status:-no-status}, location=${location:-none}" >&2
    exit 1
  fi
  echo "PASS private route: ${path} -> 302 /login"
}

check_public "${base}/login"
check_private "/"
check_private "/getrecentitems"
check_private "/getthread?id=1"
check_private "/data/subs.opml"
check_private "/users/manager1/rss.xml"
check_private "/feed?screenname=manager1"

echo "Logged-out privacy smoke tests passed."
