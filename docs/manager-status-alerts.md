# Gold membership and login alerts

Managers without Gold cannot complete transfers with other managers and have fewer tactical options. Soccer Manager auto-sacks a manager who does not log in to the game world for ten consecutive days. Top 100 cannot enforce either beyond end-of-season sackings, so these alerts give early warning.

## How it works

1. **Sync everything** reads the competition response and every club's `clubinitdata2` response. In the Sync tab, `src/lib/managerSignals.js` (top100-manager-lab) picks out every field whose name looks like membership (`gold`, `premium`, `vip`, `member`, `subscri…`) or last login (`lastLogin`, `lastOnline`, `inactiveDays`…), with its value and a reading: Gold yes/no, or a login time. It also lists every field name seen. Nothing else from the raw responses is kept. These readings are kept apart from `payload.managers`, because a changed manager assignment is held for manual review.
2. `record_soccer_manager_manager_signals()` stores one snapshot per club per sync (`manager_signal_snapshots`), the candidate fields (`manager_signal_fields`) and the field names (`manager_signal_inventory`).
3. **A member of the admin team confirms which field is which** on tournaments.smtop100.blog/admin/alerts. Until then nothing is read or alerted on: a field called, say, `memberSince` must not be mistaken for Gold. Confirming re-reads every stored snapshot.
4. `enqueue_manager_status_alerts()` runs every five minutes from `push-dispatch-scheduled`. Each alert fires once and is kept in `admin_alert_log`:
   - **Gold lapsed or restored:** the manager and the administrators.
   - **No login for 7 days:** the manager (a warning) and the administrators.
   - **No login for 10 days:** the administrators. Soccer Manager auto-sacks at this point.

## If no candidate fields appear

Soccer Manager may not send membership or login data on the pages Sync everything reads. The field list on the alerts page shows what it does send. The next step would be to read the manager's profile page during the sync; tell the developer which page shows Gold and last login in the game.

## Login accuracy

A login time is only as fresh as the latest sync. Daily syncs keep the 7- and 10-day alerts within a day of the truth.
