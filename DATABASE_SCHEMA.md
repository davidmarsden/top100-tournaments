# Top 100 Tournament Database Schema

Version: 1.0  
Database: Supabase PostgreSQL  
Project: Top 100 Tournament Manager

> This document is the single source of truth for database development. Every SQL migration, React component and data import must match this schema. Do not assume table names, column names, ID types or relationships.

## Global rules

- All primary keys are `int8` / `bigint` identity columns, not UUIDs.
- Do not create UUID foreign keys unless the whole schema is deliberately migrated.
- Core tournament IDs, entry IDs, team IDs and manager IDs are all `int8`.
- Group seeding should use `tournament_entries.rating`, highest first.
- Knockout seeding should be based on group finishing position and group-table ranking.
- Round dates are stored in `tournament_round_dates`.
- R32 is one leg unless a specific competition format says otherwise.
- Youth Cup Shield R16 is one leg; Shield QF onwards is two legs.
- Aggregate text should only appear once a two-legged tie has both leg scores, and should appear under the 2nd leg result only.
- Away goals are checked after aggregate score and before Fictional Extra Time.

---

## Key principles

- A tournament belongs to one season and one competition.
- `tournament_formats` stores reusable format templates.
- `tournament_stages` and `tournament_rounds` store the actual structure inside a tournament.
- `tournament_round_dates` stores preset dates for each bracket and round.
- `tournament_entries` links one team and one manager to a tournament.
- `groups` stores group identities within a tournament.
- `matches` stores group fixtures, knockout fixtures/ties, scores, placeholders, seeds, aggregates, extra time, penalties, forfeits and publication status.
- `manager_clubs` stores career history outside a specific tournament.
- `honours` and `achievements` record trophies, finishing positions and special awards.
- `attachments` can reference any entity by `entity_type` and `entity_id`.
- `audit_log` records administrative changes.
- `settings` stores configurable rules.

---

## Table `seasons`

Purpose: Stores Top 100 seasons, such as S27 or S28.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `code` | `text` | Unique |
| `number` | `int4` | Nullable |
| `start_date` | `date` | Nullable |
| `end_date` | `date` | Nullable |

## Table `competitions`

Purpose: Stores competition families, such as Youth Cup, World Club Cup or Shield.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `name` | `text` | Unique |
| `competition_type` | `text` | Nullable |
| `description` | `text` | Nullable |

## Table `tournaments`

Purpose: Stores a specific tournament edition, such as S28 Youth Cup.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `season_id` | `int8` | FK → `seasons.id`, nullable |
| `competition_id` | `int8` | FK → `competitions.id`, nullable |
| `name` | `text` |  |
| `status` | `text` | Nullable |
| `format` | `text` | Nullable |
| `source` | `text` | Nullable |
| `source_id` | `text` | Nullable |
| `created_at` | `timestamptz` | Nullable |
| `format_id` | `int8` | FK → `tournament_formats.id`, nullable |
| `max_entries` | `int4` | Nullable |
| `actual_entries` | `int4` | Nullable |
| `group_count` | `int4` | Nullable |
| `teams_per_group` | `int4` | Nullable |
| `knockout_teams` | `int4` | Nullable |
| `secondary_bracket_name` | `text` | Nullable |
| `rules_notes` | `text` | Nullable |

## Table `teams`

Purpose: Stores clubs/teams used across tournaments.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `name` | `text` | Unique |
| `short_name` | `text` | Nullable |
| `country` | `text` | Nullable |
| `active` | `bool` | Nullable |

## Table `managers`

Purpose: Stores managers in the Top 100 world.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `name` | `text` |  |
| `canonical_name` | `text` | Nullable |
| `active` | `bool` | Nullable |
| `display_name` | `text` | Nullable |
| `discord_name` | `text` | Nullable |
| `joined_season_id` | `int8` | FK → `seasons.id`, nullable |
| `retired_season_id` | `int8` | FK → `seasons.id`, nullable |

## Table `tournament_entries`

Purpose: Links a team and manager to one tournament. This is the tournament-specific participant record.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `tournament_id` | `int8` | FK → `tournaments.id`, nullable |
| `team_id` | `int8` | FK → `teams.id`, nullable |
| `manager_id` | `int8` | FK → `managers.id`, nullable |
| `seed` | `int4` | Nullable |
| `rating` | `int4` | Nullable |
| `group_code` | `text` | Nullable |
| `entry_status` | `text` | Nullable |
| `prize_draw_eligible` | `bool` | Nullable |
| `notes` | `text` | Nullable |
| `pot` | `int4` | Nullable |
| `qualifying_position` | `int4` | Nullable |
| `final_position` | `int4` | Nullable |
| `eliminated_in` | `text` | Nullable |
| `qualified_for_secondary` | `bool` | Nullable |
| `withdrawn` | `bool` | Nullable |
| `disqualified` | `bool` | Nullable |

