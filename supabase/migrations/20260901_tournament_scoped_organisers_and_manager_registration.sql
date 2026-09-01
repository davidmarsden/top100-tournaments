-- Tournament-scoped organisers and authenticated manager registration.
-- Keeps platform administration global while allowing delegated organisers to manage only assigned tournaments.

create table if not exists public.tournament_organisers (
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  manager_id bigint references public.managers(id) on delete set null,
  role text not null default 'organiser' check (role in ('organiser','assistant')),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tournament_id, auth_user_id)
);

create index if not exists tournament_organisers_user_active_idx
  on public.tournament_organisers(auth_user_id, active, tournament_id);

alter table public.tournament_organisers enable row level security;

grant select, insert, update, delete on public.tournament_organisers to authenticated;
grant select, insert, update, delete on public.tournament_organisers to service_role;

drop policy if exists "Users read own tournament organiser assignments" on public.tournament_organisers;
create policy "Users read own tournament organiser assignments"
  on public.tournament_organisers for select
  to authenticated
  using ((select auth.uid()) = auth_user_id or (select public.is_admin()));

drop policy if exists "Platform admins insert tournament organiser assignments" on public.tournament_organisers;
create policy "Platform admins insert tournament organiser assignments"
  on public.tournament_organisers for insert
  to authenticated
  with check ((select public.is_admin()));

drop policy if exists "Platform admins update tournament organiser assignments" on public.tournament_organisers;
create policy "Platform admins update tournament organiser assignments"
  on public.tournament_organisers for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Platform admins delete tournament organiser assignments" on public.tournament_organisers;
create policy "Platform admins delete tournament organiser assignments"
  on public.tournament_organisers for delete
  to authenticated
  using ((select public.is_admin()));

