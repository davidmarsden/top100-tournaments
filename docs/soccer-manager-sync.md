# Soccer Manager Sync

## Purpose

Top 100 Soccer Manager Worlds exposes useful structured JSON responses inside the authenticated Soccer Manager web application. Soccer Manager Sync normalizes those responses into stable Top 100 records without storing a Soccer Manager password or copying the raw authenticated session to the Top 100 backend.

The collector and normalizer remain browser-first. v0.3 added a private persistent staging layer; v0.4 adds the first explicit archive adapter. Normalized data is still staged and approved first, and archive writes happen only when a global administrator separately chooses **Apply core archive**.


## v0.4 core archive adapters

The Sync workbench now has a separate **Apply approved data to the archive** module. This is intentionally independent of source review: approving a canonical Soccer Manager change records source truth, while applying an adapter updates Top 100 archive records.

The first adapter consumes approved canonical entities only and applies the safest archive spine in one transactional, global-admin-only RPC:

1. Soccer Manager world/setup → `game_worlds`;
2. current standing clubs → `game_world_clubs` and the existing `teams` directory;
3. stable manager/customer ids → `managers`;
4. current manager-to-club assignments → `game_world_clubs` plus world-scoped `soccer_manager_world_manager_assignments`;
5. season/champion history → `seasons` and league-title `achievements`;
6. each approved standing state → immutable `league_standing_snapshots`, using a deterministic per-entity approval sequence so pre-versioning legacy approvals are preserved too.

`soccer_manager_archive_links` keeps the stable source-id-to-archive-id mapping. Names are used only for a cautious first match when no mapping exists; team matching uses the same punctuation-, spacing- and accent-insensitive `team_directory_key` as the rest of the Top 100 directory, and manager matching uses the same normalized registration key as portal claims. Ambiguous matches abort the transaction rather than guessing. The link also remembers the last source club display name so world-specific renames can update `game_world_clubs` without letting whichever world was applied last rename the shared global `teams` row. The directory-sync trigger and registration-promotion RPC both honour that stable mapping, so a world-only rename reuses the mapped team instead of creating a duplicate. Manager source display names are likewise kept world-scoped in the current assignment/directory while the shared `managers` row remains stable after first linkage; registration promotion resolves the mapped world assignment before falling back to global name matching. Managers created only from historical season records start inactive and become active only through a current assignment.

The adapter is idempotent. Re-running it updates mapped current records, does not duplicate league titles, and inserts a standing snapshot only once for each approved standing approval in that entity's chronological history. Current directory state collapses canonical standings to the most recently approved row per world/club, so promotions and relegations do not leave an older division row in control. Current manager assignments are stored per game world rather than mutating the global `manager_clubs.current_club` career flag. The authoritative current standing is checked before any manager activation: a standing that explicitly reports a club unmanaged clears only that world's current assignment and does not reactivate a stale canonical manager assignment. For a genuinely managed club, applying the assignment also upserts an active `manager_game_world_memberships` row so Portal, Voting and lifecycle features recognise the imported manager in that world. The adapter does not infer other departures or sackings from absence, and a normal sync or source approval never invokes it automatically.

League titles are stored in `achievements`, not `honours`, because the current `honours` table is tied to a tournament entry. `achievements` now carries optional game-world, season and source provenance so league history can coexist cleanly with tournament honours.

Tournament fixtures/results, transfers, player history and analytics are deliberately outside this first adapter.



## v0.5 player and transfer archive

The second archive layer adds a separate **Apply players & transfers** action for each approved Soccer Manager world. It remains independent from both source review and the core archive apply.

The adapter consumes approved canonical `squad_player`, `transfer` and `player_change` entities and writes four private archive surfaces:

- `soccer_manager_players` — one stable player identity per game world and Soccer Manager player-data id, enriched by the latest approved squad state;
- `soccer_manager_player_snapshots` — immutable snapshots of every approved squad-player state, including rating/value/contract/performance and tactical current-state fields;
- `soccer_manager_transfers` — one stable transfer record per Soccer Manager transfer entity, updated as the same deal progresses through later approved states;
- `soccer_manager_player_changes` — occurrence-keyed rating/position/new-player events.

Squad `playerDataId` is preferred as the cross-surface player identity because transfer-market rows use that underlying player id. The world-specific squad `playerId` is retained separately. If a transfer or player-change event is approved before the player has appeared in a squad capture, the adapter creates a minimal player identity and a later squad apply enriches it rather than creating a second player.

