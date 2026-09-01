-- Follow-up for delegated tournament administration.
-- Managers may register a club that is not yet in the shared teams catalogue;
-- the canonical team row is created only when an organiser approves/promotes the entry.

create index if not exists tournament_organisers_manager_id_idx
  on public.tournament_organisers(manager_id);
create index if not exists tournament_organisers_created_by_idx
  on public.tournament_organisers(created_by);
create index if not exists tournament_registrations_manager_id_idx
  on public.tournament_registrations(manager_id);
create index if not exists tournament_registrations_team_id_idx
  on public.tournament_registrations(team_id);

create or replace function public.submit_manager_tournament_registration(
  target_tournament_id bigint,
  target_team_name text,
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
  team_row_id bigint;
  clean_team_name text := nullif(trim(target_team_name), '');
  tournament_row public.tournaments%rowtype;
  registration_row public.tournament_registrations%rowtype;
  active_count bigint;
begin
  if user_id is null then raise exception 'Sign in to the Manager Portal first'; end if;
  if clean_team_name is null then raise exception 'Club name is required'; end if;

  select * into account_row
  from public.manager_portal_accounts
  where auth_user_id = user_id and active = true
  limit 1;
  if not found then raise exception 'Your Manager Portal profile must be approved before registering'; end if;

  select * into manager_row from public.managers where id = account_row.manager_id;
  if not found then raise exception 'Manager profile not found'; end if;

  select id into team_row_id
  from public.teams
  where public.normal_registration_key(name) = public.normal_registration_key(clean_team_name)
  order by id
  limit 1;

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
    set team_id = team_row_id,
        club_name = clean_team_name,
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

  if tournament_row.max_entries is not null then
    select count(*) into active_count
    from public.tournament_registrations
    where tournament_id = target_tournament_id
      and status in ('pending','approved');
    if active_count >= tournament_row.max_entries then raise exception 'Registration is full'; end if;
  end if;

  insert into public.tournament_registrations (
    tournament_id, manager_name, manager_email, club_name, rating, notes, status,
    manager_key, email_key, club_key, auth_user_id, manager_id, team_id
  ) values (
    tournament_row.id,
    coalesce(manager_row.display_name, manager_row.name),
    account_row.email,
    clean_team_name,
    target_rating,
    nullif(trim(target_notes), ''),
    'pending',
    public.normal_registration_key(coalesce(manager_row.display_name, manager_row.name)),
    coalesce(lower(account_row.email), ''),
    public.normal_registration_key(clean_team_name),
    user_id,
    manager_row.id,
    team_row_id
  )
  returning * into registration_row;

  return registration_row;
end;
$$;

revoke all on function public.submit_manager_tournament_registration(bigint,text,numeric,text) from public, anon;
grant execute on function public.submit_manager_tournament_registration(bigint,text,numeric,text) to authenticated, service_role;
