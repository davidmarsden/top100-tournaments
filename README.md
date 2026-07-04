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

## Netlify build settings

Build command:

```bash
npm run build
```

Publish directory:

```bash
dist
```
