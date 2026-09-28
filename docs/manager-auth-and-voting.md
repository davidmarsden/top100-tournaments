# Manager identity, onboarding and voting

_Last updated: 28 September 2026_

This document records the architecture established after the September 2026 Manager Portal / Community Polls incident, including the failure modes we discovered and the rules future changes should preserve.

## The model in one sentence

**Authenticate the person, link them to one canonical manager identity, then let applications consume that identity.**

Authentication, manager identity and voting eligibility are related, but they are not the same thing.

## Canonical flow

For ordinary managers, `manager.smtop100.blog` is the canonical sign-in and onboarding surface.

```
email
  ↓
Supabase authentication
  ↓
active manager_portal_account?
  ├─ yes → linked manager → Manager Portal / requested destination
  └─ no
       ↓
     existing claim?
       ├─ pending → show approval status
       └─ none → link-manager setup
                    ↓
                  admin approval
                    ↓
             manager_portal_account
```

The bootstrap for an unlinked user must stay small. It must not load tournament registrations, fixtures, groups, historical entries or other Manager Portal application data merely to decide whether the user needs setup.

### Session bootstrap

The rebuilt entry path treats Supabase auth state as the authority. Do not reintroduce layers of:

- legacy token restoration;
- competing `getSession()` bootstraps;
- reload-based recovery;
- tournament-host session migration;
- overlapping portal loaders.

Cross-origin applications may need an explicit, bounded session handoff because browser storage is origin-specific. That handoff is transport, not a second authentication system.

## Identity and account linking

A successful email sign-in proves an authenticated user. It does **not** by itself prove which Soccer Manager manager that person represents.

The canonical relationship is:

`auth user → manager_portal_account → canonical manager → game-world membership`

New users choose their game world, current club and Soccer Manager name. An administrator approves the claim and links it to the canonical manager record.

### Admin UX rule

Internal database IDs are supporting information, not required administrator knowledge.

Claim approval should:

1. automatically suggest a canonical manager where confidence is good;
2. use the current game-world club/manager directory as well as tournament history;
3. provide a human-searchable manager picker when automatic matching is ambiguous;
4. scope selectable managers to active membership in the claim's game world;
5. never silently fall back to a previously suggested manager after the admin edits/clears a selection.

The Paolo Everland / Santos FC case exposed an important blind spot: a real current manager can have no tournament-entry history. Tournament history is therefore evidence, not the manager directory.

## Voting eligibility

This distinction is critical:

> **Website-account adoption must never define the electorate.**

For Top 100 governance polls, the electorate is the set of **active Top 100 manager memberships at the point the poll opens**.

When a poll opens, `open_voting_event` snapshots active `manager_game_world_memberships` into `voting_electorate`.

A manager does **not** need to have activated a website account before that snapshot. `voting_electorate.manager_account_id` is intentionally nullable.

If an eligible manager activates and links their account while voting is open, their account proves their identity and they can vote against the already-fixed electorate. Their activation does not add a new voter or change quorum.

### Why the snapshot matters

The electorate should remain fixed for the life of the vote so that:

- the turnout denominator is stable;
- quorum cannot drift as website accounts are created;
- later club/manager changes do not rewrite who was eligible when voting opened;
- account activation is not confused with governance eligibility.

On 28 September 2026 the Level 5 concerns poll exposed the old bug. Its electorate had been snapshotted from linked Manager Portal accounts, producing **23 eligible managers**. A manager who linked after opening could authenticate successfully but RLS hid the poll and the UI misleadingly said there were no voting events.

The live electorate was repaired from active Top 100 membership to **98 managers**, preserving the six ballots already cast. Future polls use the corrected membership-based snapshot.

## Application responsibilities

### Manager Portal

Owns ordinary-manager sign-in and account linking. For an unlinked authenticated user, onboarding must be reachable without running the heavy Manager Portal data loader.

### Community Polls

Does not own a separate ordinary-manager sign-in. It consumes the Manager Portal identity/session handoff, looks up the active linked manager account, and relies on the frozen voting electorate for eligibility.

An authenticated linked manager who is in the electorate should see the poll.

**Outstanding UX requirement:** a linked manager who is not eligible for an event is currently filtered out by voting-event RLS, so the client can still collapse “not in this electorate” into the generic “No votes available” state. The voting UI should eventually distinguish “no poll exists” from “poll exists but this manager is not eligible”. Until that is implemented, do not treat the generic empty state as proof that no poll exists.