create or replace function public.can_manage_tournament(target_tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
    or exists (
      select 1 from public.tournament_organisers o
      where o.tournament_id = target_tournament_id
        and o.auth_user_id = (select auth.uid())
        and o.active = true
    );
$$;

create or replace function public.has_tournament_admin_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
    or exists (
      select 1 from public.tournament_organisers o
      where o.auth_user_id = (select auth.uid()) and o.active = true
    );
$$;

revoke all on function public.can_manage_tournament(bigint) from public, anon;
revoke all on function public.has_tournament_admin_access() from public, anon;
grant execute on function public.can_manage_tournament(bigint) to authenticated, service_role;
grant execute on function public.has_tournament_admin_access() to authenticated, service_role;

-- Tournament visibility and updates.
drop policy if exists "Authenticated read public tournaments and admins read all" on public.tournaments;
create policy "Authenticated read public tournaments and assigned organisers"
  on public.tournaments for select to authenticated
  using ((select public.tournament_is_public(id)) or (select public.can_manage_tournament(id)));

drop policy if exists "Tournament managers update assigned tournaments" on public.tournaments;
create policy "Tournament managers update assigned tournaments"
  on public.tournaments for update to authenticated
  using ((select public.can_manage_tournament(id)))
  with check ((select public.can_manage_tournament(id)));

-- Reusable tournament-owned tables.
drop policy if exists "Admins insert groups" on public.groups;
drop policy if exists "Admins update groups" on public.groups;
drop policy if exists "Admins delete groups" on public.groups;
drop policy if exists "Authenticated read public groups and admins read all" on public.groups;
create policy "Authenticated read public groups and assigned organisers"
  on public.groups for select to authenticated
  using ((select public.tournament_is_public(tournament_id)) or (select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers insert groups" on public.groups for insert to authenticated
  with check ((select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers update groups" on public.groups for update to authenticated
  using ((select public.can_manage_tournament(tournament_id)))
  with check ((select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers delete groups" on public.groups for delete to authenticated
  using ((select public.can_manage_tournament(tournament_id)));

drop policy if exists "Admins insert matches" on public.matches;
drop policy if exists "Admins update matches" on public.matches;
drop policy if exists "Admins delete matches" on public.matches;
drop policy if exists "Authenticated read public matches and admins read all" on public.matches;
create policy "Authenticated read public matches and assigned organisers"
  on public.matches for select to authenticated
  using ((select public.tournament_is_public(tournament_id)) or (select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers insert matches" on public.matches for insert to authenticated
  with check ((select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers update matches" on public.matches for update to authenticated
  using ((select public.can_manage_tournament(tournament_id)))
  with check ((select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers delete matches" on public.matches for delete to authenticated
  using ((select public.can_manage_tournament(tournament_id)));

drop policy if exists "Admins insert tournament entries" on public.tournament_entries;
drop policy if exists "Admins update tournament entries" on public.tournament_entries;
drop policy if exists "Admins delete tournament entries" on public.tournament_entries;
drop policy if exists "Authenticated read public tournament entries and admins read al" on public.tournament_entries;
drop policy if exists "Authenticated read public tournament entries and admins read all" on public.tournament_entries;
create policy "Authenticated read public tournament entries and assigned organisers"
  on public.tournament_entries for select to authenticated
  using ((select public.tournament_is_public(tournament_id)) or (select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers insert tournament entries" on public.tournament_entries for insert to authenticated
  with check ((select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers update tournament entries" on public.tournament_entries for update to authenticated
  using ((select public.can_manage_tournament(tournament_id)))
  with check ((select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers delete tournament entries" on public.tournament_entries for delete to authenticated
  using ((select public.can_manage_tournament(tournament_id)));

drop policy if exists "Admins insert tournament round dates" on public.tournament_round_dates;
drop policy if exists "Admins update tournament round dates" on public.tournament_round_dates;
drop policy if exists "Admins delete tournament round dates" on public.tournament_round_dates;
drop policy if exists "Authenticated read public tournament round dates and admins rea" on public.tournament_round_dates;
drop policy if exists "Authenticated read public tournament round dates and admins read all" on public.tournament_round_dates;
create policy "Authenticated read public round dates and assigned organisers"
  on public.tournament_round_dates for select to authenticated
  using ((select public.tournament_is_public(tournament_id)) or (select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers insert round dates" on public.tournament_round_dates for insert to authenticated
  with check ((select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers update round dates" on public.tournament_round_dates for update to authenticated
  using ((select public.can_manage_tournament(tournament_id)))
  with check ((select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers delete round dates" on public.tournament_round_dates for delete to authenticated
  using ((select public.can_manage_tournament(tournament_id)));

-- Future stage/round tables already have RLS but no policies.
grant select, insert, update, delete on public.tournament_stages, public.tournament_rounds to authenticated;
drop policy if exists "Tournament managers manage stages" on public.tournament_stages;
create policy "Tournament managers manage stages" on public.tournament_stages for all to authenticated
  using ((select public.can_manage_tournament(tournament_id)))
  with check ((select public.can_manage_tournament(tournament_id)));
drop policy if exists "Tournament managers manage rounds" on public.tournament_rounds;
create policy "Tournament managers manage rounds" on public.tournament_rounds for all to authenticated
  using ((select public.can_manage_tournament(tournament_id)))
  with check ((select public.can_manage_tournament(tournament_id)));

-- Registration rows can now be tied to the authenticated manager identity.
alter table public.tournament_registrations
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists manager_id bigint references public.managers(id) on delete set null,
  add column if not exists team_id bigint references public.teams(id) on delete set null;

create index if not exists tournament_registrations_auth_user_idx
  on public.tournament_registrations(auth_user_id, submitted_at desc);
create unique index if not exists tournament_registrations_active_user_idx
  on public.tournament_registrations(tournament_id, auth_user_id)
  where auth_user_id is not null and status in ('pending','approved');

drop policy if exists "Admins read registrations" on public.tournament_registrations;
drop policy if exists "Admins update registrations" on public.tournament_registrations;
drop policy if exists "Admins delete registrations" on public.tournament_registrations;
create policy "Managers read own registrations and organisers read assigned"
  on public.tournament_registrations for select to authenticated
  using (auth_user_id = (select auth.uid()) or (select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers update registrations"
  on public.tournament_registrations for update to authenticated
  using ((select public.can_manage_tournament(tournament_id)))
  with check ((select public.can_manage_tournament(tournament_id)));
create policy "Tournament managers delete registrations"
  on public.tournament_registrations for delete to authenticated
  using ((select public.can_manage_tournament(tournament_id)));

create or replace function public.open_tournament_registrations()
returns table (
  id bigint, name text, season_number integer, public_slug text, max_entries integer,
  registration_status text, registration_opens_at timestamptz, registration_closes_at timestamptz,
  game_world_name text, competition_name text
)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.name, t.season_number, t.public_slug, t.max_entries,
         t.registration_status, t.registration_opens_at, t.registration_closes_at,
         gw.name, ct.name
  from public.tournaments t
  left join public.game_worlds gw on gw.id = t.game_world_id
  left join public.competition_types ct on ct.id = t.competition_type_id
  where t.registration_status = 'open'
    and (t.registration_opens_at is null or t.registration_opens_at <= now())
    and (t.registration_closes_at is null or t.registration_closes_at > now())
  order by t.season_number desc nulls last, t.name;
$$;
revoke all on function public.open_tournament_registrations() from public, anon;
grant execute on function public.open_tournament_registrations() to authenticated, service_role;

create or replace function public.submit_manager_tournament_registration(
  target_tournament_id bigint,
  target_team_id bigint,
  target_rating numeric default null,
  target_notes text default null
)
returns public.tournament_registrations
language plpgsql security definer set search_path = ''
as $$
declare
  user_id uuid := (select auth.uid());
  account_row public.manager_portal_accounts%rowtype;
  manager_row public.managers%rowtype;
  team_row public.teams%rowtype;
  tournament_row public.tournaments%rowtype;
  registration_row public.tournament_registrations%rowtype;
  active_count bigint;
begin
  if user_id is null then raise exception 'Sign in to the Manager Portal first'; end if;
  select * into account_row from public.manager_portal_accounts
    where auth_user_id = user_id and active = true limit 1;
  if not found then raise exception 'Your Manager Portal profile must be approved before registering'; end if;
  select * into manager_row from public.managers where id = account_row.manager_id;
  if not found then raise exception 'Manager profile not found'; end if;
  select * into team_row from public.teams where id = target_team_id and active = true;
  if not found then raise exception 'Team not found'; end if;
  select * into tournament_row from public.tournaments where id = target_tournament_id for update;
  if not found then raise exception 'Tournament not found'; end if;
  if tournament_row.registration_status <> 'open' then raise exception 'Registration is not open'; end if;
  if tournament_row.registration_opens_at is not null and tournament_row.registration_opens_at > now() then raise exception 'Registration has not opened yet'; end if;
  if tournament_row.registration_closes_at is not null and tournament_row.registration_closes_at <= now() then raise exception 'Registration has closed'; end if;

  select * into registration_row from public.tournament_registrations
    where tournament_id = target_tournament_id and auth_user_id = user_id and status in ('pending','approved')
    order by submitted_at desc limit 1 for update;
  if found then
    if registration_row.status = 'approved' then return registration_row; end if;
    update public.tournament_registrations
      set team_id = team_row.id, club_name = team_row.name, rating = target_rating,
          notes = nullif(trim(target_notes), ''), manager_id = manager_row.id,
          manager_name = coalesce(manager_row.display_name, manager_row.name),
          manager_email = account_row.email, submitted_at = now()
      where id = registration_row.id returning * into registration_row;
    return registration_row;
  end if;

  if tournament_row.max_entries is not null then
    select count(*) into active_count from public.tournament_registrations
      where tournament_id = target_tournament_id and status in ('pending','approved');
    if active_count >= tournament_row.max_entries then raise exception 'Registration is full'; end if;
  end if;

  insert into public.tournament_registrations (
    tournament_id, manager_name, manager_email, club_name, rating, notes, status,
    manager_key, email_key, club_key, auth_user_id, manager_id, team_id
  ) values (
    tournament_row.id, coalesce(manager_row.display_name, manager_row.name), account_row.email,
    team_row.name, target_rating, nullif(trim(target_notes), ''), 'pending',
    public.normal_registration_key(coalesce(manager_row.display_name, manager_row.name)),
    coalesce(lower(account_row.email), ''), public.normal_registration_key(team_row.name),
    user_id, manager_row.id, team_row.id
  ) returning * into registration_row;
  return registration_row;
end;
$$;

create or replace function public.withdraw_manager_tournament_registration(target_registration_id bigint)
returns public.tournament_registrations
language plpgsql security definer set search_path = ''
as $$
declare registration_row public.tournament_registrations%rowtype;
begin
  update public.tournament_registrations set status = 'withdrawn', updated_at = now()
  where id = target_registration_id and auth_user_id = (select auth.uid()) and status = 'pending'
  returning * into registration_row;
  if not found then raise exception 'Pending registration not found'; end if;
  return registration_row;
end;
$$;
revoke all on function public.submit_manager_tournament_registration(bigint,bigint,numeric,text) from public, anon;
revoke all on function public.withdraw_manager_tournament_registration(bigint) from public, anon;
grant execute on function public.submit_manager_tournament_registration(bigint,bigint,numeric,text) to authenticated, service_role;
grant execute on function public.withdraw_manager_tournament_registration(bigint) to authenticated, service_role;

-- Existing organiser-side registration RPCs become tournament-scoped.
create or replace function public.set_tournament_registration_window(
  target_tournament_id bigint,
  next_registration_status text,
  next_registration_opens_at timestamptz,
  next_registration_closes_at timestamptz
)
returns public.tournaments
language plpgsql security definer set search_path = ''
as $$
declare updated_row public.tournaments%rowtype;
begin
  if not public.can_manage_tournament(target_tournament_id) then raise exception 'Tournament organiser access required'; end if;
  if next_registration_status not in ('closed','open','paused','full') then raise exception 'Invalid registration status'; end if;
  if next_registration_opens_at is not null and next_registration_closes_at is not null
     and next_registration_closes_at <= next_registration_opens_at then
    raise exception 'Registration close date must be after the opening date';
  end if;
  update public.tournaments
    set registration_status = next_registration_status,
        registration_opens_at = next_registration_opens_at,
        registration_closes_at = next_registration_closes_at
    where id = target_tournament_id returning * into updated_row;
  if not found then raise exception 'Tournament not found'; end if;
  return updated_row;
end;
$$;

create or replace function public.promote_registration_to_entrant(registration_id bigint)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  registration_row public.tournament_registrations%rowtype;
  team_row_id bigint;
  manager_row_id bigint;
  entry_row_id bigint;
  next_seed integer;
begin
  select * into registration_row from public.tournament_registrations where id = registration_id for update;
  if not found then raise exception 'Registration not found'; end if;
  if not public.can_manage_tournament(registration_row.tournament_id) then raise exception 'Tournament organiser access required'; end if;
  if registration_row.status <> 'approved' then raise exception 'Registration must be approved first'; end if;
  if registration_row.promoted_entry_id is not null then return registration_row.promoted_entry_id; end if;

  team_row_id := registration_row.team_id;
  manager_row_id := registration_row.manager_id;
  if team_row_id is null then
    select id into team_row_id from public.teams
      where public.normal_registration_key(name) = registration_row.club_key order by id limit 1;
  end if;
  if team_row_id is null then
    insert into public.teams(name, active) values (registration_row.club_name, true) returning id into team_row_id;
  end if;
  if manager_row_id is null then
    select id into manager_row_id from public.managers
      where public.normal_registration_key(coalesce(display_name, name)) = registration_row.manager_key order by id limit 1;
  end if;
  if manager_row_id is null then
    insert into public.managers(name, display_name, canonical_name, active)
      values (registration_row.manager_name, registration_row.manager_name, lower(registration_row.manager_name), true)
      returning id into manager_row_id;
  end if;
  select id into entry_row_id from public.tournament_entries
    where tournament_id = registration_row.tournament_id and (team_id = team_row_id or manager_id = manager_row_id) limit 1;
  if entry_row_id is null then
    select coalesce(max(seed),0) + 1 into next_seed from public.tournament_entries where tournament_id = registration_row.tournament_id;
    insert into public.tournament_entries(tournament_id,team_id,manager_id,seed,rating,entry_status,prize_draw_eligible,notes)
      values (registration_row.tournament_id,team_row_id,manager_row_id,next_seed,registration_row.rating,'active',true,
              'Promoted from registration #' || registration_row.id)
      returning id into entry_row_id;
  end if;
  update public.tournament_registrations
    set team_id = team_row_id, manager_id = manager_row_id, promoted_entry_id = entry_row_id,
        promoted_at = now(), reviewed_at = coalesce(reviewed_at, now()), reviewed_by = coalesce(reviewed_by, (select auth.uid()))
    where id = registration_row.id;
  update public.tournaments t
    set actual_entries = (select count(*) from public.tournament_entries te where te.tournament_id = t.id)
    where t.id = registration_row.tournament_id;
  return entry_row_id;
end;
$$;
revoke all on function public.set_tournament_registration_window(bigint,text,timestamptz,timestamptz) from public, anon;
revoke all on function public.promote_registration_to_entrant(bigint) from public, anon;
grant execute on function public.set_tournament_registration_window(bigint,text,timestamptz,timestamptz) to authenticated, service_role;
grant execute on function public.promote_registration_to_entrant(bigint) to authenticated, service_role;

-- Organisers can see result submissions for matches in their assigned tournament.
drop policy if exists "Managers read own match submissions and admins read all" on public.manager_result_submissions;
create policy "Managers read own submissions and organisers read assigned"
  on public.manager_result_submissions for select to authenticated
  using (
    submitted_by_user_id = (select auth.uid()) or opponent_user_id = (select auth.uid())
    or exists (select 1 from public.matches m where m.id = match_id and (select public.can_manage_tournament(m.tournament_id)))
  );
