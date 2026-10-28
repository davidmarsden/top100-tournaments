# Squad cap compliance

Top 100 rule 4.1 limits a club to 50 players, with loans counting both ways. Migrations `20261028123058_squad_cap_compliance.sql` and `20261028170855_squad_cap_sync_and_reports.sql` check this from Soccer Manager Sync data and tells the people who need to know.

## Evidence

A breach is one of two things:

| Source | Meaning |
|---|---|
| **A sync** | A reviewed squad capture (`squad_scope.playerCount`) counted more than 50 players. Consecutive over-limit captures are one breach, which resolves itself once a later capture is back to 50 or fewer. The transfer list dates when it first went over. |
| **A report** | `report_squad_cap_breach(club, players, date, note)`. From an admin (the alerts page) it counts as confirmed, and the club's manager is told at once. From a manager (Manager Portal, Squad & Transfers) it goes to the admin team, and the club's manager is told only if they uphold it. |

Until 28 October 2026 the transfer list was also replayed between syncs to estimate "likely" and "possible" breaches. Those estimates were mostly youth intake and other squad changes that are not transfers, so they raised too many false alarms (Lyon's real breach on 19 October was among 27 of them). The replay no longer raises breaches; its old rows stay in the table but are not listed or alerted on. Daily syncs (the "Top 100 sync due" reminder) and reports cover what happens between them.

### Loans

Rule 4.1 counts loans both ways. Loaned-in players are included in Soccer Manager's squad count (Dinamo Zagreb's 56 in October 2026 included two loans). It is not yet verified that a loaned-out player stays in the parent club's squad. Check this the first time a Top 100 club loans a player out. If the parent club's squad omits the player, add active loans out to the count.

### Exclusions

Players an administrator rules out of the count are listed in `squad_cap_exclusions` and left out of both the sync counts and the replay. The first case: the six players Dinamo Zagreb signed in October 2026 while the club had no manager, frozen by transfer bans until they are sold. Add or lift one with `set_squad_cap_exclusion(club_id, player_id, reason, exclude)`. Soccer Manager's squad roster and transfers both use the world `playerId`.

## Notifications

`enqueue_squad_cap_alerts()` runs every five minutes from `push-dispatch-scheduled` and is idempotent:

- **Counted on a sync, or reported by an admin:** the club's manager (category `admin_alerts`, which managers cannot switch off) and the admin team.
- **Reported by a manager:** the admin team, who uphold or dismiss it on the alerts page. Upholding it notifies the club's manager.
- **Began before the current manager was appointed:** the admin team only.
- An admin alert says when the manager has no active Manager Portal account, so they can be contacted directly.

Administrators decide with `review_squad_cap_breach(id, 'upheld' | 'dismissed' | 'open', note)`. An administrator's decision is never overwritten by later syncs. `squad_cap_overview()` lists every club's latest squad size.

## Sanctions

Detection is not a sanction. Rule 4.1 records the S28 precedent (Olympique Lyonnais, 19 October 2026). The club received a one-month transfer ban, with cash sales to clubs outside Top 100 still allowed. The signing that took it over 50 must also be sold to a club outside Top 100 when that player's own transfer ban ends, and the club may not bid for them again. Rule 7 still lets administrators weigh intent, impact and how promptly a breach was corrected.

Soccer Manager's own squad-limit setting is not a safeguard: it effectively caps squads at 49 and does not stop a club going over 50.

## Follow-up on rulings

A ruling is recorded once, then checked against every sync (`enqueue_compliance_events()`, every five minutes, administrators only):

| Recorded | Checked | Alert |
|---|---|---|
| a confirmed breach | the next sync at 50 or fewer | **Back within the squad limit** |
| a transfer ban (`club_transfer_bans`: dates, terms) | every deal the club makes during it; with "cash sales to clubs outside Top 100 only", any signing, any sale to a Top 100 manager and any free or loan deal | **Deal during a transfer ban** |
| a required sale (`compliance_obligations`) | the club's first sale of the player afterwards: to a club outside Top 100 for cash, or any sale when the ruling just says "sell" | **Required sale made**, or **made the wrong way** |
| "no re-bid" on a required sale | the club signing the player again | **Banned player signed again** |

Recorded so far: Olympique Lyonnais' ban (20 Oct to 20 Nov 2026, cash sales to clubs outside Top 100 only) and the required cash sale of Idder to a club outside Top 100, with no re-bid; and Dinamo Zagreb's six manager-less signings, to be sold once their bans end. New ones are added on the alerts page (`set_club_transfer_ban`, `add_compliance_obligation`).

A deal is matched to a ban by the day Soccer Manager records it, and only completed or accepted deals count.
