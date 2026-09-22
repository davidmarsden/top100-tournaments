# Top 100 Chat

Top 100 Chat is a **private** rss.chat deployment for approved managers in the Top 100 Soccer Manager World.

It deliberately reuses the existing Top 100 Manager Portal identity instead of maintaining a second membership list.

## Security model

There are three separate layers:

1. **Top 100 identity** — Supabase Auth identifies the user. The Netlify ticket issuer then requires an active `manager_portal_accounts` record in the `top-100` game world.
2. **Short-lived SSO handoff** — `netlify/functions/chat-ticket.js` creates a signed ticket valid for 90 seconds. It contains no rss.chat credential. The gateway rejects expired/replayed tickets.
3. **Private reverse-proxy boundary** — Caddy runs `forward_auth` before **every** rss.chat route. The UI, read APIs, user feeds, comments feeds, OPML, media and WebSocket endpoint are therefore inaccessible without the HttpOnly Top 100 Chat session cookie.

The rss.chat patch does **not** implement the privacy wall. It only provides a localhost-only SSO helper so that an approved Top 100 manager gets a stable rss.chat posting identity without signing in twice.

## Public shell

`https://chat.smtop100.blog/login` is intentionally public. It explains that the community is private and links to:

`https://manager.smtop100.blog/chat`

That page uses the existing Supabase magic-link login. Once signed in, the Netlify function verifies the user's active Top 100 manager account and returns the one-use SSO ticket.

## rss.chat identity

The rss.chat account name is stable and non-user-controlled:

`manager<manager_id>`

The visible feed/author title is the approved Top 100 manager display name from the manager directory.

This avoids collisions and prevents a user choosing another manager's identity.

## Production layout

The existing Commons Chat Droplet can host this as a second, isolated instance if capacity is acceptable:

- Commons rss.chat HTTP: `127.0.0.1:1420`
- Commons Chat WebSocket: `1462`
- Top 100 rss.chat HTTP: `127.0.0.1:1430`
- Top 100 Chat WebSocket: `1463`
- Top 100 auth gateway: `127.0.0.1:1470`
- Top 100 database: a separate SQLite database under `/opt/top100-rsschat/data/`
- Public hostname: `chat.smtop100.blog`

Do not point Top 100 at the Commons Chat database.

Port `2587` is unrelated to web traffic: it is the Resend STARTTLS SMTP port used because DigitalOcean blocks the usual outbound SMTP ports. Caddy continues to terminate public HTTPS on port 443 for both chat hostnames.

Before enabling the second Node instance on the 1 GB Droplet, check current memory/swap pressure. If it is tight, resize the existing Droplet rather than silently risking both communities.

## Critical private-feed configuration

Top 100 feeds must remain behind Caddy.

Use rss.chat with database-hosted feeds:

```json
{
  "productName": "top100Chat",
  "productNameForDisplay": "Top 100 Chat",
  "myDomain": "chat.smtop100.blog",
  "urlServerForClient": "https://chat.smtop100.blog/",
  "flFeedsInDatabase": true,
  "flRssCloudEnabled": false,
  "flWebsubEnabled": false
}
```

Do **not** configure `rssS3Path`, `opmlS3Path` or another publicly readable feed store.

Do **not** enable rssCloud or WebSub for this private instance: advertising private feed URLs to public hubs defeats the privacy model.

## Required secrets

The same strong random value must be configured in both places as `TOP100_CHAT_SSO_SECRET`:

- the Netlify site running `top100-tournaments`;
- `/etc/top100-chat.env` on the chat server.

Use at least 32 random bytes. Never commit it.

The gateway derives a separate cookie-signing key from this secret using HMAC-SHA256.

## One-command Droplet install

After the matching `TOP100_CHAT_SSO_SECRET` has been set in Netlify, run the version-controlled installer as root on the existing Commons Chat Droplet:

```bash
TOP100_CHAT_SSO_SECRET='<same secret as Netlify>' \
  bash /path/to/top100-tournaments/ops/top100-chat/install-on-droplet.sh
```

The installer deliberately leaves the Commons Chat service and its ports alone. It installs a second pinned rss.chat copy, a separate SQLite database, the Top 100 auth gateway, two systemd units, and appends a validated `chat.smtop100.blog` site block to Caddy. It backs up the Caddyfile before changing it and restores the backup if validation fails.

Deployment helpers are staged outside the live gateway directory and installed root-owned. The `www-data` services must not be able to replace scripts that are later executed as root.

The installer also verifies the native `better-sqlite3` binding against the currently installed Node runtime. It opens an in-memory SQLite database and runs a query; if that probe fails, the helper rebuilds `better-sqlite3` and verifies it again before rss.chat is allowed to start. This protects the service from a Node ABI change leaving it in a restart loop. The SQLite data files themselves are not rebuilt or replaced.

## Applying the rss.chat overlay

The pinned upstream is:

- repository: `scripting/rss.chat`
- commit: `0a77f7b0cdb6d61291248ded69daa6b78f10860a`
- version: `0.6.14`

Apply, migrate the existing database if present, and verify:

```bash
node apply-overlay.mjs /opt/top100-rsschat/rssnetwork.js
node migrate-source-bindings.mjs /opt/top100-rsschat
node verify-overlay.mjs /opt/top100-rsschat/rssnetwork.js
```

The migration is safe on both upgrade and fresh-install paths: it backs up an existing SQLite database before adding missing source-binding columns, and is a no-op if the database does not exist yet. The patcher is fail-closed. If upstream moves an anchor, it stops instead of guessing.

## Caddy

Merge `Caddyfile.example` into the server Caddyfile. Only `/login` and `/auth/*` bypass the privacy check.

A request without a valid clubhouse cookie is redirected to the public login shell before rss.chat sees it.

