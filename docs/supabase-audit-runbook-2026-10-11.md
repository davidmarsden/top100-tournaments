## Migration audit script

The read-only audit script at `scripts/audit-supabase-migrations.mjs` compares a trusted export of `supabase_migrations.schema_migrations` against both repositories. It does not execute SQL or alter migration history.

### Prepare inputs

Clone `davidmarsden/top100-manager-lab` alongside `top100-tournaments`. Export `version`, `name`, and the original `statements` array from the connected Supabase project into a **local** JSON file. Ensure that export is not committed: migration SQL can include sensitive or environment-specific data.

### Run

```sh
node scripts/audit-supabase-migrations.mjs \
  --remote /tmp/top100-supabase-migrations.json \
  --lab ../top100-manager-lab \
  --output /tmp/top100-migration-comparison.json
```

The output reports exact SQL matches, whitespace-normalized equivalents, filename/version candidates whose SQL differs, and migrations for which no candidate exists in either repository.

**Status:** The comparison script is committed but its full run has not been verified. A database export is required, and the previous bulk connector attempts exhausted operation limits. Do not treat candidate filenames as verified SQL matches. The draft PR is not the executable repair and must not be merged as one.

**Recovery:** For each verified equivalent, recover the original filename/version from Git history or stored remote SQL; distinguish any subsequent local edits as new migrations. Do not rename or apply unmatched SQL on production. No database changes were made.