Current club/team membership is set only from approved squad state. Every squad capture also stages a `squad_scope` canonical entity containing the complete roster of stable player IDs for that club, including an empty roster. Empty `clubinitdata2` responses are recognized from the sanitized request URL context (`clubid`, `sid`, `action=clubinitdata2`) even when there are no player rows to identify the payload by shape. Once reviewed, that scope marker is the authoritative current roster: players previously attached to the mapped team but absent from the approved roster have their current-team fields cleared. Transfer history does **not** move a player's current team, because old completed transfers can still appear in the market history and must not overwrite a newer squad capture. Transfer club and manager references are resolved through the existing stable Soccer Manager archive links where possible; unresolved club references are counted and reported instead of guessed.

Transfer normalization now preserves the source turn alongside each transfer so later analytics can compare market activity by game turn as well as by the source's human date label.

All four tables are admin-private in v0.5. Squad snapshots include morale, condition, wages and other tactical/current-state data, so public player pages should later be built from an explicit curated view rather than granting anonymous access to the raw archive tables.

The adapter is idempotent: current player records are upserted, authoritative squad-scope removals clear stale current-team membership without deleting player history, transfer/change entities keep stable source identities, and player snapshots are inserted once per approved entity/version sequence. Player-change chronology uses the source sync run's capture time rather than the later review timestamp.


## Production bootstrap — 23 September 2026

The core archive adapter was deployed to the Top 100 production Supabase project and bootstrapped from the normalized full-league capture taken on 22 September 2026 for Soccer Manager setup `239138`.

Because the persistent staging tables were still empty at deployment time, the normalized capture was rebuilt into the same core entity shapes used by the application and staged as the initial reviewed baseline: 1 world, 5 divisions, 100 standings, 100 current manager assignments and 27 season-history rows (233 entities total). Fixtures, player leaders, transfers, player changes, squad data and finance data were deliberately left for their dedicated later adapters.

The bootstrap exposed several live-data identity/status details that are now part of the documented contract:

- Soccer Manager's `managed` field is a status code, not a boolean. In the live baseline, `managed = 2` identifies the 99 genuinely occupied clubs, while `managed = 1` identified FC Schalke 04 with Clint McKAY's application still pending. The adapter therefore treats `2` (or an explicit true/yes boolean-like value) as current/occupied and leaves `1` unoccupied.
- Stable Soccer Manager manager ids remain authoritative across display-name changes. The production bootstrap explicitly linked the existing Top 100 identities for three pre-existing normalized-name duplicates and linked Soccer Manager manager `22959444` to the established Melvin Udall manager record when the source display changed from `5️⃣8️⃣` to `6️⃣0️⃣`.

The first archive apply had already inserted all 100 immutable standing snapshots and 27 league-title achievements before the managed-flag mismatch was discovered. After the managed-flag hotfix, the same approved baseline was reapplied idempotently. The corrected production state is:

- 100 current clubs imported;
- 99 current managers resolved;
- 99 world-scoped manager assignments;
- 99 occupied Top 100 club-directory rows;
- FC Schalke 04 remains unoccupied while Clint McKAY's application is pending;
- 27 seasons;
- 27 Soccer Manager league-title achievements;
- 100 standing snapshots;
- 1 skipped non-current assignment on the corrected apply (the pending Schalke application).

The later corrected apply inserted zero additional standing snapshots, confirming the snapshot path is idempotent for an already-applied approved baseline. It also deactivated Clint McKAY's Top 100 world membership when clearing the incorrectly-created Schalke assignment. The audit log preserves the bootstrap applies and corrections.

Operationally, future imports should continue to use **stage → review/approve → Apply core archive**. If an identity match is ambiguous, the adapter must stop and the stable source id must be linked deliberately; it must not guess or create a parallel identity.


## v0.3 persistent staging and review

The Sync workbench can now **Stage for review** after a successful browser sync or JSON import.

Staging persists only normalized Top 100 data. File imports clear any prior browser-collector capture timestamp so a staged file import cannot inherit unrelated audit metadata. Raw Soccer Manager responses, cookies, request headers and browser-session credentials are never written to Supabase. Source URLs are sanitized again before persistence and sensitive-looking query parameters are redacted.

Three private, global-admin-only tables form the source layer:

- `soccer_manager_sync_runs` — immutable normalized snapshots and sync metadata;
- `soccer_manager_sync_changes` — the review queue of new/changed canonical entities;
- `soccer_manager_canonical_entities` — the latest approved Soccer Manager source state.

