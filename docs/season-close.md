# Season close: archive and prize draw

Admin → **Season close & publishing → Season Close** (organisers and platform admins).

## 1. Archive

`tournament_archive_checks(id)` lists what blocks archiving:

- fixtures without a result (voided fixtures count as resolved);
- manager-submitted results still under review;
- knockout ties whose deciding leg has no winner (double forfeits and byes excepted);
- a bracket whose Final has no winner.

Warnings (not blocking): forfeit results without a discipline record, and forfeit records without a responsible manager.

**Archive tournament** calls `archive_tournament(id)`, which:

1. replaces the tournament's honours with `Youth Cup Winner`, `Youth Cup Runner-up`, `Youth Shield Winner`, `Youth Shield Runner-up` (the `Youth ` prefix is used when the tournament name contains "Youth");
2. saves a full JSON copy (tournament, groups, entries with names, matches, forfeits, round dates, honours) in `tournament_archive_snapshots` (downloadable from the page);
3. sets `status = 'archived'`, `archive_quality = 'complete'`, `is_public = true`.

It can be run again; honours are replaced and another snapshot is added. A platform admin can force-archive past blocking issues.

The archive site's `youth-winners` function merges archived honours (`public_tournament_honours()`) for seasons the winners sheet does not have yet; the sheet wins once it has the season.

When no tournament for a competition is live, `/top-100/youth-cup` shows the most recent archived season.

## 2. Prize draw

The pool (`prize_draw_pool(id)`) is every manager currently running an entrant with no forfeit that affects the prize draw. An organiser can also untick someone (logged as "Removed by organiser"), or add names by hand for any other draw.

**Draw** calls `run_prize_draw(...)`. The server generates a 32-byte random seed and ranks each entry by `sha256(seed + ':' + key)`, lowest first; the first N are the winners. Keys are `manager:<id>` or `name:<lower-case name>`.

Every draw is saved in `prize_draws`, including re-draws. **Publish** shows one draw per title on the public tournament page; **Void** (with a reason) retracts it. Anyone can press **Verify** on the public page: the browser re-hashes every entry from the published seed and confirms it gets the same winners in the same order.