The rss.chat homepage source must remain:

```json
"urlServerHomePageSource": "http://127.0.0.1:1470/client-home"
```

The gateway proxies the upstream rss.chat client through `/client-home` and injects the Top 100 logout hook. The stock rss.chat sign-out only clears its browser state; it does not clear the HttpOnly Top 100 clubhouse cookie. Reverting the homepage source directly to the upstream client therefore breaks proper logout.

## Progressive Web App

Top 100 Chat is installable as a standalone PWA from `chat.smtop100.blog`.

The gateway serves:

- `/manifest.webmanifest`
- `/top100-chat-icon.svg`
- `/pwa-sw.js`

These control files are intentionally public because they contain no private chat data. The service worker is deliberately network-only: it does **not** cache chat pages, timelines, threads, feeds, APIs or other private content. If the clubhouse session has expired, launching the installed app follows the normal Caddy redirect to `/login`.

On Android/Chrome or Brave, use the browser's **Install app** / **Add to Home screen** command once the manifest has loaded.

## Reply notifications

Installed Top 100 Chat PWAs can opt in to Web Push notifications for **replies to their own posts**.

The first version is intentionally restrained:

- notifications are opt-in per device from the Top 100 menu;
- only direct replies to a manager's post trigger a push;
- self-replies do not trigger a push;
- there is no "every new post" notification mode;
- expired browser push subscriptions are removed automatically.

The browser subscription is stored by the auth gateway under `/var/lib/top100-chat/push-subscriptions.json` and is keyed to the authenticated Top 100 manager id. It does not contain chat history.

The VAPID keypair is generated automatically on the first deployment and stored in `/etc/top100-chat.env`. Later installer runs preserve the existing keypair. Do not rotate those keys casually: replacing them invalidates existing device subscriptions.

rss.chat itself does not send Web Push. The overlay emits a localhost-only reply event to the gateway after a reply has been successfully written. The gateway then sends Web Push only to subscriptions belonging to the parent post's manager.

The PWA service worker still has no fetch handler and does not cache private chat content. Its additional responsibilities are limited to receiving a push, displaying the notification and opening the relevant chat post when the notification is tapped.

## Smoke tests

Logged out:

```bash
bash ops/top100-chat/smoke-test.sh
```

The smoke test covers the root, recent-items API, thread API, OPML, user RSS and feed endpoint.

All content-bearing requests must redirect to `/login` (or otherwise return no chat data).

The public shell must remain reachable:

```bash
curl -fsS https://chat.smtop100.blog/login
```

On the Droplet, the installer deliberately runs the public smoke test through Caddy on loopback using `curl --resolve`. This prevents stale local DNS from making a healthy deployment appear broken.

Useful direct checks are:

```bash
curl -I http://127.0.0.1:1470/login
curl -I http://127.0.0.1:1430/
```

The expected healthy responses are **200** from the gateway login shell and **200** from the rss.chat root. The root now serves the branded client through the gateway's `/client-home` source, so a 200 confirms that the injected client can be loaded.

On the server itself, the provisioning route must work only over loopback. An external call to `/localtop100sso` must never reach rss.chat because Caddy protects it; the rss.chat route also independently rejects non-loopback requests.

## Runtime recovery

If the public site returns **502**, first determine which local layer is down instead of changing Caddy immediately:

```bash
systemctl status top100-chat-gateway.service --no-pager -l
systemctl status top100-rsschat.service --no-pager -l
curl -I http://127.0.0.1:1470/login
curl -I http://127.0.0.1:1430/
journalctl -u top100-rsschat.service -n 80 --no-pager
```

If port 1430 is not listening and the journal mentions a missing `better_sqlite3.node` binding or an ABI mismatch, run the version-controlled native dependency helper:

```bash
sudo /opt/top100-chat/ensure-native-deps.sh
sudo systemctl restart top100-rsschat.service
```

The systemd unit also runs this probe automatically before rss.chat starts, so a future Node runtime change should repair the binding before the application launches.

If local services are healthy but `curl https://chat.smtop100.blog/...` from the Droplet fails while external clients work, compare local and authoritative DNS:

```bash
getent ahosts chat.smtop100.blog
dig +short chat.smtop100.blog @1.1.1.1
```

To bypass the local resolver and test the Caddy/TLS endpoint returned by authoritative DNS, query one of the zone's authoritative nameservers directly:

```bash
AUTH_NS="$(dig +short NS smtop100.blog | head -1)"
CHAT_IP="$(dig +short chat.smtop100.blog @"${AUTH_NS}" | head -1)"
curl -v --resolve "chat.smtop100.blog:443:${CHAT_IP}" \
  https://chat.smtop100.blog/login
```

Check that both `AUTH_NS` and `CHAT_IP` are non-empty and that `CHAT_IP` is the expected current Droplet address before relying on the result.

If that succeeds while `getent` shows an old address, flush the local resolver cache rather than changing DNS or Caddy:

```bash
sudo resolvectl flush-caches
sudo systemctl restart systemd-resolved
```

Then confirm `getent ahosts chat.smtop100.blog` returns the current Droplet address.

Do not downgrade or replace the system-wide Node installation just to repair Top 100 Chat: Commons Chat shares the Droplet and may depend on the same runtime. Prefer the per-service native-module repair first.

## Logout and revocation

`/auth/logout` removes both the HttpOnly clubhouse cookie and rss.chat's local posting credential.

Removing/deactivating a manager account prevents issuance of any new SSO ticket. Existing clubhouse sessions currently last 12 hours by default; reduce `TOP100_CHAT_SESSION_SECONDS` if faster revocation is required.

A later hardening step can add server-side session revocation against the Top 100 database on every auth check if immediate revocation becomes necessary.
