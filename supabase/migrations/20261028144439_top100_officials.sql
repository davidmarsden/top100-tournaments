-- Top 100 officials: the administrators' team for compliance alerts.
--
-- is_admin() is full platform administration (sync approval, data maintenance,
-- Manager Lab's private analysis of every club). The officials who handle
-- squad limit, Gold and login alerts are also managers of rival clubs, so they
-- get a narrower role: they see and act on the alerts, and receive the pushes,
-- without becoming platform administrators. Platform administrators are always
-- officials.
--
-- First officials (October 2026): David Marsden, Regan Thompson (Hertha BSC),
-- Hugo Costa (Celtic), Chris Meida (CSKA Moskva).
--
-- Alerts now link to tournaments.smtop100.blog/admin/alerts, and each required
-- sale shows the date Soccer Manager's own transfer ban on the player ends (a
-- week after a deal with a club outside Top 100, a month after one with a Top 100
-- club), read from the synced squad (sourceFields.tbraw).

-- Function bodies read Soccer Manager Sync tables that Manager Lab's migrations create,
-- so they are not checked here (as in the baseline).
SET check_function_bodies = false;

create table public.top100_officials (
  manager_id bigint primary key references public.managers(id),
  role text not null default 'Admin team',
  added_at timestamptz not null default now(),
  added_by uuid
);

comment on table public.top100_officials is 'Managers on the Top 100 admin team: they see and act on compliance alerts without platform administration rights.';

alter table public.top100_officials enable row level security;

create or replace function public.is_top100_official()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.manager_portal_accounts account
    join public.top100_officials official on official.manager_id = account.manager_id
    where account.auth_user_id = auth.uid() and account.active = true
  );
$$;

revoke all on function public.is_top100_official() from public, anon;
grant execute on function public.is_top100_official() to authenticated, service_role;

create policy "Officials read the officials list" on public.top100_officials
  for select to authenticated using (public.is_top100_official());
grant select on public.top100_officials to authenticated;

-- Active Manager Portal accounts of platform administrators and officials: alert recipients.
create or replace function public.top100_official_accounts()
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  select account.id
  from public.manager_portal_accounts account
  where account.active = true
    and (exists (select 1 from public.admin_users admin where admin.user_id = account.auth_user_id)
         or exists (select 1 from public.top100_officials official where official.manager_id = account.manager_id));
$$;

-- @permissions private public.top100_official_accounts: called only by alert functions

alter policy "Admins read squad cap breaches" on public.squad_cap_breaches using (public.is_top100_official());
alter policy "Admins read squad cap exclusions" on public.squad_cap_exclusions using (public.is_top100_official());
alter policy "Admins read manager signal snapshots" on public.manager_signal_snapshots using (public.is_top100_official());
alter policy "Admins read manager signal fields" on public.manager_signal_fields using (public.is_top100_official());
alter policy "Admins read manager signal inventory" on public.manager_signal_inventory using (public.is_top100_official());
alter policy "Admins read admin alert log" on public.admin_alert_log using (public.is_top100_official());
alter policy "Admins read club transfer bans" on public.club_transfer_bans using (public.is_top100_official());
alter policy "Admins read compliance obligations" on public.compliance_obligations using (public.is_top100_official());
alter policy "Admins read compliance events" on public.compliance_events using (public.is_top100_official());

create or replace function public.enqueue_squad_cap_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_breach public.squad_cap_breaches;
  v_account bigint;
  v_count integer := 0;
  v_rules_url constant text := 'https://smtop100.blog/rules/';
  v_admin_url constant text := 'https://tournaments.smtop100.blog/admin/alerts';
