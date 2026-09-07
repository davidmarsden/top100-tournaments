-- All-Manager Polls V1 on top of the shared authenticated voting foundation.

alter table public.voting_events
  add column if not exists governance_kind text not null default 'advisory'
    check (governance_kind in ('advisory','rule_change','appointment','other')),
  add column if not exists quorum_percent numeric(5,2) not null default 0
    check (quorum_percent >= 0 and quorum_percent <= 100),
  add column if not exists decision_rule text not null default 'plurality'
    check (decision_rule in ('plurality','simple_majority','supermajority')),
  add column if not exists threshold_percent numeric(5,2) not null default 50
    check (threshold_percent > 0 and threshold_percent <= 100),
  add column if not exists tie_policy text not null default 'no_change'
    check (tie_policy in ('no_change','admin_decision','runoff')),
  add column if not exists outcome_note text;

create table if not exists public.voting_event_results (
  event_id bigint primary key references public.voting_events(id) on delete cascade,
  electorate_count integer not null,
  ballots_cast integer not null,
  turnout_percent numeric(6,2) not null,
  quorum_met boolean not null,
  winning_option_id bigint references public.voting_options(id) on delete set null,
  winning_option_label text,
  winning_votes integer,
  decision_passed boolean,
  decision_summary text not null,
  finalised_at timestamptz not null default now(),
  finalised_by uuid references auth.users(id) on delete set null
);

alter table public.voting_event_results enable row level security;

create policy "Eligible managers can read final voting results"
on public.voting_event_results for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.manager_portal_accounts a
    join public.voting_electorate e on e.manager_id = a.manager_id
    where a.auth_user_id = auth.uid()
      and a.active = true
      and e.event_id = voting_event_results.event_id
  )
);

