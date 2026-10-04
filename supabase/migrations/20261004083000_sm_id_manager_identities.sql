-- Make stable Soccer Manager IDs the primary identity bridge for Manager Portal/admin.

alter table public.manager_portal_claims
  add column if not exists source_manager_key text,
  add column if not exists source_club_key text;

create index if not exists manager_portal_claims_source_manager_idx
  on public.manager_portal_claims(game_world_id, source_manager_key)
  where source_manager_key is not null;

-- Admin-facing identity view: one canonical human, with each current world assignment
-- and the stable SM manager/club source IDs used to establish it. source_manager_key is
-- world-qualified (`setup:customer`), so expose the underlying customer ID separately.
create or replace view public.manager_soccer_manager_identities
with (security_invoker = true)
as
select
  m.id manager_id,
  coalesce(m.display_name, m.name) manager_name,
  membership.game_world_id,
  gw.name game_world_name,
  gw.slug game_world_slug,
  assignment.team_id,
  t.name team_name,
  assignment.source_manager_key sm_manager_key,
  case when assignment.source_manager_key is null then null else split_part(assignment.source_manager_key, ':', 2) end sm_manager_id,
  club_link.source_key sm_club_key,
  case when club_link.source_key is null then null else split_part(club_link.source_key, ':', 2) end sm_club_id,
  assignment.source_manager_name sm_manager_name,
  membership.active membership_active,
  assignment.updated_at assignment_updated_at
from public.managers m
join public.manager_game_world_memberships membership on membership.manager_id = m.id
join public.game_worlds gw on gw.id = membership.game_world_id
left join public.soccer_manager_world_manager_assignments assignment
  on assignment.game_world_id = membership.game_world_id
 and assignment.manager_id = m.id
left join public.teams t on t.id = assignment.team_id
left join lateral (
  select l.source_key
  from public.soccer_manager_archive_links l
  where l.source_type = 'club'
    and l.target_type = 'team'
    and l.target_id = assignment.team_id
    and gw.external_world_id is not null
    and split_part(l.source_key, ':', 1) = gw.external_world_id::text
  order by l.updated_at desc
  limit 1
) club_link on true;

grant select on public.manager_soccer_manager_identities to authenticated;

-- Match the underlying stable Soccer Manager customer ID across every synced world.
-- Callers may pass either a bare customer ID or the existing setup-qualified key.
create or replace function public.find_manager_portal_claim_match_by_sm_id(
  target_game_world_id bigint,
  target_source_manager_key text
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select nullif(trim(target_source_manager_key), '') as source_key
  ), customer as (
    select case
      when source_key is null then null
      when strpos(source_key, ':') > 0 then split_part(source_key, ':', 2)
      else source_key
    end customer_id
    from input
  )
  select case when count(distinct a.manager_id) = 1 then min(a.manager_id) else null end
  from public.soccer_manager_world_manager_assignments a
  cross join customer c
  where c.customer_id is not null
    and split_part(a.source_manager_key, ':', 2) = c.customer_id;
$$;

revoke all on function public.find_manager_portal_claim_match_by_sm_id(bigint,text) from public, anon;
grant execute on function public.find_manager_portal_claim_match_by_sm_id(bigint,text) to authenticated;

-- Admin helper to attach a canonical manager to an already-synced SM assignment.
-- This is useful for a genuinely new Top 100 manager: Sync supplies the authoritative
-- world/club/SM IDs, while the admin chooses or creates the human identity deliberately.
create or replace function public.link_manager_to_sm_assignment(
  target_manager_id bigint,
  target_game_world_id bigint,
  target_source_manager_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_row public.soccer_manager_world_manager_assignments%rowtype;
  normalized_source_key text := nullif(trim(target_source_manager_key), '');
  old_manager_id bigint;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if normalized_source_key is null then raise exception 'Soccer Manager manager key is required'; end if;

  select * into assignment_row
  from public.soccer_manager_world_manager_assignments
  where game_world_id = target_game_world_id
    and source_manager_key = normalized_source_key
  limit 1;

  if not found then raise exception 'Soccer Manager assignment not found'; end if;
  old_manager_id := assignment_row.manager_id;

  if old_manager_id <> target_manager_id then
    update public.soccer_manager_archive_links
    set target_id = target_manager_id, updated_at = now()
    where source_type = 'manager'
      and target_type = 'manager'
      and source_key = normalized_source_key;

    update public.soccer_manager_world_manager_assignments
    set manager_id = target_manager_id, updated_at = now()
    where game_world_id = target_game_world_id
      and source_manager_key = normalized_source_key;
  end if;

  insert into public.manager_game_world_memberships(manager_id, game_world_id, active)
  values (target_manager_id, target_game_world_id, true)
  on conflict (manager_id, game_world_id) do update set active = true, updated_at = now();

  -- Relinking must not leave the displaced identity authorized in this world. Keep
  -- membership only if that manager still owns another current SM assignment here.
  if old_manager_id <> target_manager_id
     and not exists (
       select 1
       from public.soccer_manager_world_manager_assignments a
       where a.game_world_id = target_game_world_id
         and a.manager_id = old_manager_id
     ) then
    update public.manager_game_world_memberships
    set active = false, updated_at = now()
    where manager_id = old_manager_id
      and game_world_id = target_game_world_id
      and active = true;
  end if;
end;
$$;

revoke all on function public.link_manager_to_sm_assignment(bigint,bigint,text) from public, anon;
grant execute on function public.link_manager_to_sm_assignment(bigint,bigint,text) to authenticated;
