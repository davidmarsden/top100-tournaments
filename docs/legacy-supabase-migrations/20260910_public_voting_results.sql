-- Public, aggregate-only voting results for vote.smtop100.blog.
-- Deliberately exposes no individual ballots, manager identities, auth IDs or audit data.

create or replace function public.get_public_voting_results()
returns table(
  event_id bigint,
  event_slug text,
  event_title text,
  event_description text,
  event_type text,
  governance_kind text,
  closes_at timestamptz,
  results_released_at timestamptz,
  electorate_count integer,
  ballots_cast integer,
  turnout_percent numeric,
  decision_summary text,
  question_id bigint,
  question_title text,
  option_id bigint,
  option_label text,
  votes bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ve.id,
    ve.slug,
    ve.title,
    ve.description,
    ve.event_type,
    ve.governance_kind,
    ve.closes_at,
    ve.results_released_at,
    vr.electorate_count,
    vr.ballots_cast,
    vr.turnout_percent,
    vr.decision_summary,
    q.id,
    q.title,
    o.id,
    o.label,
    count(r.ballot_id)::bigint
  from public.voting_events ve
  join public.voting_event_results vr on vr.event_id = ve.id
  join public.voting_questions q on q.event_id = ve.id
  join public.voting_options o on o.question_id = q.id
  left join public.voting_responses r
    on r.question_id = q.id
   and r.option_id = o.id
  where ve.status = 'closed'
    and ve.results_visibility <> 'hidden'
    and (
      ve.results_visibility <> 'manual_release'
      or ve.results_released_at is not null
    )
  group by
    ve.id, ve.slug, ve.title, ve.description, ve.event_type, ve.governance_kind,
    ve.closes_at, ve.results_released_at,
    vr.electorate_count, vr.ballots_cast, vr.turnout_percent, vr.decision_summary,
    vr.finalised_at,
    q.id, q.title, q.sort_order,
    o.id, o.label, o.sort_order
  order by vr.finalised_at desc, ve.id desc, q.sort_order, q.id, o.sort_order, o.id;
$$;

revoke all on function public.get_public_voting_results() from public;
grant execute on function public.get_public_voting_results() to anon, authenticated;
