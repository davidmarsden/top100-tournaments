# Squad cap compliance

Top 100 rule 4.1 limits a club to 50 players, with loans counting both ways. Migration `20261028120000_squad_cap_compliance.sql` checks this from Soccer Manager Sync data and tells the people who need to know.

## Evidence

| Confidence | Source | Meaning |
|---|---|---|
| **confirmed** | A reviewed squad capture (`squad_scope.playerCount`) over 50 | The club was over the limit when synced. Consecutive over-limit captures are one breach; it resolves itself once a later capture is back to 50 or fewer. |
| **likely** | Transfer replay between two compliant captures | Every reading of the transfers puts the club over 50 on at least one day. |
| **possible** | Same replay, worst case only | Over 50 only if the day's signings landed before its sales, or if the non-transfer changes happened early. |

### Why the replay is needed

Syncs are snapshots. Lyon went from 49 to 51 and back to 50 on 19 October 2026 (turn 34: Guimarães and Idder in, Skóraś out), between the 27 September and 22 October captures. Neither capture showed a breach.

`refresh_squad_cap_breaches()` replays each interval between two captures of a club, day by day, from `soccer_manager_transfers`:

- Transfers carry a day but no time, so a day's signings are assumed to land before its sales (`peak_high`).
- Squad changes that are not transfers, such as youth intake, releases and retirements, appear as drift between the two captures (`evidence.non_transfer_change`). They could have happened on any day. The replay therefore runs backward from the later capture and forward from the earlier one, and keeps both readings (`peak_low` to `peak_high`).

Daily syncs keep the intervals short and make between-sync results sharper. The "Top 100 sync due" reminder already prompts one a day.

### Loans

Rule 4.1 counts loans both ways. No loans had been seen in Top 100 sync data when this was built (`soccer_manager_players.loaned` is false throughout), so it is not yet verified that Soccer Manager lists a loaned-out player in the parent club's squad. Check this the first time a loan happens. If the parent club's squad omits the player, add active loans out to the count.

## Notifications

`enqueue_squad_cap_alerts()` runs every five minutes from `push-dispatch-scheduled` and is idempotent:

- **confirmed and still open:** the club's manager (category `compliance`, always pushed) and every administrator (`admin_alerts`).
- **likely / possible:** administrators only. The manager is notified once an administrator upholds it.
- An administrator alert says when the manager has no active Manager Portal account, so they can be contacted directly.

Administrators decide with `review_squad_cap_breach(id, 'upheld' | 'dismissed' | 'open', note)`. An administrator's decision is never overwritten by later syncs. `squad_cap_overview()` lists every club's latest squad size.

## Sanctions

Detection is not a sanction. Rule 7 leaves the sanction to the administrators, weighing intent, impact, previous breaches and how promptly an honest mistake was corrected. The August 2025 rulebook set a one-month transfer ban for a first squad-cap offence. A breach corrected within the same turn, like Lyon's, fits a warning better than a ban.
