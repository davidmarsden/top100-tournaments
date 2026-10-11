-- Public Community Poll listing and aggregate live results.
-- Exposes poll metadata and aggregate counts only: never ballots or manager identities.

create or replace function public.get_public_community_polls()
returns table(
  event_id bigint,
  event_slug text,
  event_title text,
  event_description text,
  event_type text,
  governance_kind text,
  status text,
  opens_at timestamptz,
  closes_at timestamptz,
  results_visibility text,
  electorate_count bigint,
  ballots_cast bigint,
  question_id bigint,
  question_title text,
  option_id bigint,
  option_label text,
  votes bigint
)
language sql security definer set search_path = public stable
as $$
  select
    ve.id, ve.slug, ve.title, ve.description, ve.event_type, ve.governance_kind,
    ve.status, ve.opens_at, ve.closes_at, ve.results_visibility,
    count(distinct e.manager_id)::bigint,
    count(distinct b.id)::bigint,
    q.id, q.title, o.id, o.label,
    case when ve.results_visibility = 'live' then count(distinct r.ballot_id)::bigint else null::bigint end
  from public.voting_events ve
  join public.voting_questions q on q.event_id = ve.id
  join public.voting_options o on o.question_id = q.id
  left join public.voting_electorate e on e.event_id = ve.id
  left join public.voting_ballots b on b.event_id = ve.id
  left join public.voting_responses r on r.ballot_id = b.id and r.question_id = q.id and r.option_id = o.id
  where ve.event_type = 'poll'
    and ve.status = 'open'
    and (ve.opens_at is null or ve.opens_at <= now())
    and (ve.closes_at is null or ve.closes_at > now())
  group by ve.id, ve.slug, ve.title, ve.description, ve.event_type, ve.governance_kind,
    ve.status, ve.opens_at, ve.closes_at, ve.results_visibility,
    q.id, q.title, q.sort_order, o.id, o.label, o.sort_order
  order by ve.id desc, q.sort_order, q.id, o.sort_order, o.id;
$$;

revoke all on function public.get_public_community_polls() from public;
grant execute on function public.get_public_community_polls() to anon, authenticated;