The browser converts each normalized response into stable source entities before staging. Current entity types include worlds, divisions, standings, manager assignments, fixtures/results, season history, player leaderboards, squad scopes, squad players, transfers, player changes and club finance snapshots. Player-change normalization preserves a source event ID/date/turn when present, and canonical player-change events are staged only when one of those occurrence discriminators is available; this prevents a later repeated rating/position transition from being collapsed into an earlier event. World-specific market events first use the entry's own sanitized source URL for `sid`, treating placeholder zero IDs as absent just like the main normalizer, then fall back only when the entire captured batch has one unambiguous world. Repeated squad captures of the same `(setupId, clubId)` are deduplicated before deciding whether a fallback club context is unique. Batch ambiguity detection includes the sanitized source context of every captured entry, not just competition and squad responses; if no single world can be established, the event is not staged as a canonical entity.

The staging RPC compares incoming entities with the approved canonical source state and creates review rows only when the normalized JSON is new or changed. Each staged change also records the canonical version it was compared against. Re-running an unchanged sync therefore produces a zero-change reviewed run rather than another pile of duplicate work.

Approving a change updates only the private canonical source layer. Rejecting it leaves canonical source state unchanged. Before approval, the RPC serializes review transitions for the run and takes a transaction-scoped advisory lock on each stable entity identity before locking/rechecking the canonical row. This also covers first-time entities where no canonical row exists to lock yet. The current canonical version/data must still match the baseline captured when the change was staged; stale individual or bulk approvals are rejected instead of overwriting newer canonical state. Bulk approve/reject is available only after the UI has paged through the complete change set for the run, and the before/after review panes render the complete normalized JSON rather than a truncated preview. The “already up to date” empty state is shown only for runs whose recorded change count is actually zero, so a failed/incomplete queue load cannot masquerade as a clean sync. Run switching clears the previous queue immediately and stale async responses are ignored. The review selector keyset-pages unresolved runs by descending run ID to exhaustion, so it remains stable even if another reviewer completes a run while later pages are loading. Overlapping run-list loads also use request-generation guards, so an older response cannot overwrite a newer staged/refreshed run list. Review actions explicitly reload the run list and selected queue once; they no longer trigger a second parent refresh cycle. It therefore includes every unresolved run beyond PostgREST's per-response row cap, plus the 12 most recent completed runs. Older pending work cannot be evicted by newer zero-change/completed syncs, response-size limits or offset shifts caused by concurrent review. These review operations are transactional database RPCs and require `public.is_admin()`; browser roles receive read access only to the private tables.

Source review itself still does **not** write to public archive tables. Archive mutation is a separate v0.4 admin action, and tournament `matches`, transfers and player history remain untouched by the core adapter.

The first version only stages **new and changed** entities. It does not yet infer removals (for example, a player leaving a squad) from absence in a snapshot. Removal semantics will be added only for endpoint scopes proven to be complete authoritative sets.

## v0.2 browser collector

The admin workbench now provides a **Top 100 Sync** bookmarklet.

While the administrator is already signed into Soccer Manager, the bookmarklet:

1. checks that it is running on an HTTPS `soccermanager.com` origin;
2. inspects the current page's Resource Timing entries for known read-only Soccer Manager JSON endpoints;
3. opens/reuses the protected Top 100 Sync admin page immediately from the user's click;
4. refetches those same endpoint URLs from the Soccer Manager tab with the browser's existing authenticated session;
5. repeatedly sends a session-scoped hello message to the exact `WindowProxy` returned by `window.open`;
6. waits for the newly loaded Sync document to reply to that hello via `event.source`, proving readiness for the current collector tab rather than a stale opener;
7. sends only the JSON response bodies and sanitized source URLs to that ready document with cross-origin `postMessage`;
8. accepts the final acknowledgement only when it comes from the exact Sync window/origin and carries the same session token.

No Soccer Manager password, Cookie header, PHP session id or request headers are transmitted to Top 100. Supported payload source URLs now pass through the same sensitive-query redaction used by diagnostics before they cross origins.

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

1. Add authoritative-scope removal detection for complete league, manager-assignment and squad snapshots.
2. Build curated public player/transfer views and archive browsing on top of the private v0.5 player/transfer archive.
3. Match approved Soccer Manager fixtures/results to friendly-tournament records without guessing on ambiguous teams or ties.
4. Build player/transfer analytics and the Hamburger SV manager dashboard from canonical history rather than live page state.
5. Expand endpoint discovery as more Soccer Manager JSON surfaces are confirmed.
6. Add scheduled/change notifications only after the sync path and archive adapters are stable and auditable.

Stable Soccer Manager ids should be treated as source keys. Top 100 names remain display fields, not identity keys.
