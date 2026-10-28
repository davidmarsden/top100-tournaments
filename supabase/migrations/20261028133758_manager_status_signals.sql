-- Gold membership and login monitoring.
--
-- Managers without Gold cannot complete transfers with other managers and have
-- fewer tactical options; Soccer Manager auto-sacks a manager who has not
-- logged in to the game world for ten consecutive days. Neither status is
-- enforceable by Top 100 beyond end-of-season sackings, so the aim is early
-- warning for the manager and the administrators.
--
-- Sync everything sends, per club, every raw Soccer Manager field whose name
-- looks like membership or login data, with its value and reading
-- (top100-manager-lab src/lib/managerSignals.js), plus an inventory of field
-- names seen. Which field really holds Gold or last login is not documented,
-- so nothing is read from a field until an administrator confirms it
-- (manager_signal_fields.confirmed, on lab.smtop100.blog/alerts).
--
-- enqueue_manager_status_alerts() (every five minutes, push-dispatch-scheduled):
--   - Gold lost or gained: the manager and the administrators;
--   - no login for 7 days: the manager (warning) and the administrators;
--   - no login for 10 days: the administrators (Soccer Manager auto-sacks).
-- Every alert is also kept in admin_alert_log for the administrators' page.

create table public.manager_signal_snapshots (
  id bigint generated always as identity primary key,
  game_world_id bigint references public.game_worlds(id),
  source_world_id bigint not null,
  source_club_id text not null,
  sm_manager_id text,
  manager_id bigint references public.managers(id),
  club_name text,
  captured_at timestamptz not null,
  fields jsonb not null default '[]'::jsonb,
  gold boolean,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_world_id, source_club_id, captured_at)
);

create index manager_signal_snapshots_manager on public.manager_signal_snapshots (source_world_id, sm_manager_id, captured_at desc);

create table public.manager_signal_fields (
  key text primary key,
  kind text not null check (kind in ('gold', 'login')),
  confirmed boolean not null default false,
  example jsonb,
  clubs_seen integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz
);

create table public.manager_signal_inventory (
  source text not null,
  field text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (source, field)
);

create table public.admin_alert_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('gold', 'login')),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  game_world_id bigint references public.game_worlds(id),
  club_name text,
  manager_id bigint references public.managers(id),
  manager_name text,
  title text not null,
  body text not null,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  acknowledged_by uuid,
  acknowledged_at timestamptz
);

comment on table public.manager_signal_snapshots is 'Gold/login candidate fields per club per sync, with readings from administrator-confirmed fields only.';
comment on table public.manager_signal_fields is 'Raw Soccer Manager fields that may hold Gold membership or last login. Only confirmed fields are read.';
comment on table public.manager_signal_inventory is 'Field names seen in the raw responses Sync everything reads, for finding the Gold and login fields.';
comment on table public.admin_alert_log is 'Gold and login alerts raised for administrators (squad limit breaches live in squad_cap_breaches).';

alter table public.manager_signal_snapshots enable row level security;
alter table public.manager_signal_fields enable row level security;
alter table public.manager_signal_inventory enable row level security;
alter table public.admin_alert_log enable row level security;
create policy "Admins read manager signal snapshots" on public.manager_signal_snapshots for select to authenticated using (public.is_admin());
create policy "Admins read manager signal fields" on public.manager_signal_fields for select to authenticated using (public.is_admin());
create policy "Admins read manager signal inventory" on public.manager_signal_inventory for select to authenticated using (public.is_admin());
create policy "Admins read admin alert log" on public.admin_alert_log for select to authenticated using (public.is_admin());
grant select on public.manager_signal_snapshots, public.manager_signal_fields, public.manager_signal_inventory, public.admin_alert_log to authenticated;

