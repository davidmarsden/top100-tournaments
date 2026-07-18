-- Manager claim matching v2
--
-- Improvements:
-- 1. Prefer exact manager-name matches.
-- 2. Allow a shortened claimed name (for example "Carl") to match the
--    beginning of a canonical name ("Carl Martin") only when club matching
--    identifies a single best candidate.
-- 3. Prefer the manager record used in the most recent tournament season.
--    This prevents duplicate historical/imported manager rows from causing
--    an otherwise obvious exact match to return NULL.
-- 4. Re-check all pending claims immediately.

create or replace function public.manager_portal_claim_candidates(
  claimed_manager_name text,
  claimed_club_name text
)
returns table (
  manager_id bigint,
  manager_name text,
  team_name text,
  match_quality integer,
  latest_season integer,
  appearances bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with prepared as (
    select
      public.normalise_manager_claim_text(claimed_manager_name) as claimed_name,
      public.canonical_manager_claim_club(claimed_club_name) as claimed_club
  ),
  matching_entries as (
    select
      te.manager_id,
      coalesce(m.display_name, m.name) as manager_name,
      t.name as team_name,
      case
        when public.normalise_manager_claim_text(coalesce(m.display_name, m.name)) = p.claimed_name then 2
        when public.normalise_manager_claim_text(coalesce(m.display_name, m.name)) like p.claimed_name || ' %' then 1
        else 0
      end as match_quality,
      coalesce(tr.season_number, 0) as season_number
    from public.tournament_entries te
    join public.managers m on m.id = te.manager_id
    join public.teams t on t.id = te.team_id
    join public.tournaments tr on tr.id = te.tournament_id
    cross join prepared p
    where public.canonical_manager_claim_club(t.name) = p.claimed_club
      and (
        public.normalise_manager_claim_text(coalesce(m.display_name, m.name)) = p.claimed_name
        or public.normalise_manager_claim_text(coalesce(m.display_name, m.name)) like p.claimed_name || ' %'
      )
  )
  select
    me.manager_id,
    max(me.manager_name) as manager_name,
    max(me.team_name) as team_name,
    max(me.match_quality) as match_quality,
    max(me.season_number) as latest_season,
    count(*) as appearances
  from matching_entries me
  group by me.manager_id
  order by
    max(me.match_quality) desc,
    max(me.season_number) desc,
    count(*) desc,
    me.manager_id desc;
$$;

create or replace function public.find_manager_portal_claim_match(
  claimed_manager_name text,
  claimed_club_name text
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select candidate.manager_id
  from public.manager_portal_claim_candidates(claimed_manager_name, claimed_club_name) candidate
  order by
    candidate.match_quality desc,
    candidate.latest_season desc,
    candidate.appearances desc,
    candidate.manager_id desc
  limit 1;
$$;

-- Re-check existing pending claims. The trigger continues to handle new and
-- edited claims because it already calls find_manager_portal_claim_match().
update public.manager_portal_claims
set suggested_manager_id = public.find_manager_portal_claim_match(
  claimed_manager_name,
  claimed_club_name
)
where status = 'pending';

grant execute on function public.manager_portal_claim_candidates(text, text) to authenticated;
grant execute on function public.find_manager_portal_claim_match(text, text) to authenticated;
