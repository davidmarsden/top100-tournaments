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

Current club/team membership is set only from approved squad state. Every squad capture also stages a `squad_scope` canonical entity containing the complete roster of stable player IDs for that club, including an empty roster. Empty `clubinitdata2` responses are recognized from the sanitized request URL context (`clubid`, `sid`, `action=clubinitdata2`) even when there are no player rows to identify the payload by shape. The trusted endpoint also lowers the squad detector threshold from two qualifying player rows to one, so a legitimate one-player squad is not mistaken for an empty roster; the stricter two-row heuristic remains in place for untrusted/shape-only detection. Once reviewed, that scope marker is the authoritative current roster: players previously attached to the mapped team but absent from the approved roster have their current-team fields cleared. Transfer history does **not** move a player's current team, because old completed transfers can still appear in the market history and must not overwrite a newer squad capture. Transfer club and manager references are resolved through the existing stable Soccer Manager archive links where possible; unresolved club references are counted and reported instead of guessed.

Transfer normalization now preserves the source turn alongside each transfer so later analytics can compare market activity by game turn as well as by the source's human date label.

All four tables are admin-private in v0.5. Squad snapshots include morale, condition, wages and other tactical/current-state data, so public player pages should later be built from an explicit curated view rather than granting anonymous access to the raw archive tables.

The adapter is idempotent: current player records are upserted, authoritative squad-scope removals clear stale current-team membership without deleting player history, transfer/change entities keep stable source identities, and player snapshots are inserted once per approved entity/version sequence. Player-change chronology uses the source sync run's capture time rather than the later review timestamp.



## v0.7 tactics capture and archive

The sync workbench now recognizes the authenticated club tactics response observed at:

`club-ajax-mobile.php?action=tacticsdraw&getdata=1&gettemplate=1&clubid=…`

Detection is URL-context first so the tactics response cannot be mistaken for a normal club-squad response simply because it also contains player rows.

The tactics normalizer currently extracts only fields observed and useful for Top 100 analysis:

- team instruction codes: aggression, attacking/passing style, focus passing, tempo, pressing, counterattack, men behind ball, tight marking, offside, playmaker/target-man switches, width, fluidity, creativity, forwards, wide play, back line, sweeper keeper, captain and penalty taker;
- formation id where the response exposes one;
- player tactical state including stable player ids, kit/slot number, arrow, rating, age, value, foot, contract, appearances, goals/assists, expected appearances, games played, average rating, form, position, morale, fitness, injury date and suspended/injured state;
- the response turn date where present.

Raw authenticated responses remain browser-only. Only the normalized subset is staged.

Each reviewed tactical occurrence becomes a private `tactics_snapshot` canonical entity. The provisional occurrence key is `(setup, club, turnDate)` when a turn date exists; same-day corrections are retained as canonical versions instead of overwriting archive history. If no turn date is available, the entity falls back to the club's latest tactical state. This is intentionally provisional: once a real Soccer Manager match/turn source id is discovered, fixture/result linkage should use that stable id rather than inferred dates.

Approved tactical versions are copied explicitly into `soccer_manager_tactics_snapshots` by the admin-only `apply_soccer_manager_tactics_archive()` action. The archive table is private/admin-readable and stores normalized instruction/player JSON plus source capture time. It is not yet exposed on the manager dashboard.

The purpose is historical correlation rather than mirroring the live tactics screen: later analysis can compare tactical instructions, selection, fitness and morale against results, player performance and any match-engine statistics we discover.

## v0.6 manager squad dashboard

The Manager Portal now has a private **Squad & Transfers** view backed by `get_my_soccer_manager_dashboard()`.

The RPC is manager-scoped rather than exposing the raw Soccer Manager archive tables. It resolves the signed-in user's active Manager Portal account, current game-world assignment and team, then returns only that manager's own current squad, latest league-standing snapshot and transfers involving that team. Other clubs' private squad state is not exposed.

The dashboard deliberately separates senior and youth data so a large development squad does not distort first-team metrics. Initial headline measures include senior squad size, average rating, average age, value, 89+ depth, short contracts, youth size/rating, positional depth, performance leaders and actionable condition/morale/succession flags.

Transfer counterparties use two distinct models:

