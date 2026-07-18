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
SUPABASE_SERVICE_ROLE_KEY=your_server_only_service_role_key
RESEND_API_KEY=your_resend_api_key
MANAGER_CLAIM_ADMIN_EMAIL=admin@example.com
MANAGER_CLAIM_WEBHOOK_SECRET=a-long-random-secret
MANAGER_CLAIM_EMAIL_FROM=Top 100 Tournaments <notifications@your-verified-domain.example>
MANAGER_ACCOUNTS_ADMIN_URL=https://your-site.example/admin/manager-accounts
```

`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` and `MANAGER_CLAIM_WEBHOOK_SECRET` are server-only. Never prefix them with `VITE_`.

After applying `20260720_manager_claim_email_notifications.sql`, add the matching webhook values to Supabase Vault:

```sql
select vault.create_secret(
  'https://your-site.example/.netlify/functions/notify-manager-claim',
  'manager_claim_notification_url'
);

select vault.create_secret(
  'the-same-long-random-secret-used-in-netlify',
  'manager_claim_webhook_secret'
);
```

The database trigger is best-effort: manager claims remain successfully submitted even when email delivery is unavailable. A pending claim is emailed once; a rejected claim that is corrected and resubmitted generates a fresh notification.

## Netlify build settings

Build command:

```bash
npm run build
```

Publish directory:

```bash
dist
```