### Admin

Admin authentication is separate from ordinary manager onboarding. Admins may administer polls without a manager account, but casting a manager ballot still requires an eligible linked manager identity.

## Failure modes we hit

### 1. Authentication and application loading were coupled

Users could successfully authenticate and then hang while Manager Portal loaded claims, identity directories or tournament data. The UI made this look like sign-in failure.

**Lesson:** authentication success, identity linking and application-data loading need separate states and separate failure boundaries.

### 2. Recovery code became more dangerous than the original problem

Successive fixes introduced stale-token recovery, Web Lock interactions, overlapping loads and reload behaviour. Each attempted to make the system more resilient while increasing the number of states it could enter.

**Lesson:** prefer one authoritative bootstrap path. If recovery requires multiple competing session mechanisms, simplify the architecture instead.

### 3. Cross-origin storage was treated as shared

A session on `manager.smtop100.blog` does not automatically exist on `vote.smtop100.blog`.

**Lesson:** cross-origin identity requires an explicit handoff. Never assume browser local/session storage crosses subdomains.

### 4. PWA/service-worker state can outlive a deployment

A stale service worker can serve an old application before current JavaScript gets a chance to unregister it.

**Lesson:** authenticated application entry points should not depend on cached shells. Manager Portal deliberately retires legacy PWA workers/caches.

### 5. “No likely match” exposed an internal implementation detail

The claim screen asked an administrator for a canonical numeric manager ID.

**Lesson:** build admin tools around human concepts—manager name, club, game world—and let software resolve internal keys.

### 6. Tournament participation was mistaken for identity evidence

The matcher ignored managers with no tournament-entry history.

**Lesson:** the current game-world directory/membership is authoritative for current identity; tournament history is supplemental matching evidence.

### 7. Website accounts were mistaken for the electorate

This was the most serious governance error. Only 23 linked-account holders were snapshotted into an electorate that should have represented active Top 100 managers.

**Lesson:** authorization credentials prove *who a voter is*. They do not decide *whether that manager was eligible to vote*.

### 8. Misleading empty states hid authorization failures

An eligible manager omitted by RLS saw “There are no voting events available”.

**Lesson:** distinguish “no poll exists”, “not signed in”, “account not linked” and “signed in but not eligible”. These are operationally and socially very different states.

## Invariants for future changes

Treat these as regression requirements:

- There is one canonical ordinary-manager sign-in flow.
- An unlinked user can reach setup without loading tournament/application data.
- A linked manager can authenticate independently of whether any tournament data loads successfully.
- Account linking uses canonical manager identity plus active game-world membership.
- Admins never need to know database IDs to perform normal account approval.
- Opening a Top 100 poll snapshots all active Top 100 memberships, not linked website accounts.
- Activating an account after poll opening can unlock an already-eligible voter but cannot alter the electorate.
- Existing ballots must survive account/onboarding fixes and electorate repairs.
- Voting turnout/quorum uses the frozen electorate.
- Community Polls must not create a second ordinary-manager authentication system.
- Cross-origin session handoff must be bounded and must not loop.
- **Outstanding:** handoff failure is not yet surfaced explicitly to the user; `VotingEntry` currently falls through to the signed-out voting screen after bridge/setSession failure or timeout. Add a distinct user-facing handoff failure state before treating “fail visibly” as an invariant.
- Authenticated Manager Portal entry must not be served from a stale PWA shell.
- Empty/error states must describe the actual state rather than masking authorization problems.

## Regression scenarios

Before substantial auth, account-linking or voting changes, test at least:

1. Existing linked manager signs in and reaches My Matches.
2. Brand-new user follows a magic link and reaches manager setup.
3. Unlinked user can submit a claim even if old claim-history enrichment fails.
4. Admin can find and approve a current manager with no tournament history.
5. Manager Portal can return a signed-in manager to Community Polls.
6. A manager whose account existed when a poll opened can vote.
7. A manager who was an active Top 100 member when a poll opened, but activates their website account afterwards, can vote.
8. A manager who was not in the frozen electorate cannot gain eligibility merely by creating an account.
9. Admin can administer a poll without accidentally being treated as a manager voter.
10. A clean browser and a browser with legacy Top 100 service-worker state both reach the current Manager Portal.

## Design principle

When this area feels clever, stop.

The successful rebuild was the one that made the flow boring: **authenticate → identify → authorise → load the application**. Keep those boundaries visible and resist solving local failures by adding another recovery layer.
