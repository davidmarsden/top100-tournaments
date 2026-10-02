-- One Manager Portal identity should follow the canonical manager across every
-- supported game world. Managers must not create a second account for Regen.
--
-- The account row remains the single auth-user -> canonical-manager identity.
-- game_world_id on that legacy row records the world used for the original claim;
-- access to registrations is linked across worlds by canonical manager identity.

create or replace function public.approve_manager_portal_claim(
  target_claim_id bigint,
  target_manager_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_row public.manager_portal_claims%rowtype;
  resolved_manager_id bigint;
  resolved_manager_key text;
  reviewer_label text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into claim_row
  from public.manager_portal_claims
  where id = target_claim_id
  for update;

  if not found then raise exception 'Manager claim not found'; end if;
  if claim_row.status <> 'pending' then raise exception 'Manager claim has already been reviewed'; end if;

  resolved_manager_id := coalesce(target_manager_id, claim_row.suggested_manager_id);
  if resolved_manager_id is null then
    select m.id into resolved_manager_id
    from public.managers m
    where public.normal_registration_key(coalesce(m.display_name, m.name)) =
          public.normal_registration_key(claim_row.claimed_manager_name)
    order by m.active desc, m.id
    limit 1;
  end if;
  if resolved_manager_id is null then raise exception 'Choose a manager before approving this claim'; end if;

  select public.normal_registration_key(coalesce(m.display_name, m.name))
  into resolved_manager_key
  from public.managers m
  where m.id = resolved_manager_id;

  if resolved_manager_key is null then raise exception 'Canonical manager not found'; end if;

  reviewer_label := coalesce(
    nullif(auth.jwt() ->> 'name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    nullif(auth.jwt() ->> 'email', ''),
    'Administrator'
  );

  insert into public.manager_portal_accounts(auth_user_id, manager_id, game_world_id, email, active, updated_at)
  values (claim_row.auth_user_id, resolved_manager_id, claim_row.game_world_id, claim_row.email, true, now())
  on conflict (auth_user_id) do update set
    manager_id = excluded.manager_id,
    -- Keep the original/selected world as provenance only. The identity itself is
    -- world-agnostic and registrations below are attached across all worlds.
    game_world_id = excluded.game_world_id,
    email = excluded.email,
    active = true,
    updated_at = now();

  update public.manager_portal_claims set
    suggested_manager_id = resolved_manager_id,
    status = 'approved',
    reviewed_by = auth.uid(),
    reviewed_by_label = reviewer_label,
    reviewed_at = now(),
    updated_at = now()
  where id = target_claim_id;

  -- Attach every existing registration belonging to this canonical manager,
  -- regardless of whether it is Top 100 or Regen. The directory join prevents a
  -- same-name manager in an unrelated world from being attached accidentally.
  update public.tournament_registrations r
  set auth_user_id = claim_row.auth_user_id,
      manager_id = resolved_manager_id,
      updated_at = now()
  from public.tournaments t
  where r.tournament_id = t.id
    and r.auth_user_id is null
    and r.manager_key = resolved_manager_key
    and exists (
      select 1
      from public.game_world_clubs c
      where c.game_world_id = t.game_world_id
        and c.manager_key = resolved_manager_key
        and c.active = true
        and c.occupied = true
    );

  return resolved_manager_id;
end;
$$;

revoke all on function public.approve_manager_portal_claim(bigint,bigint) from public, anon;
grant execute on function public.approve_manager_portal_claim(bigint,bigint) to authenticated;

-- Backfill already-approved Portal identities. This makes the change effective for
-- existing managers too, without asking anyone to re-register or be re-approved.
update public.tournament_registrations r
set auth_user_id = a.auth_user_id,
    manager_id = a.manager_id,
    updated_at = now()
from public.manager_portal_accounts a,
     public.managers m,
     public.tournaments t
where a.active = true
  and m.id = a.manager_id
  and t.id = r.tournament_id
  and r.auth_user_id is null
  and r.manager_key = public.normal_registration_key(coalesce(m.display_name, m.name))
  and exists (
    select 1
    from public.game_world_clubs c
    where c.game_world_id = t.game_world_id
      and c.manager_key = public.normal_registration_key(coalesce(m.display_name, m.name))
      and c.active = true
      and c.occupied = true
  );

comment on column public.manager_portal_accounts.game_world_id is
  'Game world used when the single Manager Portal identity was claimed; access follows the canonical manager across supported game worlds.';
