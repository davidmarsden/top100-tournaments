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

- Commons rss.chat: existing service/ports
- Top 100 rss.chat HTTP: `127.0.0.1:1430`
- Top 100 auth gateway: `127.0.0.1:1470`
- Top 100 database: a separate SQLite database under `/opt/top100-rsschat/data/`
- Public hostname: `chat.smtop100.blog`

Do not point Top 100 at the Commons Chat database.

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

## Applying the rss.chat overlay

The pinned upstream is:

- repository: `scripting/rss.chat`
- commit: `0a77f7b0cdb6d61291248ded69daa6b78f10860a`
- version: `0.6.14`

Apply and verify:

```bash
node apply-overlay.mjs /opt/top100-rsschat/rssnetwork.js
node verify-overlay.mjs /opt/top100-rsschat/rssnetwork.js
```

The patcher is fail-closed. If upstream moves an anchor, it stops instead of guessing.

## Caddy

Merge `Caddyfile.example` into the server Caddyfile. Only `/login` and `/auth/*` bypass the privacy check.

A request without a valid clubhouse cookie is redirected to the public login shell before rss.chat sees it.

## Smoke tests

Logged out:

```bash
curl -I https://chat.smtop100.blog/
curl -I https://chat.smtop100.blog/getrecentitems
curl -I https://chat.smtop100.blog/data/subs.opml
curl -I https://chat.smtop100.blog/users/manager1/rss.xml
```

All content-bearing requests must redirect to `/login` (or otherwise return no chat data).

The public shell must remain reachable:

```bash
curl -fsS https://chat.smtop100.blog/login
```

On the server itself, the provisioning route must work only over loopback. An external call to `/localtop100sso` must never reach rss.chat because Caddy protects it; the rss.chat route also independently rejects non-loopback requests.

## Logout and revocation

`/auth/logout` removes both the HttpOnly clubhouse cookie and rss.chat's local posting credential.

Removing/deactivating a manager account prevents issuance of any new SSO ticket. Existing clubhouse sessions currently last 12 hours by default; reduce `TOP100_CHAT_SESSION_SECONDS` if faster revocation is required.

A later hardening step can add server-side session revocation against the Top 100 database on every auth check if immediate revocation becomes necessary.