## Table `groups`

Purpose: Stores groups inside a tournament.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `tournament_id` | `int8` | FK → `tournaments.id`, nullable |
| `code` | `text` |  |
| `name` | `text` | Nullable |
| `group_order` | `int4` | Nullable |

## Table `matches`

Purpose: Stores every group or knockout fixture. Current implementation stores one row per fixture/leg. It also contains fields for tie metadata, aggregate scores, extra time, penalties, walkovers, forfeits and publication state.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `tournament_id` | `int8` | FK → `tournaments.id`, nullable |
| `group_id` | `int8` | FK → `groups.id`, nullable |
| `stage` | `text` | Required |
| `round` | `text` | Required |
| `leg` | `int4` | Nullable, default `1` |
| `match_order` | `int4` | Nullable |
| `scheduled_at` | `timestamptz` | Nullable |
| `home_entry_id` | `int8` | FK → `tournament_entries.id`, nullable |
| `away_entry_id` | `int8` | FK → `tournament_entries.id`, nullable |
| `home_score` | `int4` | Nullable |
| `away_score` | `int4` | Nullable |
| `winner_entry_id` | `int8` | FK → `tournament_entries.id`, nullable |
| `status` | `text` | Nullable, default `'scheduled'` |
| `source_id` | `text` | Nullable |
| `notes` | `text` | Nullable |
| `match_code` | `text` | Nullable |
| `bracket` | `text` | Nullable |
| `home_extra_time_score` | `int4` | Nullable |
| `away_extra_time_score` | `int4` | Nullable |
| `home_penalty_score` | `int4` | Nullable |
| `away_penalty_score` | `int4` | Nullable |
| `decided_by` | `text` | Nullable |
| `played_at` | `timestamptz` | Nullable |
| `challonge_match_id` | `text` | Nullable |
| `stage_id` | `int8` | FK → `tournament_stages.id`, nullable |
| `round_id` | `int8` | FK → `tournament_rounds.id`, nullable |
| `aggregate_home_score` | `int4` | Nullable |
| `aggregate_away_score` | `int4` | Nullable |
| `home_seed` | `int4` | Nullable |
| `away_seed` | `int4` | Nullable |
| `home_placeholder` | `text` | Nullable |
| `away_placeholder` | `text` | Nullable |
| `loser_entry_id` | `int8` | FK → `tournament_entries.id`, nullable |
| `locked` | `bool` | Nullable |
| `published` | `bool` | Nullable |
| `walkover` | `bool` | Nullable |
| `forfeit` | `bool` | Nullable |
| `fixture_date` | `date` | Nullable |

## Table `forfeits`

Purpose: Stores forfeit records and related penalty metadata.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `match_id` | `int8` | FK → `matches.id`, nullable |
| `forfeiting_entry_id` | `int8` | FK → `tournament_entries.id`, nullable |
| `reason` | `text` | Nullable |
| `penalty` | `text` | Nullable |
| `affects_prize_draw` | `bool` | Nullable, default `true` |
| `created_at` | `timestamptz` | Nullable |

## Table `honours`

Purpose: Records tournament honours, such as Winner, Runner-up or Shield Winner.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `tournament_id` | `int8` | FK → `tournaments.id`, nullable |
| `entry_id` | `int8` | FK → `tournament_entries.id`, nullable |
| `honour` | `text` | Required |
| `position` | `int4` | Nullable |

## Table `tournament_formats`

Purpose: Stores reusable tournament templates.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `name` | `text` | Required |
| `description` | `text` | Nullable |
| `has_group_stage` | `bool` | Nullable |
| `has_knockout_stage` | `bool` | Nullable |
| `has_secondary_bracket` | `bool` | Nullable |
| `group_size` | `int4` | Nullable |
| `legs_group_stage` | `int4` | Nullable |
| `legs_knockout_stage` | `int4` | Nullable |
| `notes` | `text` | Nullable |

## Table `manager_clubs`

Purpose: Stores manager career history by club and season.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `manager_id` | `int8` | FK → `managers.id`, nullable |
| `team_id` | `int8` | FK → `teams.id`, nullable |
| `from_season_id` | `int8` | FK → `seasons.id`, nullable |
| `to_season_id` | `int8` | FK → `seasons.id`, nullable |
| `current_club` | `bool` | Nullable, default `false` |
| `appointment_type` | `text` | Nullable |
| `notes` | `text` | Nullable |

