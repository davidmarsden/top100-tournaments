# Soccer Manager Sync

## Purpose

Top 100 Soccer Manager Worlds exposes useful structured JSON responses inside the authenticated Soccer Manager web application. Soccer Manager Sync normalizes those responses into stable Top 100 records without storing a Soccer Manager password or copying the raw authenticated session to the Top 100 backend.

The first release is deliberately preview-only.

## v0.1 admin workbench

Global Top 100 administrators can open:

`/admin/soccer-manager-sync`

The page accepts captured JSON files and normalizes them entirely in the browser. It does not write to Supabase.

Supported response shapes:

- Competition snapshot (`competition-ajax.php?action=league...`)
  - game-world/setup id
  - five divisions and standings
  - clubs and stable Soccer Manager club ids
  - manager-to-club assignments
  - latest results
  - next fixtures
  - season/champion history
  - player leaderboard data
- Player changes
  - rating changes
  - position changes
  - newly added players
  - managed/unmanaged state
- Transfer market
  - accepted/completed deals
  - transfer fees and exchange players
  - source/destination club ids
  - manager/customer ids
  - Soccer Manager illegal-deal flag
- Club finance
  - season balance/income/outgoings
  - wages and transfer spend
  - weekly finance history

## Privacy boundary

Raw Soccer Manager responses can contain manager names, customer ids, profile-image metadata and other fields Top 100 does not need publicly.

v0.1 keeps raw files in the importing browser. The normalizer extracts only fields needed for Top 100 workflows. Raw responses must not be committed to the repository or exposed through public routes.

A later collector should run in the already-authenticated Soccer Manager browser context and submit only normalized records. The Top 100 server should never need the user's Soccer Manager password or PHP session cookie.

## Next phases

1. Validate normalized output against live Top 100 data.
2. Add a browser-side collector for the known JSON endpoints.
3. Add a server endpoint that accepts only normalized, schema-validated payloads from an authenticated Top 100 global admin.
4. Store source snapshots and diffs separately from tournament data.
5. Add opt-in actions to apply manager changes, fixtures/results, player changes and other updates to the relevant Top 100 tools.
6. Add scheduled/change notifications only after the sync path is stable and auditable.

Stable Soccer Manager ids should be treated as source keys. Top 100 names remain display fields, not identity keys.