create or replace function public.create_manager_poll(
  poll_title text,
  poll_description text,
  question_title text,
  option_labels text[],
  closes_at_value timestamptz,
  results_visibility_value text default 'after_close',
  governance_kind_value text default 'advisory',
  quorum_percent_value numeric default 0,
  decision_rule_value text default 'plurality',
  threshold_percent_value numeric default 50,
  tie_policy_value text default 'no_change'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id bigint;
  v_question_id bigint;
  v_label text;
  v_sort integer := 0;
  v_slug text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if nullif(trim(poll_title), '') is null then raise exception 'Poll title is required'; end if;
  if nullif(trim(question_title), '') is null then raise exception 'Question is required'; end if;
  if closes_at_value is null or closes_at_value <= now() then raise exception 'Closing time must be in the future'; end if;
  if coalesce(array_length(option_labels, 1), 0) < 2 then raise exception 'At least two options are required'; end if;
  if results_visibility_value not in ('hidden','after_close','live') then raise exception 'Invalid results visibility'; end if;
  if governance_kind_value not in ('advisory','rule_change','appointment','other') then raise exception 'Invalid governance kind'; end if;
  if decision_rule_value not in ('plurality','simple_majority','supermajority') then raise exception 'Invalid decision rule'; end if;
  if tie_policy_value not in ('no_change','admin_decision','runoff') then raise exception 'Invalid tie policy'; end if;
  if quorum_percent_value < 0 or quorum_percent_value > 100 then raise exception 'Quorum must be 0-100'; end if;
  if threshold_percent_value <= 0 or threshold_percent_value > 100 then raise exception 'Threshold must be >0 and <=100'; end if;

  v_slug := regexp_replace(lower(trim(poll_title)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug) || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');

  insert into public.voting_events(
    slug, title, description, event_type, status, closes_at, results_visibility,
    governance_kind, quorum_percent, decision_rule, threshold_percent, tie_policy, created_by
  ) values (
    v_slug, trim(poll_title), nullif(trim(poll_description), ''), 'poll', 'draft', closes_at_value,
    results_visibility_value, governance_kind_value, quorum_percent_value,
    decision_rule_value, threshold_percent_value, tie_policy_value, auth.uid()
  ) returning id into v_event_id;

  insert into public.voting_questions(event_id, title, question_type, required, sort_order)
  values (v_event_id, trim(question_title), 'single_choice', true, 1)
  returning id into v_question_id;

  foreach v_label in array option_labels loop
    if nullif(trim(v_label), '') is not null then
      v_sort := v_sort + 1;
      insert into public.voting_options(question_id, label, value, sort_order)
      values (v_question_id, trim(v_label), trim(v_label), v_sort);
    end if;
  end loop;

  if v_sort < 2 then raise exception 'At least two non-empty options are required'; end if;

  insert into public.voting_audit_log(event_id, actor_user_id, action, details)
  values (v_event_id, auth.uid(), 'event_created', jsonb_build_object(
    'governance_kind', governance_kind_value,
    'decision_rule', decision_rule_value,
    'quorum_percent', quorum_percent_value,
    'threshold_percent', threshold_percent_value,
    'tie_policy', tie_policy_value
  ));

  return v_event_id;
end;
$$;

create or replace function public.finalise_voting_event(target_event_id bigint)
returns public.voting_event_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.voting_events%rowtype;
  v_electorate integer;
  v_ballots integer;
  v_turnout numeric(6,2);
  v_top_count integer;
  v_winner public.voting_options%rowtype;
  v_tie_count integer;
  v_quorum_met boolean;
  v_passed boolean;
  v_summary text;
  v_result public.voting_event_results%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into v_event from public.voting_events where id = target_event_id for update;
  if not found then raise exception 'Voting event not found'; end if;
  if v_event.status = 'draft' then raise exception 'Draft events cannot be finalised'; end if;
  if v_event.status = 'open' and (v_event.closes_at is null or now() < v_event.closes_at) then
    raise exception 'Voting is still open';
  end if;

  select count(*) into v_electorate from public.voting_electorate where event_id = target_event_id;
  select count(*) into v_ballots from public.voting_ballots where event_id = target_event_id;
  v_turnout := case when v_electorate = 0 then 0 else round((v_ballots::numeric / v_electorate::numeric) * 100, 2) end;
  v_quorum_met := v_turnout >= v_event.quorum_percent;

  select max(votes) into v_top_count
  from (
    select count(r.ballot_id)::integer votes
    from public.voting_questions q
    join public.voting_options o on o.question_id = q.id
    left join public.voting_responses r on r.question_id = q.id and r.option_id = o.id
    where q.event_id = target_event_id
    group by o.id
  ) counts;

  select count(*) into v_tie_count
  from (
    select o.id
    from public.voting_questions q
    join public.voting_options o on o.question_id = q.id
    left join public.voting_responses r on r.question_id = q.id and r.option_id = o.id
    where q.event_id = target_event_id
    group by o.id
    having count(r.ballot_id) = coalesce(v_top_count, 0)
  ) tied;

  if v_tie_count = 1 then
    select o.* into v_winner
    from public.voting_questions q
    join public.voting_options o on o.question_id = q.id
    left join public.voting_responses r on r.question_id = q.id and r.option_id = o.id
    where q.event_id = target_event_id
    group by o.id
    order by count(r.ballot_id) desc, o.sort_order, o.id
    limit 1;
  end if;

  if not v_quorum_met then
    v_passed := false;
    v_summary := format('Quorum not met: %s%% turnout, %s%% required.', v_turnout, v_event.quorum_percent);
  elsif v_tie_count > 1 then
    v_passed := false;
    v_summary := case v_event.tie_policy
      when 'runoff' then 'Vote tied; a runoff is required.'
      when 'admin_decision' then 'Vote tied; an administrator decision is required.'
      else 'Vote tied; no change is carried.'
    end;
  elsif v_winner.id is null then
    v_passed := false;
    v_summary := 'No valid votes were cast.';
  elsif v_event.decision_rule = 'plurality' then
    v_passed := true;
    v_summary := format('%s wins with %s vote(s).', v_winner.label, coalesce(v_top_count,0));
  else
    v_passed := (coalesce(v_top_count,0)::numeric / greatest(v_ballots,1)::numeric * 100) >= v_event.threshold_percent;
    v_summary := format('%s received %s of %s ballot(s); threshold %s%% %s.', v_winner.label, coalesce(v_top_count,0), v_ballots, v_event.threshold_percent, case when v_passed then 'met' else 'not met' end);
  end if;

  update public.voting_events
  set status = 'closed', updated_at = now()
  where id = target_event_id;

  insert into public.voting_event_results(
    event_id, electorate_count, ballots_cast, turnout_percent, quorum_met,
    winning_option_id, winning_option_label, winning_votes, decision_passed,
    decision_summary, finalised_at, finalised_by
  ) values (
    target_event_id, v_electorate, v_ballots, v_turnout, v_quorum_met,
    v_winner.id, v_winner.label, coalesce(v_top_count,0), v_passed,
    v_summary, now(), auth.uid()
  )
  on conflict (event_id) do update set
    electorate_count = excluded.electorate_count,
    ballots_cast = excluded.ballots_cast,
    turnout_percent = excluded.turnout_percent,
    quorum_met = excluded.quorum_met,
    winning_option_id = excluded.winning_option_id,
    winning_option_label = excluded.winning_option_label,
    winning_votes = excluded.winning_votes,
    decision_passed = excluded.decision_passed,
    decision_summary = excluded.decision_summary,
    finalised_at = excluded.finalised_at,
    finalised_by = excluded.finalised_by
  returning * into v_result;

  insert into public.voting_audit_log(event_id, actor_user_id, action, details)
  values (target_event_id, auth.uid(), 'event_finalised', jsonb_build_object(
    'electorate_count', v_electorate,
    'ballots_cast', v_ballots,
    'turnout_percent', v_turnout,
    'decision_passed', v_passed,
    'summary', v_summary
  ));

  return v_result;
end;
$$;

revoke all on function public.create_manager_poll(text,text,text,text[],timestamptz,text,text,numeric,text,numeric,text) from public;
revoke all on function public.finalise_voting_event(bigint) from public;
grant execute on function public.create_manager_poll(text,text,text,text[],timestamptz,text,text,numeric,text,numeric,text) to authenticated;
grant execute on function public.finalise_voting_event(bigint) to authenticated;
