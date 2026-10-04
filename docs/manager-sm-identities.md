# Manager identity: Soccer Manager IDs

Manager Portal and the Top 100 roster should treat names as display/search data, not identity.

## Identity model

- `managers.id` is the canonical Top 100 human identity.
- `soccer_manager_archive_links` maps stable Soccer Manager manager/customer IDs to that human.
- `soccer_manager_world_manager_assignments` records the human's current team in each game world, with `source_manager_key` as the stable SM manager ID.
- `teams.id` is the canonical club identity.
- Soccer Manager club source IDs map to `teams.id` through `soccer_manager_archive_links`.
- `manager_game_world_memberships` says whether the human participates in a world; it must not be used to infer which club they manage.

A manager can therefore have multiple simultaneous world assignments. For example, the same canonical person may manage Borussia Mönchengladbach in Regen and Schalke 04 in Top 100. A Borussia Mönchengladbach club in Top 100 is unrelated unless its world + source club ID says otherwise.

## Adding a new manager

1. Sync the relevant Soccer Manager world and approve/apply the core archive so the stable manager ID, club ID and current assignment exist.
2. In Manager Accounts, identify the person by their stable SM manager ID. If that SM ID already maps to a canonical `managers.id`, reuse it even if the display name or club differs between worlds.
3. If the SM ID is genuinely new, create one canonical manager record, then link the synced assignment to it. Do not create one manager record per game world.
4. Add/activate the relevant `manager_game_world_memberships` row.
5. Link the Manager Portal account to the canonical human. Other synced world assignments for the same SM manager ID can then be displayed under the same person.

## Matching priority

1. Exact stable SM manager ID.
2. Existing explicit archive link.
3. Manual admin selection for unresolved historical records.
4. Name + club fuzzy matching only as a legacy fallback where no source IDs have yet been captured.

Never choose between same-named clubs using the club name alone. The authoritative assignment is `(game_world_id, SM manager ID, SM club ID)`.

## Admin UI

The Manager Accounts screen should present one person with world-specific assignment rows underneath, including game world, canonical club, SM manager ID and SM club ID. This makes cross-world cases explicit and removes the current ambiguity of labels such as `Tom Lee · Borussia Mönchengladbach`.
