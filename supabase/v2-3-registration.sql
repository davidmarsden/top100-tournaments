-- Phase V2.3: tournament registration
-- Public submissions are accepted through the Netlify registration function.
-- Admins review registrations here and promote approved rows into tournament_entries.
-- Safe to run repeatedly.

create table if not exists tournament_registrations (
  id bigserial primary key,
  tournament_id bigint not null references tournaments(id) on delete cascade,
  manager_name text not null,
  manager_email text not null,
  club_name text not null,
  rating numeric,
  notes text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  manager_key text not null,
  email_key text not null,
  club_key text not null,
  duplicate_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_notes text,
  promoted_entry_id bigint references tournament_entries(id) on delete set null,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tournament_registrations_tournament_status_idx
  on tournament_registrations(tournament_id, status, submitted_at desc);

create unique index if not exists tournament_registrations_active_manager_idx
  on tournament_registrations(tournament_id, manager_key)
  where status in ('pending', 'approved');

create unique index if not exists tournament_registrations_active_email_idx
  on tournament_registrations(tournament_id, email_key)
  where status in ('pending', 'approved');

create unique index if not exists tournament_registrations_active_club_idx
  on tournament_registrations(tournament_id, club_key)
  where status in ('pending', 'approved');

create or replace function normal_registration_key(value text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(coalesce(value, ''))), '[^a-z0-9]+', '', 'g');
$$;

create or replace function set_registration_keys()
returns trigger
language plpgsql
as $$
begin
  new.manager_name := trim(new.manager_name);
  new.manager_email := lower(trim(new.manager_email));
  new.club_name := trim(new.club_name);
  new.manager_key := normal_registration_key(new.manager_name);
  new.email_key := lower(trim(new.manager_email));
  new.club_key := normal_registration_key(new.club_name);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tournament_registrations_keys_trigger on tournament_registrations;
create trigger tournament_registrations_keys_trigger
before insert or update of manager_name, manager_email, club_name, status, review_notes
on tournament_registrations
for each row execute function set_registration_keys();

alter table tournament_registrations enable row level security;

drop policy if exists "Admins read registrations" on tournament_registrations;
create policy "Admins read registrations"
  on tournament_registrations for select
  to authenticated
  using (is_admin());

drop policy if exists "Admins update registrations" on tournament_registrations;
create policy "Admins update registrations"
  on tournament_registrations for update
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "Admins delete registrations" on tournament_registrations;
create policy "Admins delete registrations"
  on tournament_registrations for delete
  to authenticated
  using (is_admin());

create or replace function promote_registration_to_entrant(registration_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  registration_row tournament_registrations%rowtype;
  team_row_id bigint;
  manager_row_id bigint;
  entry_row_id bigint;
  next_seed integer;
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;

  select * into registration_row
  from tournament_registrations
  where id = registration_id
  for update;

  if not found then
    raise exception 'Registration not found';
  end if;

  if registration_row.status <> 'approved' then
    raise exception 'Registration must be approved first';
  end if;

  if registration_row.promoted_entry_id is not null then
    return registration_row.promoted_entry_id;
  end if;

  select id into team_row_id
  from teams
  where normal_registration_key(name) = registration_row.club_key
  order by id
  limit 1;

  if team_row_id is null then
    insert into teams(name, active)
    values (registration_row.club_name, true)
    returning id into team_row_id;
  end if;

  select id into manager_row_id
  from managers
  where normal_registration_key(coalesce(display_name, name)) = registration_row.manager_key
  order by id
  limit 1;

  if manager_row_id is null then
    insert into managers(name, display_name, canonical_name, active)
    values (
      registration_row.manager_name,
      registration_row.manager_name,
      lower(registration_row.manager_name),
      true
    )
    returning id into manager_row_id;
  end if;

  select id into entry_row_id
  from tournament_entries
  where tournament_id = registration_row.tournament_id
    and (team_id = team_row_id or manager_id = manager_row_id)
  limit 1;

  if entry_row_id is null then
    select coalesce(max(seed), 0) + 1 into next_seed
    from tournament_entries
    where tournament_id = registration_row.tournament_id;

    insert into tournament_entries(
      tournament_id,
      team_id,
      manager_id,
      seed,
      rating,
      entry_status,
      prize_draw_eligible,
      notes
    ) values (
      registration_row.tournament_id,
      team_row_id,
      manager_row_id,
      next_seed,
      registration_row.rating,
      'active',
      true,
      'Promoted from registration #' || registration_row.id || ' · ' || registration_row.manager_email
    )
    returning id into entry_row_id;
  end if;

  update tournament_registrations
  set promoted_entry_id = entry_row_id,
      promoted_at = now(),
      reviewed_at = coalesce(reviewed_at, now()),
      reviewed_by = coalesce(reviewed_by, auth.uid())
  where id = registration_row.id;

  update tournaments t
  set actual_entries = (
    select count(*) from tournament_entries te where te.tournament_id = t.id
  )
  where t.id = registration_row.tournament_id;

  return entry_row_id;
end;
$$;

grant execute on function promote_registration_to_entrant(bigint) to authenticated;