-- Called by the Sync page (an administrator) after Sync everything.
create or replace function public.record_soccer_manager_manager_signals(
  target_setup_id text,
  target_captured_at timestamptz,
  target_signals jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_world bigint;
  v_world_id bigint;
  v_captured timestamptz := coalesce(target_captured_at, now());
  v_rows integer;
begin
  if not public.is_admin() then raise exception 'Only administrators can record Soccer Manager data.'; end if;
  if target_setup_id !~ '^[0-9]+$' then raise exception 'Invalid setup id %', target_setup_id; end if;
  v_source_world := target_setup_id::bigint;
  select id into v_world_id from public.game_worlds where external_world_id = v_source_world;

  insert into public.manager_signal_inventory (source, field)
  select source.key, field.value
  from jsonb_each(coalesce(target_signals->'inventory', '{}'::jsonb)) source
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(source.value) = 'array' then source.value else '[]'::jsonb end) field
  on conflict (source, field) do update set last_seen_at = now();

  with manager_rows as (
    select row.value as manager from jsonb_array_elements(coalesce(target_signals->'managers', '[]'::jsonb)) row
  ),
  fields as (
    select manager->>'clubId' as club, field.value as field
    from manager_rows cross join lateral jsonb_array_elements(coalesce(manager->'fields', '[]'::jsonb)) field
    where field.value->>'kind' in ('gold', 'login') and coalesce(field.value->>'key', '') <> ''
  )
  insert into public.manager_signal_fields as known (key, kind, example, clubs_seen)
  select field->>'key', min(field->>'kind'), (array_agg(field order by club))[1], count(distinct club)::integer
  from fields group by field->>'key'
  on conflict (key) do update set last_seen_at = now(), clubs_seen = excluded.clubs_seen, example = excluded.example;

  with manager_rows as (
    select row.value as manager from jsonb_array_elements(coalesce(target_signals->'managers', '[]'::jsonb)) row
    where coalesce(row.value->>'clubId', '') <> ''
  ),
  readings as (
    select manager_rows.manager,
      (select (field->>'gold')::boolean
         from jsonb_array_elements(coalesce(manager_rows.manager->'fields', '[]'::jsonb)) field
         join public.manager_signal_fields known on known.key = field->>'key' and known.confirmed and known.kind = 'gold'
        where field->>'gold' in ('true', 'false') limit 1) as gold,
      (select max((field->>'loginAt')::timestamptz)
         from jsonb_array_elements(coalesce(manager_rows.manager->'fields', '[]'::jsonb)) field
         join public.manager_signal_fields known on known.key = field->>'key' and known.confirmed and known.kind = 'login'
        where coalesce(field->>'loginAt', '') <> '') as last_login_at
    from manager_rows
  )
  insert into public.manager_signal_snapshots (
    game_world_id, source_world_id, source_club_id, sm_manager_id, manager_id, club_name, captured_at, fields, gold, last_login_at
  )
  select v_world_id, v_source_world, readings.manager->>'clubId', nullif(readings.manager->>'managerId', ''),
    assignment.manager_id, crosswalk.source_club_name, v_captured,
    coalesce(readings.manager->'fields', '[]'::jsonb), readings.gold, readings.last_login_at
  from readings
  left join public.soccer_manager_club_crosswalk crosswalk
    on crosswalk.source_world_id = v_source_world and crosswalk.source_club_id = readings.manager->>'clubId'
  left join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = v_world_id and assignment.team_id = crosswalk.team_id
  on conflict (source_world_id, source_club_id, captured_at) do update set
    fields = excluded.fields, gold = excluded.gold, last_login_at = excluded.last_login_at, sm_manager_id = excluded.sm_manager_id;
  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'managers', v_rows,
    'candidateFields', (select count(*) from public.manager_signal_fields),
    'confirmedFields', (select count(*) from public.manager_signal_fields where confirmed)
  );
end;
$$;

revoke all on function public.record_soccer_manager_manager_signals(text, timestamptz, jsonb) from public, anon;
grant execute on function public.record_soccer_manager_manager_signals(text, timestamptz, jsonb) to authenticated;

-- Administrator: confirm (or withdraw) a field as the source of Gold or last login.
-- Confirming re-reads the stored snapshots so status is known from the first sync onwards.
create or replace function public.confirm_manager_signal_field(p_key text, p_confirmed boolean)
returns public.manager_signal_fields
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.manager_signal_fields;
begin
  if not public.is_admin() then raise exception 'Only administrators can confirm signal fields.'; end if;

  update public.manager_signal_fields
  set confirmed = p_confirmed, confirmed_by = auth.uid(), confirmed_at = now()
  where key = p_key
  returning * into v_row;
  if v_row.key is null then raise exception 'Unknown field %', p_key; end if;

  update public.manager_signal_snapshots snapshot
  set gold = (select (field->>'gold')::boolean
                from jsonb_array_elements(snapshot.fields) field
                join public.manager_signal_fields known on known.key = field->>'key' and known.confirmed and known.kind = 'gold'
               where field->>'gold' in ('true', 'false') limit 1),
      last_login_at = (select max((field->>'loginAt')::timestamptz)
                         from jsonb_array_elements(snapshot.fields) field
                         join public.manager_signal_fields known on known.key = field->>'key' and known.confirmed and known.kind = 'login'
                        where coalesce(field->>'loginAt', '') <> '');

  return v_row;
