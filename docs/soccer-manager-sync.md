# Soccer Manager Sync

## Purpose

Top 100 Soccer Manager Worlds exposes useful structured JSON responses inside the authenticated Soccer Manager web application. Soccer Manager Sync normalizes those responses into stable Top 100 records without storing a Soccer Manager password or copying the raw authenticated session to the Top 100 backend.

The sync path is deliberately preview-only until the source schemas are stable.

## v0.2 browser collector

The admin workbench now provides a **Top 100 Sync** bookmarklet.

While the administrator is already signed into Soccer Manager, the bookmarklet:

1. checks that it is running on an HTTPS `soccermanager.com` origin;
2. inspects the current page's Resource Timing entries for known read-only Soccer Manager JSON endpoints;
3. opens/reuses the protected Top 100 Sync admin page immediately from the user's click;
4. refetches those same endpoint URLs from the Soccer Manager tab with the browser's existing authenticated session;
5. repeatedly sends a session-scoped hello message to the exact `WindowProxy` returned by `window.open`;
6. waits for the newly loaded Sync document to reply to that hello via `event.source`, proving readiness for the current collector tab rather than a stale opener;
7. sends only the JSON response bodies and source URLs to that ready document with cross-origin `postMessage`;
8. accepts the final acknowledgement only when it comes from the exact Sync window/origin and carries the same session token.

No Soccer Manager password, Cookie header, PHP session id or request headers are transmitted to Top 100.

Known finance companion responses are collapsed only when `clubfinance` and `incomegraph` have the same remaining source context and normalize to the same data. Responses from different clubs/worlds keep their distinct source URLs even when their normalized values happen to match.

The receiving page accepts messages only from HTTPS `soccermanager.com` origins, checks the declared source origin against the browser-supplied message origin, requires the per-run collector session token, and replies to readiness probes via the actual message `event.source` rather than `window.opener`. It normalizes at most the 20 most recent responses, so the screen the administrator just opened is not displaced by older Resource Timing history, and remains behind the existing global administrator gate. Normalized downloads preserve the captured source URL so action/world/club query context is not lost. The UI also uses that full source identity for React keys while keeping the endpoint basename as the human-readable label, preventing previews from being reused across different query variants.

The collector also sends a diagnostic list of the 50 most recent same-origin resource requests visible through the browser's Resource Timing API. This lets us discover real Soccer Manager endpoint names when a screen is not yet covered by the known patterns. Diagnostic URLs are restricted to the current Soccer Manager origin and query parameters with names suggesting tokens, sessions (including aliases such as `PHPSESSID`/`sessid`), auth, secrets, passwords, cookies or keys are redacted before transmission.

The Sync workbench shows those requests in a diagnostic table and can download the sanitized list as a small JSON file. The download preserves the collector's original capture timestamp rather than the later download time. Diagnostics contain URLs/timing metadata only, never cookies, request headers or response bodies.

For club-squad responses, the normalizer now also receives the captured source URL as context. If the response body omits club/world identity, it can safely recover the non-secret `clubid` and `sid` query values from that already-captured URL. The normalized squad output keeps those as `club.clubId` and `club.setupId`; the action/latest response id are retained separately as source context.

The collector currently discovers these endpoint families when they have already been requested by the current Soccer Manager page:

- `competition-ajax.php`
- `club-ajax-mobile.php`
- player-changes mobile endpoints
- transfer-market mobile endpoints

If a relevant request has not yet happened on the current page, open that Soccer Manager screen first and run the bookmarklet again. Club squad responses are detected by their player-record shape rather than relying on one fragile top-level array name, because the observed `clubinitdata2` response nests the squad data. Detection validates evidence per player row: a row must contain a real player ID plus either a meaningful name or a parseable rating. Squad aliases are normalized before selection rather than chosen by key presence. Blank text and whitespace-only/unparseable numeric aliases fall through to valid alternatives; player IDs treat `0` as absent; nested camel-case club metadata is included; and age, position, nationality, value, wages, contract and transfer-list aliases use the same normalized fallback rule. Only those qualifying rows are kept, and candidate arrays with at least two such players are ranked. This prevents a larger unrelated ID-only array from hiding the actual squad.

To finish mapping fields that are present in the raw club response but not yet recognized by the normalizer, the normalized squad now includes a schema diagnostic containing only the unique player-row field names. The workbench exposes those names behind a disclosure panel. No raw player values are included in that schema diagnostic.

If no supported JSON response matches, the diagnostic request list is still delivered so the missing endpoint can be identified without opening browser developer tools.

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
- Club squad (`club-ajax-mobile.php?action=clubinitdata2...`)
  - player/source ids
  - observed name fields: `playerpitchname`, `playername`, `playersurname`; `playername` is treated as a Soccer Manager short/display name rather than a literal first name, and the same aliases are used during squad detection
  - observed position fields: `playerposition`, `playerpositionid`
  - age, rating, nationality, value and wages
  - observed contract/condition raw fields: `ctrraw`, `conraw`
  - appearances plus observed `gs` / `as` goal-assist fields
  - youth/goalkeeper flags where present
  - `isplayeronvisibletransferlist` remains visible in the field-name schema diagnostic but is not used as transfer-listed status because the live squad capture showed it true for every player; legacy `transferlisted`, `transfer_list` and `tl` aliases remain supported when present
- Club finance
  - season balance/income/outgoings
  - wages and transfer spend
  - weekly finance history

## Privacy boundary

Raw Soccer Manager responses can contain manager names, customer ids, profile-image metadata and other fields Top 100 does not need publicly.

Raw files and browser-collected responses remain in browser memory. The normalizer extracts only fields needed for Top 100 workflows. Raw responses must not be committed to the repository or exposed through public routes.

The collector deliberately runs in the already-authenticated Soccer Manager browser context. The Top 100 server never receives or needs the user's Soccer Manager password or PHP session cookie.

## Next phases

1. Validate browser-collected normalized output against live Top 100 data.
2. Expand endpoint discovery as more Soccer Manager JSON surfaces are confirmed.
3. Add a server endpoint that accepts only normalized, schema-validated payloads from an authenticated Top 100 global admin.
4. Store source snapshots and diffs separately from tournament data.
5. Add opt-in actions to apply manager changes, fixtures/results, player changes and other updates to the relevant Top 100 tools.
6. Add scheduled/change notifications only after the sync path is stable and auditable.

Stable Soccer Manager ids should be treated as source keys. Top 100 names remain display fields, not identity keys.
