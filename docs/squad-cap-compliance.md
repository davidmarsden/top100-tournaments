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

Rule 4.1 counts loans both ways. Loaned-in players are included in Soccer Manager's squad count (Dinamo Zagreb's 56 in October 2026 included two loans). It is not yet verified that a loaned-out player stays in the parent club's squad. Check this the first time a Top 100 club loans a player out. If the parent club's squad omits the player, add active loans out to the count.

### Exclusions

Players an administrator rules out of the count are listed in `squad_cap_exclusions` and left out of both the sync counts and the replay. The first case: the six players Dinamo Zagreb signed in October 2026 while the club had no manager, frozen by transfer bans until they are sold. Add or lift one with `set_squad_cap_exclusion(club_id, player_id, reason, exclude)`. Soccer Manager's squad roster and transfers both use the world `playerId`.

## Notifications

`enqueue_squad_cap_alerts()` runs every five minutes from `push-dispatch-scheduled` and is idempotent:

- **confirmed and still open:** the club's manager (category `admin_alerts`, which managers cannot switch off) and every administrator (`admin_alerts`).
- **likely:** administrators. **possible:** listed on the compliance page only, since one squad change that is not a transfer can explain them. Either reaches the manager once an administrator upholds it.
- An administrator alert says when the manager has no active Manager Portal account, so they can be contacted directly.

Administrators decide with `review_squad_cap_breach(id, 'upheld' | 'dismissed' | 'open', note)`. An administrator's decision is never overwritten by later syncs. `squad_cap_overview()` lists every club's latest squad size.

## Sanctions

Detection is not a sanction. Rule 4.1 records the S28 precedent (Olympique Lyonnais, 19 October 2026). The club received a one-month transfer ban, with cash sales to clubs outside Top 100 still allowed. The signing that took it over 50 must also be sold to a club outside Top 100 when that player's own transfer ban ends, and the club may not bid for them again. Rule 7 still lets administrators weigh intent, impact and how promptly a breach was corrected.

Soccer Manager's own squad-limit setting is not a safeguard: it effectively caps squads at 49 and does not stop a club going over 50.
