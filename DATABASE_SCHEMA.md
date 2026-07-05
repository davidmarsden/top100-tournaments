# Top 100 Tournament Database Schema

This is the canonical schema reference for the Top 100 tournament organiser app.

Important rules for future development:

- All primary keys are `int8` / `bigint` identity columns, not UUIDs.
- Future SQL and app code must match these table and column names.
- `tournaments`, `tournament_entries`, `groups`, `matches`, `tournament_stages`, `tournament_rounds` and `tournament_round_dates` are the core app tables.
- `matches` currently stores fixture metadata and score fields, including aggregate, extra time, penalties, forfeits, walkovers, seeds and placeholders.
- Group seeding should use `tournament_entries.rating`.
- Round dates are stored in `tournament_round_dates`.

## Core tables

- `seasons`
- `competitions`
- `tournaments`
- `tournament_formats`
- `tournament_stages`
- `tournament_rounds`
- `tournament_round_dates`
- `teams`
- `managers`
- `tournament_entries`
- `groups`
- `matches`

## Supporting tables

- `forfeits`
- `honours`
- `manager_clubs`
- `team_aliases`
- `attachments`
- `audit_log`
- `settings`
- `achievements`

## ID policy

Use `bigint` / `int8` IDs throughout. Do not create UUID foreign keys for this project unless the schema has first been migrated deliberately.
