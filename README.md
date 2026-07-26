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

The Reports & Exports module can also create reviewable drafts on WordPress.com. WordPress.com does not expose the normal `/wp-json/wp/v2` route on a custom domain, so the server function calls the WordPress.com public REST API using a pre-generated OAuth access token.

Configure these values in Netlify only; never expose the token through a `VITE_` variable:

```env
WORDPRESS_SITE_URL=https://smtop100.blog
WORDPRESS_SITE_ID=smtop100.blog
WORDPRESS_ACCESS_TOKEN=your_wordpress_com_oauth_access_token
```

`WORDPRESS_SITE_ID` may be the WordPress.com numeric site ID or its domain. Generate `WORDPRESS_ACCESS_TOKEN` through WordPress.com's supported OAuth authorization-code flow and store the resulting token in Netlify. Application passwords and the OAuth password grant are not supported for this integration.

The server function verifies the caller through Supabase's `is_admin` RPC before using the stored WordPress.com token. Posts are always created as drafts, with the relevant report categories and tags created or reused automatically.

## Netlify build settings

Build command:

```bash
npm run build
```

Publish directory:

```bash
dist
```
