-- Close the remaining structural/review races around knockout-only tournaments.
-- 1. Knockout-only match rows may be created only through the SECURITY DEFINER
--    atomic draw RPCs, never ad hoc through the authenticated Data API.
-- 2. Tournament organisers may read result-submission state only for tournaments
--    they manage, so delegated organiser workflow state is review-aware.
-- 3. Final match/submission mutations and tournament completion share the same
--    tournament-scoped lock, preventing completion from racing a reopened review.

-- The atomic opening/successor draw functions are SECURITY DEFINER and therefore
-- bypass RLS. Authenticated organisers can still create ordinary group/standard
-- fixtures, but cannot manufacture knockout-only structural rows directly.
drop policy if exists "Tournament managers insert matches" on public.matches;
create policy "Tournament managers insert matches"
on public.matches
for insert
to authenticated
with check (
  (select public.can_manage_tournament(matches.tournament_id))
  and not (
    matches.stage = 'knockout'
    and (select public.is_knockout_only_tournament(matches.tournament_id))
  )
);

-- Keep manager privacy, while giving full organisers the scoped review visibility
-- their tournament workflow already requires. Assistants do not satisfy
-- can_manage_tournament and therefore do not gain this access.
drop policy if exists "Managers can read submissions for their matches" on public.manager_result_submissions;
drop policy if exists "Managers read own submissions and organisers read assigned" on public.manager_result_submissions;
create policy "Managers read own submissions and organisers read assigned"
on public.manager_result_submissions
for select
to authenticated
using (
  submitted_by_user_id = (select auth.uid())
  or opponent_user_id = (select auth.uid())
  or exists (
    select 1
    from public.matches m
    where m.id = manager_result_submissions.match_id
      and (select public.can_manage_tournament(m.tournament_id))
  )
);

-- Final match changes take the tournament row lock before the shared advisory
-- lock. The trigger name is deliberately prefixed with "a_" so it runs before
-- the existing generic knockout mutation-lock trigger at the same timing.
create or replace function public.lock_knockout_final_match_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_id_value bigint;
  is_final boolean;
  knockout_only boolean;
begin
  tournament_id_value := case when tg_op = 'DELETE' then old.tournament_id else new.tournament_id end;
  is_final := case
    when tg_op = 'DELETE' then old.stage = 'knockout' and old.round = 'Final'
    when tg_op = 'INSERT' then new.stage = 'knockout' and new.round = 'Final'
    else (old.stage = 'knockout' and old.round = 'Final') or (new.stage = 'knockout' and new.round = 'Final')
  end;

  if not is_final then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select t.tournament_structure = 'knockout_only'
    into knockout_only
  from public.tournaments t
  where t.id = tournament_id_value
  for update;

  if coalesce(knockout_only, false) then
    perform pg_advisory_xact_lock(public.knockout_roster_lock_key(tournament_id_value));
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.lock_knockout_final_match_transaction() from public, anon, authenticated;
grant execute on function public.lock_knockout_final_match_transaction() to service_role;

drop trigger if exists a_lock_knockout_final_match_transaction on public.matches;
create trigger a_lock_knockout_final_match_transaction
before insert or update or delete on public.matches
for each row execute function public.lock_knockout_final_match_transaction();

-- Submission mutations use the same row-lock -> advisory-lock order as Final
-- match mutations and completion, so a review cannot be opened/reopened in the
-- gap while another transaction is marking the tournament complete.
create or replace function public.lock_knockout_final_submission_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_id_value bigint;
  tournament_id_value bigint;
begin
  match_id_value := case when tg_op = 'DELETE' then old.match_id else new.match_id end;

  select m.tournament_id
    into tournament_id_value
  from public.matches m
  join public.tournaments t on t.id = m.tournament_id
  where m.id = match_id_value
    and m.stage = 'knockout'
    and m.round = 'Final'
    and t.tournament_structure = 'knockout_only';

  if tournament_id_value is not null then
    perform 1
    from public.tournaments t
    where t.id = tournament_id_value
    for update;

    perform pg_advisory_xact_lock(public.knockout_roster_lock_key(tournament_id_value));
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.lock_knockout_final_submission_transaction() from public, anon, authenticated;
grant execute on function public.lock_knockout_final_submission_transaction() to service_role;

drop trigger if exists a_lock_knockout_final_submission_transaction on public.manager_result_submissions;
create trigger a_lock_knockout_final_submission_transaction
before insert or update or delete on public.manager_result_submissions
for each row execute function public.lock_knockout_final_submission_transaction();

-- Tournament UPDATE has already locked its row before this BEFORE-row trigger
-- executes. Taking the same advisory lock here serialises the invariant check
-- with the Final match/submission pre-lock triggers above.
create or replace function public.guard_knockout_only_tournament_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  final_ready boolean;
  final_under_review boolean;
begin
  if new.status not in ('completed', 'archived')
     or new.status is not distinct from old.status
     or new.tournament_structure <> 'knockout_only' then
    return new;
  end if;

  perform pg_advisory_xact_lock(public.knockout_roster_lock_key(new.id));

  select exists (
    select 1
    from public.matches m
    where m.tournament_id = new.id
      and m.stage = 'knockout'
      and m.round = 'Final'
      and m.status in ('played', 'forfeit')
      and m.winner_entry_id is not null
  ) into final_ready;

  if not final_ready then
    raise exception 'Knockout-only tournaments cannot be completed before the Final has a resolved winner';
  end if;

  select exists (
    select 1
    from public.manager_result_submissions s
    join public.matches m on m.id = s.match_id
    where m.tournament_id = new.id
      and m.stage = 'knockout'
      and m.round = 'Final'
      and s.status in (
        'pending_confirmation',
        'disputed',
        'pending_admin_check',
        'opponent_confirmed',
        'appealed'
      )
  ) into final_under_review;

  if final_under_review then
    raise exception 'Knockout-only tournaments cannot be completed while the Final result is still under review';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_knockout_only_tournament_completion() from public, anon, authenticated;
grant execute on function public.guard_knockout_only_tournament_completion() to service_role;
