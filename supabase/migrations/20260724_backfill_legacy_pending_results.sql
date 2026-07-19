-- Promote result submissions created under the old confirm-before-publish workflow.
--
-- Before the provisional-result migrations, submit_manager_result() inserted a
-- manager_result_submissions row with status pending_confirmation but left the
-- official matches row scheduled and scoreless. The admin queue could therefore
-- see the submission while the public tournament page still showed "v".
--
-- This migration is deliberately conservative: it only promotes legacy rows
-- whose official match is still scheduled and has no score. It will not
-- overwrite a result already entered or amended by an administrator, or revive
-- a cancelled, forfeited, voided or otherwise terminal fixture.

with legacy_results as (
  select
    s.id as submission_id,
    s.match_id,
    s.submitted_by_user_id,
    s.submitted_home_score,
    s.submitted_away_score,
    s.status as submission_status,
    m.status as previous_status,
    m.home_score as previous_home_score,
    m.away_score as previous_away_score,
    m.home_entry_id,
    m.away_entry_id
  from public.manager_result_submissions s
  join public.matches m on m.id = s.match_id
  where s.status in ('pending_confirmation', 'disputed')
    and m.status = 'scheduled'
    and m.home_score is null
    and m.away_score is null
)
insert into public.match_result_revisions (
  match_id,
  submission_id,
  changed_by,
  action,
  previous_status,
  previous_home_score,
  previous_away_score,
  new_status,
  new_home_score,
  new_away_score,
  reason
)
select
  legacy.match_id,
  legacy.submission_id,
  legacy.submitted_by_user_id,
  'manager_submission',
  legacy.previous_status,
  legacy.previous_home_score,
  legacy.previous_away_score,
  'played',
  legacy.submitted_home_score,
  legacy.submitted_away_score,
  'Backfilled from the legacy pending-confirmation workflow.'
from legacy_results legacy
where not exists (
  select 1
  from public.match_result_revisions revision
  where revision.submission_id = legacy.submission_id
    and revision.action = 'manager_submission'
    and revision.reason = 'Backfilled from the legacy pending-confirmation workflow.'
);

with legacy_results as (
  select
    s.match_id,
    s.submitted_home_score,
    s.submitted_away_score,
    m.home_entry_id,
    m.away_entry_id
  from public.manager_result_submissions s
  join public.matches m on m.id = s.match_id
  where s.status in ('pending_confirmation', 'disputed')
    and m.status = 'scheduled'
    and m.home_score is null
    and m.away_score is null
)
update public.matches match
set
  home_score = legacy.submitted_home_score,
  away_score = legacy.submitted_away_score,
  winner_entry_id = case
    when legacy.submitted_home_score > legacy.submitted_away_score then legacy.home_entry_id
    when legacy.submitted_away_score > legacy.submitted_home_score then legacy.away_entry_id
    else null
  end,
  loser_entry_id = case
    when legacy.submitted_home_score > legacy.submitted_away_score then legacy.away_entry_id
    when legacy.submitted_away_score > legacy.submitted_home_score then legacy.home_entry_id
    else null
  end,
  status = 'played',
  played_at = coalesce(match.played_at, now())
from legacy_results legacy
where match.id = legacy.match_id;

update public.manager_result_submissions submission
set
  status = case
    when submission.status = 'disputed' then 'appealed'
    else 'pending_admin_check'
  end,
  updated_at = now()
where submission.status in ('pending_confirmation', 'disputed')
  and exists (
    select 1
    from public.matches match
    where match.id = submission.match_id
      and match.status = 'played'
      and match.home_score = submission.submitted_home_score
      and match.away_score = submission.submitted_away_score
  );