## Table `tournament_stages`

Purpose: Stores the actual stage structure for a tournament.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `tournament_id` | `int8` | FK → `tournaments.id`, nullable |
| `name` | `text` | Required |
| `stage_type` | `text` | Required |
| `stage_order` | `int4` | Required |
| `bracket_name` | `text` | Nullable |
| `entrants_from` | `text` | Nullable |
| `notes` | `text` | Nullable |

## Table `tournament_rounds`

Purpose: Stores the actual round structure for a tournament.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `tournament_id` | `int8` | FK → `tournaments.id`, nullable |
| `stage_id` | `int8` | FK → `tournament_stages.id`, nullable |
| `name` | `text` | Required |
| `round_order` | `int4` | Required |
| `round_type` | `text` | Required |
| `legs` | `int4` | Nullable |
| `scheduled_at` | `timestamptz` | Nullable |
| `notes` | `text` | Nullable |

## Table `team_aliases`

Purpose: Stores alternate names for teams, especially from Challonge or manual imports.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `team_id` | `int8` | FK → `teams.id`, nullable |
| `alias` | `text` | Required |
| `source` | `text` | Nullable |

## Table `attachments`

Purpose: Stores links or media attached to any entity.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `entity_type` | `text` | Required |
| `entity_id` | `int8` | Required |
| `url` | `text` | Required |
| `title` | `text` | Nullable |
| `caption` | `text` | Nullable |
| `source` | `text` | Nullable |
| `created_at` | `timestamptz` | Nullable, default `now()` |

## Table `audit_log`

Purpose: Records administrative changes.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `entity_type` | `text` | Required |
| `entity_id` | `int8` | Nullable |
| `action` | `text` | Required |
| `old_data` | `jsonb` | Nullable |
| `new_data` | `jsonb` | Nullable |
| `changed_by` | `text` | Nullable |
| `created_at` | `timestamptz` | Nullable, default `now()` |

## Table `settings`

Purpose: Stores configurable settings by global, competition or tournament scope.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `scope` | `text` | Required |
| `scope_id` | `int8` | Nullable |
| `key` | `text` | Required |
| `value` | `jsonb` | Nullable |
| `notes` | `text` | Nullable |

## Table `achievements`

Purpose: Records trophies, stats awards, special recognitions and tournament achievements.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `tournament_id` | `int8` | FK → `tournaments.id`, nullable |
| `entry_id` | `int8` | FK → `tournament_entries.id`, nullable |
| `team_id` | `int8` | FK → `teams.id`, nullable |
| `manager_id` | `int8` | FK → `managers.id`, nullable |
| `achievement_type` | `text` | Required |
| `title` | `text` | Required |
| `position` | `int4` | Nullable |
| `notes` | `text` | Nullable |
| `created_at` | `timestamptz` | Nullable, default `now()` |

## Table `tournament_round_dates`

Purpose: Stores bracket/round schedule presets. These can be set before fixtures are known, then applied as rounds are generated.

| Name | Type | Constraints |
|---|---|---|
| `id` | `int8` | Primary Identity |
| `tournament_id` | `int8` | FK → `tournaments.id`, required |
| `bracket` | `text` | Required |
| `round` | `text` | Required |
| `leg1_date` | `date` | Required |
| `leg2_date` | `date` | Nullable |
| `created_at` | `timestamptz` | Nullable |
| `updated_at` | `timestamptz` | Nullable |

---

## Foreign key summary

