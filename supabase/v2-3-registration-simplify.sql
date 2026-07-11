-- Phase V2.3 follow-up: simplify registration and save registration windows reliably.
-- Safe to run repeatedly after supabase/v2-3-registration.sql.

alter table tournament_registrations alter column manager_email drop not null;
alter table tournament_registrations alter column email_key drop not null;

drop index if exists tournament_registrations_active_email_idx;

create or replace function set_registration_keys()
returns trigger
language plpgsql
as $$
begin
  new.manager_name := trim(new.manager_name);
  new.manager_email := nullif(lower(trim(coalesce(new.manager_email, ''))), '');
  new.club_name := trim(new.club_name);
  new.manager_key := normal_registration_key(new.manager_name);
  new.email_key := coalesce(new.manager_email, '');
  new.club_key := normal_registration_key(new.club_name);
  new.updated_at := now();
  return new;
end;
$$;

create or replace function set_tournament_registration_window(
  target_tournament_id bigint,
  next_registration_status text,
  next_registration_opens_at timestamptz,
  next_registration_closes_at timestamptz
)
returns tournaments
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row tournaments%rowtype;
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;

  if next_registration_status not in ('closed', 'open', 'paused', 'full') then
    raise exception 'Invalid registration status';
  end if;

  if next_registration_opens_at is not null
     and next_registration_closes_at is not null
     and next_registration_closes_at <= next_registration_opens_at then
    raise exception 'Registration close date must be after the opening date';
  end if;

  update tournaments
  set registration_status = next_registration_status,
      registration_opens_at = next_registration_opens_at,
      registration_closes_at = next_registration_closes_at
  where id = target_tournament_id
  returning * into updated_row;

  if not found then
    raise exception 'Tournament not found';
  end if;

  return updated_row;
end;
$$;

grant execute on function set_tournament_registration_window(bigint, text, timestamptz, timestamptz) to authenticated;
