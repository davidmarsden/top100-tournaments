-- Defensive follow-up for manager claim review.
--
-- 1. Reviewer labels must never expose an email address to claimants.
-- 2. Learned aliases must match the manager approved on the source claim.
--
-- This migration is dated after 20260718_manager_claim_suggestions.sql because
-- it adds a trigger to manager_team_aliases, which that earlier migration creates.

create or replace function public.sanitise_manager_claim_reviewer_label()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.reviewed_by_label is null
     or trim(new.reviewed_by_label) = ''
     or new.reviewed_by_label like '%@%' then
    new.reviewed_by_label := 'Top 100 Admin';
  end if;

  return new;
end;
$$;

drop trigger if exists sanitise_manager_claim_reviewer_label
  on public.manager_portal_claims;

create trigger sanitise_manager_claim_reviewer_label
before insert or update of reviewed_by_label
on public.manager_portal_claims
for each row
execute function public.sanitise_manager_claim_reviewer_label();

-- Remove any email labels that may already have been stored before this guard.
update public.manager_portal_claims
set reviewed_by_label = 'Top 100 Admin'
where reviewed_by_label like '%@%';

create or replace function public.validate_manager_team_alias_source()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  approved_manager_id bigint;
begin
  if new.created_from_claim_id is null then
    return new;
  end if;

  select c.suggested_manager_id
  into approved_manager_id
  from public.manager_portal_claims c
  where c.id = new.created_from_claim_id
    and c.status = 'approved';

  if approved_manager_id is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.tournament_entries te
    where te.manager_id = approved_manager_id
      and te.team_id = new.team_id
  ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_manager_team_alias_source
  on public.manager_team_aliases;

create trigger validate_manager_team_alias_source
before insert or update of team_id, created_from_claim_id
on public.manager_team_aliases
for each row
execute function public.validate_manager_team_alias_source();
