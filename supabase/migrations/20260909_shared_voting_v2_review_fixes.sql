-- Shared Voting V2 review fixes
-- Tightens results access, makes electorate corrections effective, and finalises Awards per question.

create table if not exists public.voting_question_results (
  question_id bigint primary key references public.voting_questions(id) on delete cascade,
  event_id bigint not null references public.voting_events(id) on delete cascade,
  winning_option_id bigint references public.voting_options(id) on delete set null,
  winning_option_label text,
  winning_votes integer not null default 0,
  tied boolean not null default false,
  finalised_at timestamptz not null default now(),
  finalised_by uuid references auth.users(id) on delete set null
);

create index if not exists voting_question_results_event_idx
  on public.voting_question_results(event_id, question_id);

alter table public.voting_question_results enable row level security;

drop policy if exists "Eligible managers can read question voting results" on public.voting_question_results;
create policy "Eligible managers can read question voting results"
on public.voting_question_results for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.voting_events ve
    join public.manager_portal_accounts a
      on a.auth_user_id = auth.uid() and a.active = true
    join public.voting_electorate e
      on e.manager_id = a.manager_id and e.event_id = ve.id
    where ve.id = voting_question_results.event_id
      and (
        ve.results_visibility = 'live'
        or (ve.results_visibility = 'after_close' and (ve.status = 'closed' or (ve.closes_at is not null and now() >= ve.closes_at)))
        or (ve.results_visibility = 'manual_release' and ve.results_released_at is not null)
      )
  )
);

