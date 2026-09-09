# Shared manager voting V2

Shared Voting V2 turns the existing authenticated voting foundation into an ecosystem service that can support Manager Awards as well as All-Manager Polls.

## What V2 adds

### Awards-ready nominee data

`voting_options` now supports:

- nullable `manager_id` for a canonical nominee;
- `metadata jsonb` for presentation fields such as club, division, achievement, description and other Awards-specific copy.

This lets the Awards app keep its rich nominee cards without hard-coding the live ballot in React.

### Manual result release

`results_visibility` now also supports `manual_release`.

Closing/finalising a vote and publishing its results are deliberately separate actions. `release_voting_results(event_id)` records the release time and administrator in the audit log.

Both `get_voting_results()` and the `voting_event_results` RLS policy honour manual release, so ordinary managers cannot inspect results before the administrator releases them.

### Ballot read RPC

`get_my_voting_ballot(event_id)` returns the authenticated manager's:

- eligibility;
- event state and deadline;
- saved ballot ID;
- saved selections;
- submitted/updated timestamps.

Clients no longer need to understand the ballot/response table layout simply to restore a manager's form state.

### Multi-question event import

`create_voting_event_from_json(...)` creates a draft multi-question event transactionally from JSON.

It is intended initially for an Awards configuration/import screen, where one event contains all Awards categories and each category contains nominee options.

Example question payload:

```json
[
  {
    "title": "Division 1 Manager of the Season",
    "description": "Season 28 nominees",
    "options": [
      {
        "label": "Example Manager",
        "manager_id": 123,
        "metadata": {
          "club": "Example FC",
          "achievement": "Division 1 Champions",
          "description": "Nomination note"
        }
      }
    ]
  }
]
```

### Audited electorate correction

`add_voting_electorate_member(event_id, manager_id, reason)` provides the explicit edge-case path identified in the migration audit.

It is **not** a substitute for onboarding. Before a live Awards event opens, admins must reconcile the expected voter roster against claimed/active `manager_portal_accounts` and run an account-claim campaign for unexplained gaps.

If a genuine eligibility correction is still required, the RPC records who made it and why.

### Awards history/archive bridge

`get_released_voting_archive(event_id)` returns only released aggregate results plus nominee metadata. It never exports individual ballot choices.

The Awards app can use this payload after a season to populate its existing historical shape while Hall of Fame/cabinets/archive readers remain on the legacy backend.

`mark_voting_archive_exported(event_id, note)` records completion of that compatibility export in the audit log.

The intended lifecycle is:

1. close the Supabase-backed Awards event;
2. finalise/count it;
3. release the results;
4. export released winners/results into the existing Awards historical format;
5. verify Hall of Fame, cabinets, records and archive views;
6. mark the archive export complete;
7. retire the bridge only when those historical readers themselves move to Supabase.

## Existing All-Manager Poll UI

The current poll builder now exposes **Hidden until an admin releases them** as a result mode. The underlying `create_manager_poll` RPC has been updated to accept it.

The general `/vote` portal remains the proving ground for the shared engine. Awards will be a specialist presentation over the same schema/RPCs rather than a second voting backend.

## Production cutover gate for Awards

Do not remove typed-name voting merely because the Supabase adapter works technically.

Before opening the first production Awards event:

1. build the expected eligible-manager roster;
2. compare it with active `manager_portal_accounts`;
3. contact managers with missing/unclaimed accounts;
4. resolve duplicates/stale identities;
5. require zero unexplained missing eligible voters;
6. record any exceptional electorate corrections with an audit reason;
7. run an Awards-shaped test event with authenticated managers;
8. verify manual result hiding/release;
9. verify the post-season archive bridge end-to-end.

## Security properties retained

V2 preserves the V1 guarantees:

- Supabase Auth is required;
- active canonical manager identity is resolved server-side;
- electorate is snapshotted when voting opens;
- `(event_id, manager_id)` remains unique;
- edits are allowed only while the event is open and before the server deadline;
- response option/question relationships are validated server-side;
- private ballot rows remain visible only to their voter/admin;
- public/manager-facing result access is controlled server-side, not by hidden buttons;
- administrative corrections, releases and archive exports are audited.

## Next consumer

After this migration is deployed and smoke-tested, the next PR belongs in `davidmarsden/top100-mots`:

**Awards shared voting adapter**

It should add Supabase Auth and event loading behind an explicit test configuration, preserve the existing Awards visual presentation/history, and leave the Google-backed live functions in place until the authenticated path has been exercised successfully.
