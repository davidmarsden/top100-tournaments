-- Give organiser and assistant assignments genuinely different powers, and allow
-- registration to open before tournament capacity/shape has been decided.

create or replace function public.can_manage_tournament(target_tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.admin_users a
      where a.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.tournament_organisers o
      where o.tournament_id = target_tournament_id
        and o.auth_user_id = (select auth.uid())
        and o.active = true
        and o.role = 'organiser'
    );
$$;

create or replace function public.can_assist_tournament(target_tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.admin_users a
      where a.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.tournament_organisers o
      where o.tournament_id = target_tournament_id
        and o.auth_user_id = (select auth.uid())
        and o.active = true
        and o.role in ('organiser', 'assistant')
    );
$$;

revoke all on function public.can_assist_tournament(bigint) from public, anon;
grant execute on function public.can_assist_tournament(bigint) to authenticated, service_role;

-- Both delegated roles may see their assigned private tournament and the data
-- needed to operate matchday tasks. Structural changes remain organiser-only.
drop policy if exists "Authenticated read public tournaments and assigned organisers" on public.tournaments;
create policy "Authenticated read public tournaments and assigned staff"
  on public.tournaments for select to authenticated
  using ((select public.tournament_is_public(id)) or (select public.can_assist_tournament(id)));

drop policy if exists "Authenticated read public groups and assigned organisers" on public.groups;
create policy "Authenticated read public groups and assigned staff"
  on public.groups for select to authenticated
  using ((select public.tournament_is_public(tournament_id)) or (select public.can_assist_tournament(tournament_id)));

drop policy if exists "Authenticated read public tournament entries and assigned organ" on public.tournament_entries;
drop policy if exists "Authenticated read public tournament entries and assigned organisers" on public.tournament_entries;
create policy "Authenticated read public tournament entries and assigned staff"
  on public.tournament_entries for select to authenticated
  using ((select public.tournament_is_public(tournament_id)) or (select public.can_assist_tournament(tournament_id)));

drop policy if exists "Authenticated read public matches and assigned organisers" on public.matches;
create policy "Authenticated read public matches and assigned staff"
  on public.matches for select to authenticated
  using ((select public.tournament_is_public(tournament_id)) or (select public.can_assist_tournament(tournament_id)));

-- Assistants may maintain fixture schedules and enter/edit ordinary results.
drop policy if exists "Tournament managers insert matches" on public.matches;
create policy "Tournament staff insert matches"
  on public.matches for insert to authenticated
  with check ((select public.can_assist_tournament(tournament_id)));

drop policy if exists "Tournament managers update matches" on public.matches;
create policy "Tournament staff update matches"
  on public.matches for update to authenticated
  using ((select public.can_assist_tournament(tournament_id)))
  with check ((select public.can_assist_tournament(tournament_id)));

drop policy if exists "Tournament managers delete matches" on public.matches;
create policy "Tournament staff delete matches"
  on public.matches for delete to authenticated
  using ((select public.can_assist_tournament(tournament_id)));

-- Registration, entrant selection, groups, knockout structure, publishing and
-- tournament settings continue to rely on can_manage_tournament(), which now
-- means platform admin or organiser only.
drop policy if exists "Managers read own registrations and organisers read assigned" on public.tournament_registrations;
create policy "Managers read own registrations and staff read assigned"
  on public.tournament_registrations for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or (select public.can_assist_tournament(tournament_id))
  );

-- Allow assistants to read private-tournament forfeits for tables/reports.
drop policy if exists "Authenticated read public forfeits and tournament managers" on public.forfeits;
create policy "Authenticated read public forfeits and tournament staff"
  on public.forfeits for select to authenticated
  using (
    exists (
      select 1
      from public.matches m
      where m.id = match_id
        and (
          public.tournament_is_public(m.tournament_id)
          or (select public.can_assist_tournament(m.tournament_id))
        )
    )
  );

-- Registration-first workflow: a null/zero max_entries means capacity has not
-- been decided yet, not that registration is full.
create or replace function public.submit_manager_tournament_registration(
  target_tournament_id bigint,
  target_club_name text,
  target_rating numeric default null,
  target_notes text default null
)
returns public.tournament_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id uuid := (select auth.uid());
  account_row public.manager_portal_accounts%rowtype;
  manager_row public.managers%rowtype;
  tournament_row public.tournaments%rowtype;
  registration_row public.tournament_registrations%rowtype;
  clean_club_name text := nullif(trim(target_club_name), '');
  active_count bigint;
begin
  if user_id is null then raise exception 'Sign in to the Manager Portal first'; end if;
  if clean_club_name is null or length(clean_club_name) < 2 then raise exception 'Enter your club name'; end if;

  select * into account_row
  from public.manager_portal_accounts
  where auth_user_id = user_id and active = true
  limit 1;
  if not found then raise exception 'Your Manager Portal profile must be approved before registering'; end if;

  select * into manager_row from public.managers where id = account_row.manager_id;
  if not found then raise exception 'Manager profile not found'; end if;

  select * into tournament_row
  from public.tournaments
  where id = target_tournament_id
  for update;
  if not found then raise exception 'Tournament not found'; end if;
  if tournament_row.registration_status <> 'open' then raise exception 'Registration is not open'; end if;
  if tournament_row.registration_opens_at is not null and tournament_row.registration_opens_at > now() then raise exception 'Registration has not opened yet'; end if;
  if tournament_row.registration_closes_at is not null and tournament_row.registration_closes_at <= now() then raise exception 'Registration has closed'; end if;

  select * into registration_row
  from public.tournament_registrations
  where tournament_id = target_tournament_id
    and auth_user_id = user_id
    and status in ('pending','approved')
  order by submitted_at desc
  limit 1
  for update;

  if found then
    if registration_row.status = 'approved' then return registration_row; end if;
    update public.tournament_registrations
      set club_name = clean_club_name,
          club_key = public.normal_registration_key(clean_club_name),
          rating = target_rating,
          notes = nullif(trim(target_notes), ''),
          manager_id = manager_row.id,
          manager_name = coalesce(manager_row.display_name, manager_row.name),
          manager_email = account_row.email,
          submitted_at = now()
      where id = registration_row.id
      returning * into registration_row;
    return registration_row;
  end if;

  if coalesce(tournament_row.max_entries, 0) > 0 then
    select count(*) into active_count
    from public.tournament_registrations
    where tournament_id = target_tournament_id
      and status in ('pending','approved');
    if active_count >= tournament_row.max_entries then raise exception 'Registration is full'; end if;
  end if;

  insert into public.tournament_registrations (
    tournament_id, manager_name, manager_email, club_name, rating, notes,
    status, manager_key, email_key, club_key, auth_user_id, manager_id, team_id
  ) values (
    tournament_row.id,
    coalesce(manager_row.display_name, manager_row.name),
    account_row.email,
    clean_club_name,
    target_rating,
    nullif(trim(target_notes), ''),
    'pending',
    public.normal_registration_key(coalesce(manager_row.display_name, manager_row.name)),
    coalesce(lower(account_row.email), ''),
    public.normal_registration_key(clean_club_name),
    user_id,
    manager_row.id,
    null
  )
  returning * into registration_row;

  return registration_row;
end;
$$;

revoke all on function public.submit_manager_tournament_registration(bigint,text,numeric,text) from public, anon;
grant execute on function public.submit_manager_tournament_registration(bigint,text,numeric,text) to authenticated, service_role;