| Table | Column | References |
|---|---|---|
| `achievements` | `entry_id` | `tournament_entries.id` |
| `achievements` | `manager_id` | `managers.id` |
| `achievements` | `team_id` | `teams.id` |
| `achievements` | `tournament_id` | `tournaments.id` |
| `forfeits` | `forfeiting_entry_id` | `tournament_entries.id` |
| `forfeits` | `match_id` | `matches.id` |
| `groups` | `tournament_id` | `tournaments.id` |
| `honours` | `entry_id` | `tournament_entries.id` |
| `honours` | `tournament_id` | `tournaments.id` |
| `manager_clubs` | `from_season_id` | `seasons.id` |
| `manager_clubs` | `manager_id` | `managers.id` |
| `manager_clubs` | `team_id` | `teams.id` |
| `manager_clubs` | `to_season_id` | `seasons.id` |
| `managers` | `joined_season_id` | `seasons.id` |
| `managers` | `retired_season_id` | `seasons.id` |
| `matches` | `away_entry_id` | `tournament_entries.id` |
| `matches` | `group_id` | `groups.id` |
| `matches` | `home_entry_id` | `tournament_entries.id` |
| `matches` | `loser_entry_id` | `tournament_entries.id` |
| `matches` | `round_id` | `tournament_rounds.id` |
| `matches` | `stage_id` | `tournament_stages.id` |
| `matches` | `tournament_id` | `tournaments.id` |
| `matches` | `winner_entry_id` | `tournament_entries.id` |
| `team_aliases` | `team_id` | `teams.id` |
| `tournament_entries` | `manager_id` | `managers.id` |
| `tournament_entries` | `team_id` | `teams.id` |
| `tournament_entries` | `tournament_id` | `tournaments.id` |
| `tournament_round_dates` | `tournament_id` | `tournaments.id` |
| `tournament_rounds` | `stage_id` | `tournament_stages.id` |
| `tournament_rounds` | `tournament_id` | `tournaments.id` |
| `tournament_stages` | `tournament_id` | `tournaments.id` |
| `tournaments` | `competition_id` | `competitions.id` |
| `tournaments` | `format_id` | `tournament_formats.id` |
| `tournaments` | `season_id` | `seasons.id` |

---

## Standard tournament flow

1. Create or select season.
2. Create or select competition.
3. Create tournament.
4. Choose format.
5. Create tournament stages.
6. Create tournament rounds and round dates.
7. Import entrants with manager, team and average rating.
8. Seed groups by `tournament_entries.rating`.
9. Generate group fixtures.
10. Enter group results.
11. Calculate group tables.
12. Generate knockout qualifiers from group finishing position.
13. Generate knockout fixtures.
14. Resolve aggregate, away goals, Fictional Extra Time, penalties, forfeits and walkovers.
15. Record honours and achievements.
16. Publish and archive.

---

## Seeding rules

### Group seeding

1. Sort entrants by `rating` descending.
2. Assign `seed` from 1 onwards.
3. Allocate entrants to pots by group count.
4. Use snake allocation across groups:
   - Pot 1: A, B, C, D...
   - Pot 2: reverse order.
   - Repeat until all entrants are allocated.

This supports variable entrant counts and variable group sizes, provided `group_count` and `teams_per_group` are set correctly.

### Knockout seeding

1. Rank all group winners by group table performance.
2. Rank all second-placed qualifiers after group winners.
3. Continue with third-placed qualifiers where the format requires them.
4. Pair highest seed vs lowest seed:
   - 1 vs 32
   - 2 vs 31
   - 3 vs 30
   - etc.

For a 64-team Youth Cup with 16 groups and 32 Cup qualifiers: best 1st placed team should be home to the 16th-best 2nd placed team.

---

## Tie resolution

For two-legged ties:

1. Aggregate score.
2. Away goals.
3. Fictional Extra Time if still level.
4. Penalties if required by the competition.
5. Manual admin decision if required.

For one-leg ties:

1. Match score.
2. Fictional Extra Time if drawn.
3. Penalties or manual decision if required.

---

## Round schedule rules

- Dates are stored in `tournament_round_dates`.
- R32 is one leg and should not require a 2nd-leg date.
- Two-legged rounds should default the 2nd-leg date to exactly 7 days after the 1st-leg date.
- 2nd-leg dates must remain editable.
- Fixture display should show dates beside the round header, not repeated on every fixture card.

Example:

| Bracket | Round | 1st leg | 2nd leg |
|---|---|---|---|
| Cup | R32 | 5 September 2026 |  |
| Cup | R16 | 12 September 2026 | 19 September 2026 |
| Cup | QF | 26 September 2026 | 3 October 2026 |
| Shield | R32 | 5 September 2026 |  |
| Shield | R16 | 12 September 2026 |  |
| Shield | QF | 26 September 2026 | 3 October 2026 |

---

## Common status values

These are current app-level conventions rather than strict database enums.

### Tournament status

- `draft`
- `published`
- `completed`
- `archived`

### Match status

- `scheduled`
- `played`
- `forfeit`
- `void`

### Match stage

- `group`
- `knockout`

### Bracket

- `Cup`
- `Shield`

---

## Development rules

- Never assume IDs are UUIDs.
- Never hard-code a group count without reading tournament settings.
- Never hard-code a group size without reading tournament settings.
- Never hard-code round dates.
- Never repeat date text on every fixture card when it belongs to a round.
- Never show aggregate text under both legs.
- Always treat `tournament_entries.rating` as the current seeding source.
- Always ensure R32 is treated as one leg unless a future format explicitly says otherwise.
- Always make generated dates editable.
- Always preserve existing results unless the user explicitly asks to reset or regenerate.
