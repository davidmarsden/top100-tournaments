# Top 100 Tournaments

A bespoke Top 100 tournament organiser and archive app, starting with the Youth Cup workflow.

## Current MVP

The first version creates a tournament shell in Supabase and lists existing tournaments.

Workflow target:

1. Competition setup
2. Create tournament
3. Add entrants
4. Generate groups
5. Generate fixtures
6. Enter results
7. Auto-update tables
8. Generate knockout draw
9. Publish public tournament page
10. Archive automatically

## Required environment variables

Add these in Netlify under Site configuration → Environment variables:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Manager claim email notifications

Pending manager account claims can notify the tournament administrator by email. The database trigger uses `pg_net` after the claim transaction commits, so notification failures never block claim submission.

Server-only Netlify variables:

```env
SUPABASE_SERVICE_ROLE_KEY=your_server_only_service_role_key
RESEND_API_KEY=your_resend_sending_key
MANAGER_CLAIM_ADMIN_EMAIL=admin@smtop100.blog
MANAGER_CLAIM_WEBHOOK_SECRET=a-long-random-secret
MANAGER_CLAIM_EMAIL_FROM=Top 100 Tournaments <notifications@smtop100.blog>
MANAGER_ACCOUNTS_ADMIN_URL=https://youth-cup.smtop100.blog/admin/manager-accounts
```

Never prefix the service-role, Resend or webhook secrets with `VITE_`.

After applying `supabase/migrations/20260720_manager_claim_email_notifications.sql`, store the webhook URL and the same webhook secret in Supabase Vault:

```sql
select vault.create_secret(
  'https://youth-cup.smtop100.blog/.netlify/functions/notify-manager-claim',
  'manager_claim_notification_url'
);

select vault.create_secret(
  'the-same-long-random-secret-used-in-netlify',
  'manager_claim_webhook_secret'
);
```

A pending claim is emailed once per review cycle. If a claim is rejected, corrected and resubmitted, its notification state is reset so the administrator receives a fresh alert.

The Reports & Exports module can also create reviewable drafts on WordPress.com. WordPress.com does not expose the normal `/wp-json/wp/v2` route on a custom domain, so the server function calls the WordPress.com public REST API using a pre-generated OAuth access token.

Configure these values in Netlify only; never expose the token through a `VITE_` variable:

```env
WORDPRESS_SITE_URL=https://smtop100.blog
WORDPRESS_SITE_ID=smtop100.blog
WORDPRESS_ACCESS_TOKEN=your_wordpress_com_oauth_access_token
```

`WORDPRESS_SITE_ID` may be the WordPress.com numeric site ID or its domain. Application passwords and the OAuth password grant are not supported for this integration.

### Browser-only OAuth setup

The access token can be generated on a phone or tablet without a terminal. Before the one-time setup, add these server-only Netlify variables:

```env
WORDPRESS_CLIENT_ID=your_wordpress_com_app_client_id
WORDPRESS_CLIENT_SECRET=your_wordpress_com_app_client_secret
```

Set the WordPress.com application's redirect URL to:

```text
https://youth-cup.smtop100.blog/.netlify/functions/wordpress-oauth-setup
```

After deploying, open that same URL in a browser and tap **Authorise with WordPress.com**. The helper generates a fresh random OAuth state for that attempt and stores it in a short-lived Secure, HttpOnly, SameSite cookie. The callback is accepted only in the browser that initiated the flow, then exchanges the temporary authorization code server-side and displays the resulting `WORDPRESS_ACCESS_TOKEN` and numeric `WORDPRESS_SITE_ID` for copying into Netlify.

After the token is saved and a fresh deploy succeeds, remove `WORDPRESS_CLIENT_SECRET` if the setup helper is no longer needed. Keep `WORDPRESS_ACCESS_TOKEN` private.

The draft-publishing function verifies the caller through Supabase's `is_admin` RPC before using the stored WordPress.com token. Posts are always created as drafts, with the relevant report categories and tags created or reused automatically.

## Netlify build settings

Build command:

```bash
npm run build
```

Publish directory:

```bash
dist
```