- one of the 100 canonical Top 100 game-world clubs can resolve to a mapped `team_id`;
- the much larger Soccer Manager universe contains hundreds or thousands of external real-life clubs which buy/sell players and can participate in SMFA Cup/Shield competitions. Those sides retain their Soccer Manager club id and source name without being forced into the Top 100 world directory.

This distinction is intentional and should also be used by later SMFA competition and market-analysis features.


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

When the current Soccer Manager page has loaded known match-engine JavaScript assets, the collector also captures source text for an exact same-origin allowlist: `constants.js`, `jsutil.js`, `random.js`, `randomdata.js`, `attributes.js`, `formationdata.js`, `positions.js`, `matchreportcommentary.js`, `livematch.js` and `livematch2d.js`. The workbench validates the origin/path allowlist again, rejects duplicate paths, caps each file at 2 million characters and the bundle at 6 million characters, and exposes a separate **Download match-engine diagnostics** JSON export. The bundle contains static JavaScript source text plus source URLs only; cookies, request headers and authenticated JSON response bodies are never included.

The Top 100 Sync bookmarklet is now a small loader rather than a copy of the full collector. It injects the current `https://tournaments.smtop100.blog/sm-sync-collector.js` script into the Soccer Manager page; that script immediately verifies it is running on an HTTPS `soccermanager.com` origin before doing anything. This avoids long bookmark URLs on mobile/tablet browsers and means normal collector updates no longer require replacing the saved bookmark. If the page's Content Security Policy ever blocks the external script, the loader shows an explicit error instead of failing silently.

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

### Match replay diagnostics

When a completed Soccer Manager match page exposes the replay payload as `window.liveMatchXML`, the browser collector copies that XML into the Sync workbench as a temporary diagnostic only. The capture is capped at 2,000,000 characters, keeps only the sanitized current Soccer Manager page URL as metadata, and is not included in normal staging or archive persistence.

The workbench independently checks the source origin and size before exposing **Download match replay diagnostics**. The resulting `top100-sm-match-replay-diagnostics-YYYY-MM-DD.json` file contains the original capture timestamp, sanitized match-page URL, XML text and any capture error. This first-pass diagnostic is intended to reveal the real multiplayer replay schema before any normalized match archive is designed.


## v0.8 completed-match archive

A completed match replay captured through `window.liveMatchXML` can now be normalized into a reviewable `matchReplay` payload. The normalizer resolves the current Soccer Manager fixture from the replay's own club directory and game-world fixture list rather than guessing from the selected club alone.

The normalized payload deliberately excludes the raw XML. It keeps:

- world/setup id and stable Soccer Manager fixture id
- competition code/name and home/away source club ids/names
- final score derived from structured goal key-events
- matchday player ids/names and home/away side
- structured key events
- chance groups with shooter/provider/goalkeeper ids, outcome, attack type and available 2D detail codes
- substitution batches reconstructed from the replay commentary
- minute-level domination as the source `l` value, stored neutrally as `leftValue`
- game-world fixture and score timelines

Staging creates one canonical `match_snapshot` entity per `setupId + fixtureId`. A later approved recapture of the same fixture becomes a new source version instead of a duplicate match.

The private match archive consists of:

- `soccer_manager_match_snapshots`
- `soccer_manager_match_players`
- `soccer_manager_match_events`
- `soccer_manager_match_domination`
- `soccer_manager_match_world_scores`

All tables have RLS enabled and are readable only by authenticated global admins; anonymous access is revoked. The admin-only `apply_soccer_manager_match_archive(text)` RPC reads only approved `match_snapshot` changes, maps match clubs through the existing Soccer Manager archive links, and inserts immutable versioned snapshots plus queryable child rows. Re-running the adapter is idempotent.

The first known acceptance case is Top 100 fixture `282010118`, Hellas Verona 3–0 Hamburger SV. Its captured replay contains 36 players, 11 key events, 10 chance groups, one substitution batch, 89 domination-minute rows and seven game-world score events.


### Bulk replay discovery

The match-engine diagnostics allowlist also includes `/js/common/multiplayer_videoplayer.js`. Soccer Manager loads this alongside the live-match renderer, while `livematch.js` itself only consumes the already-populated `window.liveMatchXML`. Capturing the video-player source is therefore the evidence-gathering step for identifying the authenticated replay-loader request used by completed fixtures.

