# Top 100 app (manager.smtop100.blog)

`manager.smtop100.blog` is the installable **Top 100** PWA. Soccer Manager has no app, API or deep-link scheme and refuses to be framed (`X-Frame-Options: SAMEORIGIN`), so the app is a companion: it shows Top 100 data and links out to soccermanager.com.

## What it does

- **Install**: `my-matches.webmanifest` (name "Top 100"), PNG/maskable/Apple icons, an install prompt (Android/desktop Chrome) and Add to Home Screen instructions (iOS Safari).
- **Soccer Manager shortcuts** (`src/lib/soccerManagerLinks.js`): enter the game world, open my club, open the next opponent, and open any club in the division table. Club pages use SM's catalogue id (`clubDataId`, captured in standings by Top 100 Sync) and show the game world the user's SM session is currently in.
- **My club**: league position, form, squad summary and next tournament fixture from `get_my_top100_app_home()`.
- **Notifications**: an in-app inbox plus Web Push for fixtures (new, day-before and fixture-day), results, opponent arrangement actions, match comments, Top 100 Chat replies and admin announcements (Control Room → *Send an announcement*). Each category can be switched off; a switched-off category still appears in the inbox.

Soccer Manager's in-game private messages cannot be included: they are only readable inside a logged-in SM session, and the Top 100 backend neither holds SM credentials nor can reach SM (Cloudflare blocks automated access).

## How delivery works

1. Triggers on `matches`, `manager_match_arrangement_events` and `match_comments`, plus `send_manager_broadcast()` and `enqueue_chat_reply_notification()`, insert rows into `manager_notifications` (deduplicated by `dedupe_key`).
2. `wake_push_dispatcher` calls `/.netlify/functions/push-dispatch` through pg_net once per transaction.
3. `push-dispatch` claims pending rows (`claim_pending_push_notifications`, `SKIP LOCKED`), sends Web Push with `web-push`, then reports back (`complete_push_notifications`), removing expired devices.
4. `push-dispatch-scheduled` runs every five minutes: it queues day-before/fixture-day reminders (from 08:00 UK time), a daily "sync due" reminder to global admins when the last Top 100 sync is over a day old (from 09:00 UK time, linking to `lab.smtop100.blog/sync`), and retries anything still pending. Pending notifications older than two days are dropped from the push queue.

Read notifications are not yet pruned automatically; with about 100 managers the table grows slowly. Add a retention job if it ever matters.

The manager-host service worker (`public/pwa-sw.js`) still has **no fetch handler** and deletes legacy shell caches, so the portal is never served from a cache. It only shows notifications and opens the right page when one is tapped.

## Setup

1. Database: applied to production on 22 October 2026 as the nine `20261022*_top100_app_*` migrations.
2. Generate VAPID keys: `npx web-push generate-vapid-keys`.
3. Netlify environment variables:

   ```env
   VITE_VAPID_PUBLIC_KEY=<public key>            # public, used by the browser
   VAPID_PRIVATE_KEY=<private key>               # server only
   VAPID_SUBJECT=mailto:admin@smtop100.blog
   TOP100_PUSH_DISPATCH_SECRET=<long random>     # server only
   TOP100_CHAT_EVENT_SECRET=<long random>        # server only
   ```

4. Supabase Vault (same secret as Netlify):

   ```sql
   select vault.create_secret('https://manager.smtop100.blog/.netlify/functions/push-dispatch', 'top100_push_dispatch_url');
   select vault.create_secret('<TOP100_PUSH_DISPATCH_SECRET>', 'top100_push_dispatch_secret');
   ```

5. Optional, Top 100 Chat replies: add to `/etc/top100-chat.env` on the chat server and restart the gateway:

   ```env
   TOP100_APP_CHAT_EVENT_URL=https://manager.smtop100.blog/.netlify/functions/chat-push-event
   TOP100_APP_CHAT_EVENT_SECRET=<TOP100_CHAT_EVENT_SECRET>
   ```

Without the VAPID keys the app still works: notifications collect in the inbox and the push controls say push isn't switched on yet.