-- SECURITY DEFINER means this function must explicitly enforce electorate membership.
create or replace function public.get_voting_results(target_event_id bigint)
returns table(question_id bigint, question_title text, option_id bigint, option_label text, votes bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.voting_events%rowtype;
  v_account public.manager_portal_accounts%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_event from public.voting_events where id = target_event_id;
  if not found then raise exception 'Voting event not found'; end if;

  if not public.is_admin() then
    select * into v_account
    from public.manager_portal_accounts
    where auth_user_id = auth.uid() and active = true
    limit 1;
    if not found then raise exception 'Active manager account required'; end if;

    if not exists (
      select 1 from public.voting_electorate
      where event_id = target_event_id and manager_id = v_account.manager_id
    ) then
      raise exception 'Manager is not in this vote''s electorate';
    end if;

    if v_event.results_visibility = 'hidden' then raise exception 'Results are hidden'; end if;
    if v_event.results_visibility = 'manual_release' and v_event.results_released_at is null then
      raise exception 'Results have not been released';
    end if;
    if v_event.results_visibility = 'after_close'
      and not (v_event.status = 'closed' or (v_event.closes_at is not null and now() >= v_event.closes_at)) then
      raise exception 'Results are not available until voting closes';
    end if;
  end if;

  return query
  select q.id, q.title, o.id, o.label, count(r.ballot_id)::bigint
  from public.voting_questions q
  join public.voting_options o on o.question_id = q.id
  left join public.voting_responses r on r.question_id = q.id and r.option_id = o.id
  where q.event_id = target_event_id
  group by q.id, q.title, q.sort_order, o.id, o.label, o.sort_order
  order by q.sort_order, q.id, o.sort_order, o.id;
end;
$$;

revoke all on function public.get_voting_results(bigint) from public;
grant execute on function public.get_voting_results(bigint) to authenticated;

-- Corrections are deliberately applied only after open_voting_event has created the snapshot.
create or replace function public.add_voting_electorate_member(
  target_event_id bigint,
  target_manager_id bigint,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.voting_events%rowtype;
  v_manager public.managers%rowtype;
  v_account public.manager_portal_accounts%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required'; end if;
  if nullif(trim(reason), '') is null then raise exception 'An audit reason is required'; end if;

  select * into v_event from public.voting_events where id = target_event_id for update;
  if not found then raise exception 'Voting event not found'; end if;
  if v_event.status <> 'open' then
    raise exception 'Electorate corrections must be made after the vote is opened and before it closes';
  end if;
  if v_event.closes_at is not null and now() >= v_event.closes_at then raise exception 'Voting has closed'; end if;

  select * into v_manager from public.managers where id = target_manager_id;
  if not found then raise exception 'Manager not found'; end if;

  select * into v_account
  from public.manager_portal_accounts
  where manager_id = target_manager_id and active = true
  order by id
  limit 1;

  insert into public.voting_electorate(event_id, manager_id, manager_account_id, manager_name)
  values (
    target_event_id,
    target_manager_id,
    v_account.id,
    coalesce(nullif(v_manager.display_name, ''), v_manager.name)
  )
  on conflict (event_id, manager_id) do update set
    manager_account_id = excluded.manager_account_id,
    manager_name = excluded.manager_name;

  insert into public.voting_audit_log(event_id, actor_user_id, manager_id, action, details)
  values (
    target_event_id,
    auth.uid(),
    target_manager_id,
    'electorate_member_added',
    jsonb_build_object('reason', trim(reason), 'active_account_found', v_account.id is not null)
  );
end;
$$;

revoke all on function public.add_voting_electorate_member(bigint,bigint,text) from public;
grant execute on function public.add_voting_electorate_member(bigint,bigint,text) to authenticated;

-- Awards are multi-question events, so each category must be finalised independently.
create or replace function public.finalise_awards_event(target_event_id bigint)
returns public.voting_event_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.voting_events%rowtype;
  v_question public.voting_questions%rowtype;
  v_top_count integer;
  v_tie_count integer;
  v_winner public.voting_options%rowtype;
  v_categories integer := 0;
  v_electorate integer;
  v_ballots integer;
  v_turnout numeric(6,2);
  v_result public.voting_event_results%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into v_event from public.voting_events where id = target_event_id for update;
  if not found then raise exception 'Voting event not found'; end if;
  if v_event.event_type <> 'awards' then raise exception 'Event is not an Awards event'; end if;
  if v_event.status = 'draft' then raise exception 'Draft events cannot be finalised'; end if;
  if v_event.status = 'cancelled' then raise exception 'Cancelled events cannot be finalised'; end if;
  if v_event.status = 'open' and (v_event.closes_at is null or now() < v_event.closes_at) then
    raise exception 'Voting is still open';
  end if;

  for v_question in
    select * from public.voting_questions where event_id = target_event_id order by sort_order, id
  loop
    v_categories := v_categories + 1;
    v_winner := null;

    select max(votes) into v_top_count
    from (
      select count(r.ballot_id)::integer votes
      from public.voting_options o
      left join public.voting_responses r on r.question_id = v_question.id and r.option_id = o.id
      where o.question_id = v_question.id
      group by o.id
    ) counts;

    select count(*) into v_tie_count
    from (
      select o.id
      from public.voting_options o
      left join public.voting_responses r on r.question_id = v_question.id and r.option_id = o.id
      where o.question_id = v_question.id
      group by o.id
      having count(r.ballot_id) = coalesce(v_top_count, 0)
    ) tied;

    if coalesce(v_top_count, 0) > 0 and v_tie_count = 1 then
      select o.* into v_winner
      from public.voting_options o
      left join public.voting_responses r on r.question_id = v_question.id and r.option_id = o.id
      where o.question_id = v_question.id
      group by o.id
      order by count(r.ballot_id) desc, o.sort_order, o.id
      limit 1;
    end if;

    insert into public.voting_question_results(
      question_id, event_id, winning_option_id, winning_option_label, winning_votes,
      tied, finalised_at, finalised_by
    ) values (
      v_question.id, target_event_id, v_winner.id, v_winner.label, coalesce(v_top_count,0),
      (v_tie_count > 1), now(), auth.uid()
    )
    on conflict (question_id) do update set
      winning_option_id = excluded.winning_option_id,
      winning_option_label = excluded.winning_option_label,
      winning_votes = excluded.winning_votes,
      tied = excluded.tied,
      finalised_at = excluded.finalised_at,
      finalised_by = excluded.finalised_by;
  end loop;

  select count(*) into v_electorate from public.voting_electorate where event_id = target_event_id;
  select count(*) into v_ballots from public.voting_ballots where event_id = target_event_id;
  v_turnout := case when v_electorate = 0 then 0 else round((v_ballots::numeric / v_electorate::numeric) * 100, 2) end;

  update public.voting_events set status = 'closed', updated_at = now() where id = target_event_id;

  insert into public.voting_event_results(
    event_id, electorate_count, ballots_cast, turnout_percent, quorum_met,
    winning_option_id, winning_option_label, winning_votes, decision_passed,
    decision_summary, finalised_at, finalised_by
  ) values (
    target_event_id, v_electorate, v_ballots, v_turnout, true,
    null, null, 0, null,
    format('Awards results finalised for %s categor%s.', v_categories, case when v_categories = 1 then 'y' else 'ies' end),
    now(), auth.uid()
  )
  on conflict (event_id) do update set
    electorate_count = excluded.electorate_count,
    ballots_cast = excluded.ballots_cast,
    turnout_percent = excluded.turnout_percent,
    quorum_met = excluded.quorum_met,
    winning_option_id = null,
    winning_option_label = null,
    winning_votes = 0,
    decision_passed = null,
    decision_summary = excluded.decision_summary,
    finalised_at = excluded.finalised_at,
    finalised_by = excluded.finalised_by
  returning * into v_result;

  insert into public.voting_audit_log(event_id, actor_user_id, action, details)
  values (target_event_id, auth.uid(), 'awards_finalised', jsonb_build_object(
    'category_count', v_categories,
    'electorate_count', v_electorate,
    'ballots_cast', v_ballots,
    'turnout_percent', v_turnout
  ));

  return v_result;
end;
$$;

revoke all on function public.finalise_awards_event(bigint) from public;
grant execute on function public.finalise_awards_event(bigint) to authenticated;