begin
  perform public.refresh_squad_cap_breaches('top-100', 50);

  for v_breach in
    select * from public.squad_cap_breaches
    where manager_notified_at is null
      and status <> 'dismissed'
      and not inherited
      and ((confidence = 'confirmed' and status = 'open') or status = 'upheld')
  loop
    for v_account in
      select account.id from public.manager_portal_accounts account
      where account.manager_id = v_breach.manager_id and account.active = true
    loop
      perform public.enqueue_manager_notification(
        v_account, 'admin_alerts',
        'Squad limit: ' || v_breach.club_name,
        public.squad_cap_breach_message(v_breach),
        v_rules_url,
        'squad-cap:' || v_breach.id || ':manager:' || v_account
      );
      v_count := v_count + 1;
    end loop;
    update public.squad_cap_breaches set manager_notified_at = now() where id = v_breach.id;
  end loop;

  for v_breach in
    select * from public.squad_cap_breaches
    where admins_notified_at is null and status <> 'dismissed'
      and (confidence in ('confirmed', 'likely') or status = 'upheld')
  loop
    for v_account in
      select account.id
      from public.top100_official_accounts() account(id)
    loop
      perform public.enqueue_manager_notification(
        v_account, 'admin_alerts',
        case v_breach.confidence
          when 'confirmed' then 'Squad limit breach: '
          when 'likely' then 'Likely squad limit breach: '
          else 'Possible squad limit breach: '
        end || v_breach.club_name || ' (' || v_breach.peak_count || ')',
        case
          when v_breach.inherited then 'Began before ' || coalesce(v_breach.manager_name, 'the current manager') || ' was appointed, so they have not been notified.'
          else coalesce(v_breach.manager_name, 'No manager on record')
            || case when exists (select 1 from public.manager_portal_accounts account
                                 where account.manager_id = v_breach.manager_id and account.active = true)
                 then case when v_breach.confidence = 'confirmed' then ' has been notified.' else ' is notified once you uphold it.' end
                 else ' has no Manager Portal account: contact them directly.' end
        end
          || case when v_breach.status = 'resolved' then ' Already back within the limit.' else '' end,
        v_admin_url,
        'squad-cap:' || v_breach.id || ':admin:' || v_account
      );
      v_count := v_count + 1;
    end loop;
    update public.squad_cap_breaches set admins_notified_at = now() where id = v_breach.id;
  end loop;

  return v_count;
end;
$$;

create or replace function public.review_squad_cap_breach(p_breach_id bigint, p_status text, p_note text default null)
returns public.squad_cap_breaches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.squad_cap_breaches;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can review squad limit breaches.'; end if;
  if p_status not in ('upheld', 'dismissed', 'open') then raise exception 'Unknown status %', p_status; end if;

  update public.squad_cap_breaches
  set status = p_status,
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_breach_id
  returning * into v_row;

  if v_row.id is null then raise exception 'Breach % not found.', p_breach_id; end if;
  return v_row;
end;
$$;

