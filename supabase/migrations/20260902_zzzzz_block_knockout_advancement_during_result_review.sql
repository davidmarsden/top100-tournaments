-- Follow-up to PR #73 Codex review.
-- Knockout-only rounds are generated incrementally from saved winners. Do not
-- allow a successor round to copy a winner while that result is still subject
-- to confirmation, admin review, dispute or appeal.

create or replace function public.guard_knockout_successor_result_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_review_exists boolean;
begin
  if new.stage <> 'knockout'
     or not public.is_knockout_only_tournament(new.tournament_id)
     or public.knockout_round_rank(new.round) is null then
    return new;
  end if;

  select exists (
    select 1
    from public.matches predecessor
    join public.manager_result_submissions submission
      on submission.match_id = predecessor.id
    where predecessor.tournament_id = new.tournament_id
      and predecessor.stage = 'knockout'
      and coalesce(predecessor.bracket, 'Cup') = coalesce(new.bracket, 'Cup')
      and public.knockout_round_rank(predecessor.round) < public.knockout_round_rank(new.round)
      and submission.status in (
        'pending_confirmation',
        'disputed',
        'pending_admin_check',
        'opponent_confirmed',
        'appealed'
      )
  ) into open_review_exists;

  if open_review_exists then
    raise exception 'Cannot generate the next knockout round while an earlier result is still under review';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_knockout_successor_result_reviews() from public, anon, authenticated;
grant execute on function public.guard_knockout_successor_result_reviews() to service_role;

drop trigger if exists guard_knockout_successor_result_reviews on public.matches;
create trigger guard_knockout_successor_result_reviews
before insert on public.matches
for each row execute function public.guard_knockout_successor_result_reviews();