Do not guess or hard-code a replay endpoint from fixture IDs. Once the loader contract is observed, the intended bulk workflow is: derive completed fixture IDs from approved world/match data, fetch replays from the authenticated Soccer Manager tab with bounded concurrency and resumable progress, normalize each replay through the existing match replay normalizer, and stage deduplicated `match_snapshot` entities for review.


### Replay page context diagnostics

Because the completed-match renderer consumes an already-populated `window.liveMatchXML`, the collector can capture a structural diagnostic of the replay-selection context without exporting arbitrary page source. It contains only the sanitized current page URL, selected replay-related query parameters, non-sensitive fixture/match identifiers from DOM metadata and hidden inputs, and sanitized same-origin form/link destinations whose query keys indicate replay-related fixture/match/game/club/setup/season/turn context. Inline script bodies are not parsed or transferred.

This context is diagnostic-only: it is not added to normalized sync payloads, staged for review, or persisted to Supabase. The workbench independently requires the Soccer Manager origin, reconstructs query and identifier maps from bounded string entries (40 query fields, 80 identifiers, 500 characters per value), accepts at most 80 bounded same-origin replay navigation entries, and rejects the structural packet if its serialized size exceeds 100,000 characters. Arbitrary inline-script and HTML excerpts are never transferred.

The purpose is to identify the server-side completed-replay selection contract from observed structural evidence rather than guessing an endpoint. Once a fixture selector/action is confirmed, bulk season harvesting can use that observed contract with bounded concurrency, resume/progress and the existing match replay normalizer.


## v0.9 Hamburger SV current-season backfill pilot

The Top 100 Sync router now offers **Backfill Hamburg season** as an explicit pilot action. Open one completed Hamburger SV match first so the authenticated Soccer Manager page supplies a known fixture id, then run the bookmarklet and choose the backfill action.

The helper fetches that observed `matchreport-ajax-mobile.php?fixtureid=…&action=mr` contract with the existing authenticated browser session. It recursively discovers fixture records exposed by the seed report, restricts candidates to played fixtures involving stable Hamburger SV club id `48506708`, deduplicates fixture ids, and fetches the reports sequentially with a short delay and an 80-fixture safety cap.

This pilot is deliberately **download/review only**. It does not stage or persist raw match reports in Supabase. The downloaded `top100-hamburg-season-match-backfill-YYYY-MM-DD.json` contains an import summary, normalized match identity/basic Hamburg statistics/schema inventory, the raw report payload for each discovered match, and per-fixture failures. This lets the first roughly 25 league matches plus current friendlies/cup matches validate discovery coverage and report consistency before persistence or all-100-club harvesting is enabled.

The helper never crawls arbitrary clubs from the fixture graph: discovery is bounded to Hamburger SV rows from the seed response. If the seed response does not expose the full current-season fixture list, the diagnostic will make the shortfall visible rather than guessing missing fixture ids.


## v0.10 season-match importer

The Hamburger SV pilot bundle can now be imported through the Soccer Manager Sync file picker. A backfill is expanded into one canonical `matchReplay` payload per fixture, so the existing staging/review flow and `match_snapshot` archive adapter can be reused rather than creating a parallel persistence path.

The JSON report normalizer keeps stable fixture/club/player ids, final score, competition/date, home/away possession/shots/shots-on-target/corners, matchday player identity and available player metadata, structured goals/cards/substitutions, tactical snapshots for both teams, and selected match metadata. Fields whose semantics are not yet established (including raw player-role and arrow arrays) are preserved neutrally inside the tactical snapshot rather than assigned speculative meanings. Raw Soccer Manager reports themselves are not staged.

Backfill exports are now version 2 and include the Soccer Manager setup id when it is available from the current page or report. Older v1 pilot exports remain importable when the Sync page supplies a numeric `sid` query parameter.

Incremental archive identity remains `setupId + fixtureId`: importing the same season bundle again produces the same match entity keys, while newly completed fixtures add new keys. The normal staging diff/review process therefore determines whether anything actually needs approval before the match archive adapter runs.

The current Hamburg pilot intentionally leaves replay-only chance/domination/world-score arrays empty when the JSON report does not expose equivalent structured data. The report's own commentary is retained inside normalized match metadata for later schema work; it is not silently reinterpreted as replay XML.


