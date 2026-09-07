# Shared manager voting V1

This branch adds the first reusable Top 100 voting foundation on the same Supabase identity already used by Tournament Manager and the Publishing Desk.

## V1 behaviour

- Supabase Auth verifies the email address.
- `manager_portal_accounts` supplies the canonical manager identity.
- An admin opens a voting event; opening snapshots all currently active manager accounts into `voting_electorate`.
- Each snapshotted manager gets one ballot per event.
- Ballots may be edited until the server-enforced closing time.
- Ballot contents remain private to the voter/admin; aggregate results are exposed according to the event's `results_visibility` setting.
- Opening, closing and ballot submission produce audit-log entries.
- V1 supports `yes_no` and `single_choice` questions.

## Test poll

The migration seeds a draft event named **Top 100 voting system test** with one Yes/No question. It is deliberately harmless and invisible to ordinary managers until an admin opens it.

After deployment:

1. Visit `/vote` and sign in with an approved manager account.
2. An admin should see the draft test event and click **Open test vote**.
3. Opening snapshots the current active-manager electorate.
4. Managers in that electorate can submit one vote and revise it before close.
5. Admin can close the vote early and inspect aggregate results.

## Next steps after the test

- add an admin poll builder rather than seeding events in SQL;
- add quorum, majority/supermajority and tie rules for All-Manager Polls;
- link adopted governance votes to versioned Rules History;
- migrate Manager Awards from free-text manager names + Google Sheets to the same authenticated voting primitives.