create or replace function public.set_squad_cap_exclusion(
  p_source_club_id text,
  p_source_player_id text,
  p_reason text,
  p_exclude boolean default true,
  p_world_slug text default 'top-100'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_world bigint;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can change squad limit exclusions.'; end if;
  select external_world_id into v_source_world from public.game_worlds where slug = p_world_slug;
  if v_source_world is null then raise exception 'Unknown game world %', p_world_slug; end if;

  if p_exclude then
    if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for the exclusion.'; end if;
    insert into public.squad_cap_exclusions (source_world_id, source_club_id, source_player_id, player_name, reason, created_by)
    select v_source_world, p_source_club_id, p_source_player_id,
      (select player.name || coalesce(' ' || player.surname, '') from public.soccer_manager_players player
        where player.source_player_id = p_source_player_id limit 1),
      trim(p_reason), auth.uid()
    on conflict (source_world_id, source_club_id, source_player_id)
      do update set reason = excluded.reason, excluded_until = null;
  else
    update public.squad_cap_exclusions set excluded_until = current_date
    where source_world_id = v_source_world and source_club_id = p_source_club_id and source_player_id = p_source_player_id;
  end if;
end;
$$;

create or replace function public.squad_cap_overview(p_world_slug text default 'top-100')
returns table (
  club_name text,
  manager_name text,
  division integer,
  players integer,
  squad_limit integer,
  captured_at timestamptz,
  open_breaches integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can view squad compliance.'; end if;

  return query
  with world as (
    select id, external_world_id from public.game_worlds where slug = p_world_slug
  ),
  latest as (
    select distinct on (change.after_data->>'clubId')
      change.after_data->>'clubId' as club,
      (change.after_data->>'playerCount')::integer
        - (select count(*)::integer
           from jsonb_array_elements_text(coalesce(change.after_data->'rosterPlayerIds', '[]'::jsonb)) roster(player_id)
           join public.squad_cap_exclusions exclusion
             on exclusion.source_world_id = world.external_world_id
            and exclusion.source_club_id = change.after_data->>'clubId'
            and exclusion.source_player_id = roster.player_id
            and (exclusion.excluded_until is null or exclusion.excluded_until >= current_date)) as n,
      run.captured_at
    from public.soccer_manager_sync_changes change
    join public.soccer_manager_sync_runs run on run.id = change.run_id
    cross join world
    where change.entity_type = 'squad_scope' and change.status = 'approved'
      and change.after_data->>'setupId' = world.external_world_id::text
      and change.after_data->>'playerCount' ~ '^[0-9]+$'
    order by change.after_data->>'clubId', run.captured_at desc, change.id desc
  )
  select coalesce(crosswalk.source_club_name, 'Club ' || latest.club),
    coalesce(manager.display_name, manager.name, assignment.source_manager_name),
    club.division,
    latest.n,
    50,
    latest.captured_at,
    (select count(*)::integer from public.squad_cap_breaches breach
      where breach.source_world_id = world.external_world_id and breach.source_club_id = latest.club
        and breach.status in ('open', 'upheld'))
  from latest
  cross join world
  left join public.soccer_manager_club_crosswalk crosswalk
    on crosswalk.source_world_id = world.external_world_id and crosswalk.source_club_id = latest.club
  left join public.game_world_clubs club on club.id = crosswalk.game_world_club_id
  left join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = world.id and assignment.team_id = crosswalk.team_id
  left join public.managers manager on manager.id = assignment.manager_id
  order by latest.n desc, 1;
end;
$$;

create or replace function public.confirm_manager_signal_field(p_key text, p_confirmed boolean)
returns public.manager_signal_fields
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.manager_signal_fields;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can confirm signal fields.'; end if;

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
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can view manager status.'; end if;
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
    select account.id from public.top100_official_accounts() account(id)
  loop
    perform public.enqueue_manager_notification(v_account, 'admin_alerts', p_title, p_body,
      'https://tournaments.smtop100.blog/admin/alerts', p_dedupe || ':admin:' || v_account);
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

create or replace function public.acknowledge_admin_alert(p_alert_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can acknowledge alerts.'; end if;
  update public.admin_alert_log set acknowledged_by = auth.uid(), acknowledged_at = now() where id = p_alert_id;
end;
$$;

create or replace function public.raise_compliance_event(
  p_kind text, p_severity text, p_club_id text, p_club text, p_title text, p_body text, p_related jsonb, p_dedupe text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account bigint;
  v_count integer := 0;
begin
  insert into public.compliance_events (kind, severity, source_club_id, club_name, title, body, related, dedupe_key)
  values (p_kind, p_severity, p_club_id, p_club, p_title, p_body, coalesce(p_related, '{}'::jsonb), p_dedupe)
  on conflict (dedupe_key) do nothing;
  if not found then return 0; end if;

  for v_account in
    select account.id from public.top100_official_accounts() account(id)
  loop
    perform public.enqueue_manager_notification(v_account, 'admin_alerts', p_title, p_body,
      'https://tournaments.smtop100.blog/admin/alerts', p_dedupe || ':admin:' || v_account);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.set_club_transfer_ban(
  p_source_club_id text, p_starts_on date, p_ends_on date, p_reason text,
  p_terms text default 'external_cash_sales_only', p_breach_id bigint default null, p_world_slug text default 'top-100'
) returns public.club_transfer_bans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_world bigint;
  v_row public.club_transfer_bans;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can set transfer bans.'; end if;
  select external_world_id into v_source_world from public.game_worlds where slug = p_world_slug;
  insert into public.club_transfer_bans (source_world_id, source_club_id, club_name, starts_on, ends_on, terms, reason, breach_id, created_by)
  values (v_source_world, p_source_club_id,
    coalesce((select source_club_name from public.soccer_manager_club_crosswalk where source_world_id = v_source_world and source_club_id = p_source_club_id), 'Club ' || p_source_club_id),
    p_starts_on, p_ends_on, p_terms, p_reason, p_breach_id, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.add_compliance_obligation(
  p_source_club_id text, p_source_player_id text, p_requirement text, p_no_rebid boolean, p_reason text,
  p_breach_id bigint default null, p_world_slug text default 'top-100'
) returns public.compliance_obligations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_world bigint;
  v_row public.compliance_obligations;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can add required sales.'; end if;
  select external_world_id into v_source_world from public.game_worlds where slug = p_world_slug;
  insert into public.compliance_obligations (source_world_id, source_club_id, club_name, source_player_id, player_name, requirement, no_rebid, reason, breach_id, created_by)
  values (v_source_world, p_source_club_id,
    coalesce((select source_club_name from public.soccer_manager_club_crosswalk where source_world_id = v_source_world and source_club_id = p_source_club_id), 'Club ' || p_source_club_id),
    p_source_player_id,
    (select player.name || coalesce(' ' || player.surname, '') from public.soccer_manager_players player where player.source_player_id = p_source_player_id limit 1),
    p_requirement, p_no_rebid, p_reason, p_breach_id, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.set_compliance_obligation_status(p_obligation_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can change required sales.'; end if;
  if p_status not in ('open', 'waived', 'met', 'breached') then raise exception 'Unknown status %', p_status; end if;
  update public.compliance_obligations set status = p_status, resolved_at = case when p_status = 'open' then null else now() end where id = p_obligation_id;
end;
$$;

create or replace function public.acknowledge_compliance_event(p_event_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can acknowledge alerts.'; end if;
  update public.compliance_events set acknowledged_by = auth.uid(), acknowledged_at = now() where id = p_event_id;
end;
$$;

-- Required sales with the date the player becomes sellable: Soccer Manager's own
-- transfer ban on the player, from the latest synced squad.
create or replace function public.compliance_obligation_overview(p_world_slug text default 'top-100')
returns table (
  id bigint,
  club_name text,
  source_club_id text,
  player_name text,
  source_player_id text,
  requirement text,
  no_rebid boolean,
  reason text,
  status text,
  resolved_transfer jsonb,
  sellable_from timestamptz,
  player_banned boolean,
  checked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can view required sales.'; end if;
  return query
  select obligation.id, obligation.club_name, obligation.source_club_id, obligation.player_name, obligation.source_player_id,
    obligation.requirement, obligation.no_rebid, obligation.reason, obligation.status, obligation.resolved_transfer,
    case when latest.fields->>'tbraw' ~ '^[0-9]+$' then to_timestamp((latest.fields->>'tbraw')::bigint) end,
    coalesce((latest.fields->>'tban')::boolean, false),
    latest.captured_at
  from public.compliance_obligations obligation
  cross join (select id, external_world_id from public.game_worlds where slug = p_world_slug) world
  left join lateral (
    select snapshot.source_data->'sourceFields' as fields, snapshot.captured_at
    from public.soccer_manager_player_snapshots snapshot
    where snapshot.game_world_id = world.id and snapshot.source_data->>'playerDataId' = obligation.source_player_id
    order by snapshot.captured_at desc limit 1
  ) latest on true
  where obligation.source_world_id = world.external_world_id
  order by obligation.status = 'open' desc, 11 nulls last, obligation.club_name;
end;
$$;

revoke all on function public.compliance_obligation_overview(text) from public, anon;
grant execute on function public.compliance_obligation_overview(text) to authenticated;

insert into public.top100_officials (manager_id)
select id from public.managers where id in (108, 125, 88, 74)
on conflict do nothing;

RESET check_function_bodies;