end;
$$;

revoke all on function public.confirm_manager_signal_field(text, boolean) from public, anon;
grant execute on function public.confirm_manager_signal_field(text, boolean) to authenticated;

-- Latest Gold and login status of every manager in a world.
create or replace function public.manager_status_overview(p_world_slug text default 'top-100')
returns table (
  club_name text,
  manager_name text,
  sm_manager_id text,
  gold boolean,
  gold_changed_at timestamptz,
  last_login_at timestamptz,
  days_since_login numeric,
  captured_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only administrators can view manager status.'; end if;
  return query
  with world as (select id, external_world_id from public.game_worlds where slug = p_world_slug),
  latest as (
    select distinct on (snapshot.source_club_id) snapshot.*
    from public.manager_signal_snapshots snapshot cross join world
    where snapshot.source_world_id = world.external_world_id
    order by snapshot.source_club_id, snapshot.captured_at desc
  )
  select latest.club_name,
    coalesce(manager.display_name, manager.name),
    latest.sm_manager_id,
    latest.gold,
    (select min(later.captured_at) from public.manager_signal_snapshots later
      where later.source_world_id = latest.source_world_id and later.sm_manager_id = latest.sm_manager_id
        and later.gold is not distinct from latest.gold
        and later.captured_at > coalesce((select max(earlier.captured_at) from public.manager_signal_snapshots earlier
          where earlier.source_world_id = latest.source_world_id and earlier.sm_manager_id = latest.sm_manager_id
            and earlier.gold is not null and earlier.gold is distinct from latest.gold), '-infinity')),
    latest.last_login_at,
    round(extract(epoch from now() - latest.last_login_at)::numeric / 86400, 1),
    latest.captured_at
  from latest
  left join public.managers manager on manager.id = latest.manager_id
  order by latest.gold nulls first, latest.last_login_at nulls first;
end;
$$;

revoke all on function public.manager_status_overview(text) from public, anon;
grant execute on function public.manager_status_overview(text) to authenticated;

-- One alert: logged for the administrators' page, pushed to every administrator
-- and, when p_tell_manager, to the manager's own Manager Portal accounts.
create or replace function public.raise_manager_status_alert(
  p_kind text, p_severity text, p_world_id bigint, p_club text, p_manager_id bigint, p_manager_name text,
  p_title text, p_body text, p_manager_body text, p_dedupe text, p_tell_manager boolean
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account bigint;
  v_count integer := 0;
begin
  insert into public.admin_alert_log (kind, severity, game_world_id, club_name, manager_id, manager_name, title, body, dedupe_key)
  values (p_kind, p_severity, p_world_id, p_club, p_manager_id, p_manager_name, p_title, p_body, p_dedupe)
  on conflict (dedupe_key) do nothing;
  if not found then return 0; end if;

  for v_account in
    select account.id from public.manager_portal_accounts account
    join public.admin_users admin on admin.user_id = account.auth_user_id
    where account.active = true
  loop
    perform public.enqueue_manager_notification(v_account, 'admin_alerts', p_title, p_body,
      'https://lab.smtop100.blog/alerts', p_dedupe || ':admin:' || v_account);
    v_count := v_count + 1;
  end loop;

  if p_tell_manager and p_manager_id is not null then
    for v_account in
      select account.id from public.manager_portal_accounts account
      where account.manager_id = p_manager_id and account.active = true
    loop
      perform public.enqueue_manager_notification(v_account, 'admin_alerts', p_title, p_manager_body,
        'https://smtop100.blog/rules/', p_dedupe || ':manager:' || v_account);
      v_count := v_count + 1;
    end loop;
  end if;
  return v_count;
end;
$$;

-- @permissions private public.raise_manager_status_alert: called only by enqueue_manager_status_alerts()

create or replace function public.enqueue_manager_status_alerts(p_world_slug text default 'top-100')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world_id bigint;
  v_source_world bigint;
  v_row record;
  v_count integer := 0;
  v_name text;
begin
  select id, external_world_id into v_world_id, v_source_world from public.game_worlds where slug = p_world_slug;
  if v_world_id is null then return 0; end if;

  -- Gold changes: each pair of consecutive known readings for a manager that differ.
  for v_row in
    with known as (
      select snapshot.*, lag(snapshot.gold) over (partition by snapshot.sm_manager_id order by snapshot.captured_at) as previous_gold
      from public.manager_signal_snapshots snapshot
      where snapshot.source_world_id = v_source_world and snapshot.sm_manager_id is not null and snapshot.gold is not null
    )
    select * from known where previous_gold is not null and gold is distinct from previous_gold
  loop
    select coalesce(display_name, name) into v_name from public.managers where id = v_row.manager_id;
    v_count := v_count + public.raise_manager_status_alert(
      'gold', case when v_row.gold then 'info' else 'warning' end, v_world_id, v_row.club_name, v_row.manager_id, v_name,
      case when v_row.gold then 'Gold restored: ' else 'Gold membership lapsed: ' end || coalesce(v_row.club_name, 'unknown club'),
      coalesce(v_name, 'The manager') || case when v_row.gold then ' is a Gold member again.' else ' is no longer a Gold member.' end,
      case when v_row.gold
        then 'Thanks for renewing Gold. Transfers with other managers and all tactical options are available again.'
        else 'Your Gold membership appears to have lapsed. Without Gold you cannot complete transfers with other managers and your tactical options are limited, which makes your club far less competitive. Please renew it as soon as you can.'
      end,
      'gold:' || v_row.sm_manager_id || ':' || to_char(v_row.captured_at at time zone 'UTC', 'YYYYMMDDHH24MISS'),
      true);
  end loop;

  -- Logins: 7 days warns the manager and the administrators; 10 days is Soccer Manager's auto-sack.
  for v_row in
    select distinct on (snapshot.source_club_id) snapshot.*
    from public.manager_signal_snapshots snapshot
    where snapshot.source_world_id = v_source_world and snapshot.last_login_at is not null
    order by snapshot.source_club_id, snapshot.captured_at desc
  loop
    select coalesce(display_name, name) into v_name from public.managers where id = v_row.manager_id;
    if v_row.last_login_at <= now() - interval '10 days' then
      v_count := v_count + public.raise_manager_status_alert(
        'login', 'critical', v_world_id, v_row.club_name, v_row.manager_id, v_name,
        'No login for 10 days: ' || coalesce(v_row.club_name, 'unknown club'),
        coalesce(v_name, 'The manager') || ' last logged in on ' || to_char(v_row.last_login_at at time zone 'Europe/London', 'FMDD Mon')
          || '. Soccer Manager auto-sacks after ten consecutive days.',
        null,
        'login10:' || coalesce(v_row.sm_manager_id, v_row.source_club_id) || ':' || to_char(v_row.last_login_at at time zone 'UTC', 'YYYYMMDDHH24MI'),
        false);
    elsif v_row.last_login_at <= now() - interval '7 days' then
      v_count := v_count + public.raise_manager_status_alert(
        'login', 'warning', v_world_id, v_row.club_name, v_row.manager_id, v_name,
        'No login for 7 days: ' || coalesce(v_row.club_name, 'unknown club'),
        coalesce(v_name, 'The manager') || ' last logged in on ' || to_char(v_row.last_login_at at time zone 'Europe/London', 'FMDD Mon')
          || '. Soccer Manager auto-sacks after ten consecutive days.',
        'You have not logged in to Top 100 since ' || to_char(v_row.last_login_at at time zone 'Europe/London', 'FMDD Mon')
          || '. Soccer Manager automatically sacks managers who stay away for ten consecutive days, so please log in soon.',
        'login7:' || coalesce(v_row.sm_manager_id, v_row.source_club_id) || ':' || to_char(v_row.last_login_at at time zone 'UTC', 'YYYYMMDDHH24MI'),
        true);
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.enqueue_manager_status_alerts(text) from public, anon, authenticated;
grant execute on function public.enqueue_manager_status_alerts(text) to service_role;

-- Administrator: mark an alert as seen on the alerts page.
create or replace function public.acknowledge_admin_alert(p_alert_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only administrators can acknowledge alerts.'; end if;
  update public.admin_alert_log set acknowledged_by = auth.uid(), acknowledged_at = now() where id = p_alert_id;
end;
$$;

revoke all on function public.acknowledge_admin_alert(bigint) from public, anon;
grant execute on function public.acknowledge_admin_alert(bigint) to authenticated;
