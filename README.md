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
MANAGER_ACCOUNTS_ADMIN_URL=https://tournaments.smtop100.blog/admin/manager-accounts
```

Never prefix the service-role, Resend or webhook secrets with `VITE_`.

After applying `supabase/migrations/20260720_manager_claim_email_notifications.sql`, store the webhook URL and the same webhook secret in Supabase Vault:

```sql
select vault.create_secret(
  'https://tournaments.smtop100.blog/.netlify/functions/notify-manager-claim',
  'manager_claim_notification_url'
);

select vault.create_secret(
  'the-same-long-random-secret-used-in-netlify',
  'manager_claim_webhook_secret'
);
```

The legacy `https://youth-cup.smtop100.blog/.netlify/functions/notify-manager-claim` endpoint is kept as an internal 200 rewrite during the hostname transition so an older stored Vault URL cannot lose POST requests to the browser-facing 301 redirect.

A pending claim is emailed once per review cycle. If a claim is rejected, corrected and resubmitted, its notification state is reset so the administrator receives a fresh alert.

The Reports & Exports module builds the tournament snapshot (JSON and CSV) and generates matchday and knockout stories as Markdown to copy or download for the blog.

## Netlify build settings

Build command:

```bash
npm run build
```

Publish directory:

```bash
dist
```

## Database migrations

Every migration that creates a table, view or function must grant API access explicitly or declare the object private. See [docs/migration-permissions.md](docs/migration-permissions.md). The **Migration permissions** CI check enforces this on pull requests, and the **Supabase Preview** check proves migrations apply on a fresh Supabase database.
