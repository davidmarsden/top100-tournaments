-- One Manager Portal identity follows the canonical manager across every supported
-- game world, while permissions remain scoped to active per-world membership.
-- Managers must not create a second account for Regen.
--
-- manager_portal_accounts.game_world_id remains claim provenance only. It must not
-- grant access to a world. manager_game_world_memberships is authoritative.

create or replace function public.manager_has_active_world_membership(
  target_manager_id bigint,
  target_game_world_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.manager_game_world_memberships gm
    where gm.manager_id = target_manager_id
      and gm.game_world_id = target_game_world_id
      and gm.active = true
  );
$$;

revoke all on function public.manager_has_active_world_membership(bigint,bigint) from public, anon;
grant execute on function public.manager_has_active_world_membership(bigint,bigint) to authenticated, service_role;

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
    join public.manager_game_world_memberships gm
      on gm.manager_id = m.id
     and gm.game_world_id = claim_row.game_world_id
     and gm.active = true
    where public.normal_registration_key(coalesce(m.display_name, m.name)) =
          public.normal_registration_key(claim_row.claimed_manager_name)
    order by m.active desc, m.id
    limit 1;
  end if;
  if resolved_manager_id is null then raise exception 'Choose a manager before approving this claim'; end if;

  -- The claim must identify a canonical manager who is actually active in the
  -- claimed world. This is the identity boundary; names are display data only.
  if not public.manager_has_active_world_membership(resolved_manager_id, claim_row.game_world_id) then
    raise exception 'This manager is not active in the claimed game world';
  end if;

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

  -- Attach registrations only in worlds where this exact canonical manager ID
  -- has an active membership. Never infer cross-world ownership from a name.
  update public.tournament_registrations r
  set auth_user_id = claim_row.auth_user_id,
      manager_id = resolved_manager_id,
      updated_at = now()
  from public.tournaments t
  where r.tournament_id = t.id
    and r.auth_user_id is null
    and r.manager_id = resolved_manager_id
    and public.manager_has_active_world_membership(resolved_manager_id, t.game_world_id);

  return resolved_manager_id;
end;
$$;

revoke all on function public.approve_manager_portal_claim(bigint,bigint) from public, anon;
grant execute on function public.approve_manager_portal_claim(bigint,bigint) to authenticated;

-- Backfill already-approved identities using canonical manager_id + world membership.
-- Registrations without a canonical manager_id are deliberately left untouched: an
-- admin can reconcile those ambiguous historical rows rather than guessing by name.
update public.tournament_registrations r
set auth_user_id = a.auth_user_id,
    updated_at = now()
from public.manager_portal_accounts a,
     public.tournaments t
where a.active = true
  and t.id = r.tournament_id
  and r.auth_user_id is null
  and r.manager_id = a.manager_id
  and public.manager_has_active_world_membership(a.manager_id, t.game_world_id);

-- A global Portal identity must never make a registration visible in a world where
-- the canonical manager is inactive. Staff access remains unchanged.
drop policy if exists "Managers read own registrations and staff read assigned" on public.tournament_registrations;
create policy "Managers read own registrations and staff read assigned"
  on public.tournament_registrations for select to authenticated
  using (
    (
      auth_user_id = (select auth.uid())
      and exists (
        select 1
        from public.tournaments t
        join public.manager_portal_accounts a
          on a.auth_user_id = (select auth.uid())
         and a.manager_id = tournament_registrations.manager_id
         and a.active = true
        join public.manager_game_world_memberships gm
          on gm.manager_id = a.manager_id
         and gm.game_world_id = t.game_world_id
         and gm.active = true
        where t.id = tournament_registrations.tournament_id
      )
    )
    or (select public.can_assist_tournament(tournament_id))
  );

-- Central write guard: every manager registration/result path, including existing
-- SECURITY DEFINER RPCs, must respect the tournament world's active membership.
create or replace function public.enforce_manager_tournament_world_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  world_id bigint;
  account_manager_id bigint;
begin
  -- Service/admin maintenance and unclaimed guest rows are not manager actions.
  if new.auth_user_id is null or auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.auth_user_id <> auth.uid() then
    return new;
  end if;

  select t.game_world_id into world_id
  from public.tournaments t
  where t.id = new.tournament_id;

  select a.manager_id into account_manager_id
  from public.manager_portal_accounts a
  where a.auth_user_id = auth.uid() and a.active = true
  limit 1;

  if account_manager_id is null
     or new.manager_id is distinct from account_manager_id
     or not public.manager_has_active_world_membership(account_manager_id, world_id) then
    raise exception 'Your manager is not active in this tournament game world';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_manager_tournament_world_membership() from public, anon, authenticated;

drop trigger if exists tournament_registration_requires_world_membership on public.tournament_registrations;
create trigger tournament_registration_requires_world_membership
before insert or update of auth_user_id, manager_id, tournament_id
on public.tournament_registrations
for each row execute function public.enforce_manager_tournament_world_membership();

create or replace function public.enforce_manager_result_world_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  world_id bigint;
  account_manager_id bigint;
begin
  if new.submitted_by_user_id is null or auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.submitted_by_user_id <> auth.uid() then
    return new;
  end if;

  select t.game_world_id into world_id
  from public.matches m
  join public.tournaments t on t.id = m.tournament_id
  where m.id = new.match_id;

  select a.manager_id into account_manager_id
  from public.manager_portal_accounts a
  where a.auth_user_id = auth.uid() and a.active = true
  limit 1;

  if account_manager_id is null
     or new.submitted_by_manager_id is distinct from account_manager_id
     or not public.manager_has_active_world_membership(account_manager_id, world_id) then
    raise exception 'Your manager is not active in this match game world';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_manager_result_world_membership() from public, anon, authenticated;

drop trigger if exists manager_result_requires_world_membership on public.manager_result_submissions;
create trigger manager_result_requires_world_membership
before insert or update of submitted_by_user_id, submitted_by_manager_id, match_id
on public.manager_result_submissions
for each row execute function public.enforce_manager_result_world_membership();

comment on column public.manager_portal_accounts.game_world_id is
  'Game world used when the single Manager Portal identity was claimed. Authorization is controlled by active manager_game_world_memberships, not this provenance field.';