## v0.11 schedule-first batch result discovery diagnostic

The next batch-import step starts from the selected club's **Schedule** screen rather than walking opponent match-report graphs. Top 100 Sync now offers **Discover schedule results**.

Run it after opening the club Schedule page and allowing the fixture list to load. The helper is diagnostic-only: it inspects bounded same-origin Resource Timing metadata, schedule-like DOM rows, and same-origin navigation/form metadata for observed fixture identifiers. It does not guess fixture ids, fetch arbitrary endpoints, stage data, or write to Supabase.

It downloads `top100-sm-schedule-discovery-YYYY-MM-DD.json` containing:
- non-zero setup/club ids when present in the page URL;
- fixture-id candidates and whether they came from DOM, resource timing or navigation;
- bounded visible schedule-row text associated with observed fixture ids;
- the latest 120 sanitized same-origin resource URLs.

This diagnostic is intended to identify the authoritative schedule/fixture contract behind Soccer Manager's Schedule page. Once confirmed from a real capture, the batch importer can use that fixture list as its index, restrict it to completed results (and optionally league-only results), skip fixture ids already archived, and fetch each remaining report through the already-confirmed `matchreport-ajax-mobile.php?fixtureid=…&action=mr` contract.


## v0.12 observed schedule response capture

Schedule discovery on Hamburger SV observed the authenticated request `club-ajax-mobile.php?action=scheduledraw&getdata=0&gettemplate=1&clubid=…&sid=…`. Top 100 Sync therefore now offers **Capture schedule response**.

The helper prefers the exact most-recent `scheduledraw` Resource Timing URL already requested by Soccer Manager. If that resource entry is unavailable, it reconstructs only the same observed contract using the current non-zero `clubid` and `sid`. It refetches the response with the existing authenticated browser session and downloads a bounded diagnostic (maximum 2 MB) containing either parsed JSON or the returned text plus content type/parse error.

This remains diagnostic-only: it does not yet classify fixtures, fetch match reports, stage changes or persist raw schedule data. The captured response is the schema evidence required before turning `scheduledraw` into the authoritative index for the batch results importer. Once its fixture/result structure is confirmed, completed fixture ids can feed the already-confirmed match-report endpoint directly, with archive-id deduplication and optional league-only filtering.


## v0.13 live schedule-data trace

The first captured `scheduledraw&getdata=0&gettemplate=1` response proved to be the empty Schedule UI template rather than fixture data. The template invokes `MENU_clubScheduleDraw('fixtures')`, so Top 100 Sync now offers **Trace schedule data** to observe the subsequent request instead of guessing its parameters.

Arm the trace, then use Soccer Manager's Schedule/Results/Friendlies controls so the application itself issues its normal requests. Run Top 100 Sync again and choose **Download schedule trace**. The helper records only same-origin `club-ajax-mobile.php?action=scheduledraw` requests, their non-sensitive query parameters, status/content type and bounded response body (2 MB per response, 40 events maximum). Fetch responses are read from clones so Soccer Manager keeps its original response; XHR capture observes the completed response without changing it. The original fetch/XHR methods are restored before download.

This remains diagnostic-only. Its purpose is to establish the real data-request contract and schema before the batch importer relies on it.


## v0.14 schedule runtime inspection

A live schedule trace produced zero `scheduledraw` events after switching the visible Schedule controls, so the next diagnostic inspects the already-loaded Soccer Manager runtime instead of assuming another network request.

Top 100 Sync now offers **Inspect schedule runtime**. It downloads:
- the source of known schedule functions when they are exposed on `window`, including `MENU_clubScheduleDraw`;
- same-origin script URLs currently loaded by the page;
- bounded inline script blocks that mention `MENU_clubScheduleDraw` or `scheduledraw`;
- same-origin Resource Timing entries whose URLs mention schedule/club/multi/fixture/result.

The diagnostic does not fetch script source, alter Soccer Manager functions, or persist anything. It is intended to identify the exact code path/data source used by the Schedule UI so the authoritative fixture importer can be based on observed behavior rather than guessed endpoint parameters.


## v0.15 authoritative Schedule → match-report backfill

Runtime inspection established that Soccer Manager's own `MENU_clubScheduleDraw` reads the loaded club schedule through `API_getClubSchedule()` and classifies completed results with `Played == 1`. The Hamburg backfill therefore no longer crawls fixture references from opponent match reports.

