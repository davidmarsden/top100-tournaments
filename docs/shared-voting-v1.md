# Shared manager voting V1

> Historical foundation. Shared Voting V2 extends this implementation for Awards and wider ecosystem use. See [`shared-voting-v2.md`](./shared-voting-v2.md).

This branch added the first reusable Top 100 voting foundation on the same Supabase identity already used by Tournament Manager and the Publishing Desk.

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

## What happened next

The All-Manager Poll layer added an admin poll builder plus quorum, majority/supermajority and tie rules. Shared Voting V2 then adds Awards-ready nominee metadata, manual result release, a ballot-read RPC, audited electorate corrections, multi-question event import and a released-results archive bridge.

Manager Awards is the next production consumer of the shared authenticated voting primitives.