**Backfill Hamburg season** now requires Hamburger SV's Schedule to be loaded. It reads the authenticated in-memory schedule, retains Hamburg rows where `Played == 1`, excludes byes, validates non-zero fixture ids, and fetches each completed fixture directly from the already-confirmed `matchreport-ajax-mobile.php?action=mr` endpoint. A 100-fixture safety cap and small sequential delay remain.

The version 3 export remains compatible with the existing `hamburgSeasonMatchBackfill` importer while adding a reconciliation block containing the authoritative schedule source, completed fixture count, compact schedule rows, failed fetches and explicit missing fixture ids. The old graph-discovery fetches and non-Hamburg bridge reports are removed.

This makes Soccer Manager's own schedule the fixture index and each match report the authoritative match payload. Import remains a separate review/staging step; this browser helper still writes nothing to Supabase.


## v0.16 full-fidelity season match capture

The authoritative Hamburger SV Schedule backfill now treats each completed match report as the canonical full-fidelity source payload. The Schedule remains the fixture index, including scheduled friendlies that Soccer Manager already places in the regular club schedule; the separate Friendly scheduler does not need to be crawled merely to rediscover those completed fixtures.

Version 4 keeps the raw match-report JSON in the downloaded review bundle, retries each report up to three times with bounded backoff, disables cache reuse, and caps each response at 2 MB. A transient request failure therefore no longer silently leaves an otherwise complete season one match short; persistent failures remain explicit in the reconciliation summary.

The importer now preserves the observed tactical timeline arrays (including formation names/ids and tactic-action arrays) and distinguishes Soccer Manager overall player ratings from match-performance ratings. The Aston Villa fixture 280690206 is the acceptance case for tactical changes: its report contains multiple tactical states rather than duplicate snapshots.

Raw reports remain download/review material only. Staging still normalizes the useful match-engine fields and does not persist the raw authenticated response wholesale.


## v0.17 bounded game-world season backfill

**Backfill game world** expands the proven completed-match capture beyond Hamburger SV without requiring a manual visit to every club. Start from any loaded Top 100 club Schedule. The helper seeds discovery from that authoritative `API_getClubSchedule()` result, fetches completed reports through the observed authenticated `matchreport-ajax-mobile.php?action=mr` contract, and recursively follows only completed non-zero fixture records exposed by those reports.

The crawl is deliberately conservative: requests are sequential with a delay, each report is capped at 2 MB and retried at most three times, cross-world reports are rejected when a setup id is present, and a 1,600-report ceiling prevents an accidental unbounded crawl. Fixture ids are deduplicated before fetching.

Reports are accumulated internally in 100-report arrays so the crawler can release its active working batch while it runs, but it does **not** trigger background downloads: mobile Chromium/Safari can block automatic downloads once the original user gesture has expired. When the crawl finishes, an explicit confirmation tap downloads one `worldSeasonMatchBackfill` import bundle containing all captured reports plus the coverage manifest fields. If the user cancels that confirmation, the captured chunks and manifest remain temporarily available as `window.__top100WorldBackfillResult` until navigation. The bundle normalizes into the same stable `setupId + fixtureId` match entities and therefore reuses the existing review and archive adapter with normal deduplication.

This is still an authenticated browser capture, not a server crawler. It never exports cookies or credentials and does not write directly to Supabase. Because cross-club discovery depends on completed fixture rows actually exposed inside Soccer Manager's match-report payloads, the manifest is the coverage authority: a run must not be described as a complete game-world season merely because the queue became empty. Coverage can later be reconciled against a separate authoritative world fixture index if one is discovered.


### World-backfill progress and recovery

The game-world crawler displays a fixed live progress panel while it runs. It reports captured/failed reports, discovered fixtures and clubs, queue depth, elapsed time, current fixture and retry attempt, and the latest completed result. **Stop & save** ends discovery after the current request attempt and offers the same single partial-bundle download used at normal completion; the manifest marks the run as user-stopped and records elapsed time and the remaining queue.

Each match-report request now has a 15-second hard timeout using `AbortController`. A timed-out request enters the existing bounded three-attempt retry/backoff path instead of leaving the entire sequential crawl waiting indefinitely.
