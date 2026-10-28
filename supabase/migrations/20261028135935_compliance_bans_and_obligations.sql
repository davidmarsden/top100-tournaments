-- Follow-through on squad limit breaches: bans and required sales.
--
-- The S28 precedent (rule 4.1) has three parts, and each needs watching:
--   1. the squad comes back within 50;
--   2. a one-month transfer ban, during which only cash sales to clubs outside
--      Top 100 are allowed;
--   3. the signing that took the club over is sold to a club outside Top 100
--      for cash when its own transfer ban ends, and the club never bids for
--      that player again.
--
-- club_transfer_bans and compliance_obligations record what the administrators
-- decided. enqueue_compliance_events() checks every sync against them and
-- raises compliance_events, pushed to administrators:
--   cap_cleared          a confirmed breach is back within the limit;
--   ban_breach           a deal during a ban outside its terms;
--   obligation_met       a required sale made as required;
--   obligation_breached  a required sale made the wrong way (to a Top 100
--                        manager, free or on loan);
--   rebid                the club signs a player it was told never to bid for again.

-- Function bodies read Soccer Manager Sync tables that Manager Lab's migrations create,
-- so they are not checked here (as in the baseline).
SET check_function_bodies = false;

create table public.club_transfer_bans (
  id bigint generated always as identity primary key,
  source_world_id bigint not null,
  source_club_id text not null,
  club_name text not null,
  starts_on date not null,
  ends_on date not null,
  terms text not null default 'external_cash_sales_only' check (terms in ('external_cash_sales_only', 'no_transfers')),
  reason text not null,
  breach_id bigint references public.squad_cap_breaches(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table public.compliance_obligations (
  id bigint generated always as identity primary key,
  source_world_id bigint not null,
  source_club_id text not null,
  club_name text not null,
  source_player_id text not null,
  player_name text,
  requirement text not null check (requirement in ('sell_external_cash', 'sell')),
  no_rebid boolean not null default false,
  reason text not null,
  breach_id bigint references public.squad_cap_breaches(id),
  status text not null default 'open' check (status in ('open', 'met', 'breached', 'waived')),
  resolved_transfer jsonb,
  resolved_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (source_world_id, source_club_id, source_player_id)
);

create table public.compliance_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('cap_cleared', 'ban_breach', 'obligation_met', 'obligation_breached', 'rebid')),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  source_club_id text,
  club_name text,
  title text not null,
  body text not null,
  related jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  acknowledged_by uuid,
  acknowledged_at timestamptz
);

comment on table public.club_transfer_bans is 'Club transfer bans set by administrators, checked against every sync.';
comment on table public.compliance_obligations is 'Sales a club must make (for example the signing that took it over 50), checked against every sync.';
comment on table public.compliance_events is 'What the checks found: squads back within the limit, deals during bans, required sales made or broken.';

alter table public.club_transfer_bans enable row level security;
alter table public.compliance_obligations enable row level security;
alter table public.compliance_events enable row level security;
create policy "Admins read club transfer bans" on public.club_transfer_bans for select to authenticated using (public.is_admin());
create policy "Admins read compliance obligations" on public.compliance_obligations for select to authenticated using (public.is_admin());
create policy "Admins read compliance events" on public.compliance_events for select to authenticated using (public.is_admin());
grant select on public.club_transfer_bans, public.compliance_obligations, public.compliance_events to authenticated;

-- Every transfer in a world, dated, with the Soccer Manager player and manager ids.
-- A manager id of 0 is a club outside Top 100 (or a free agent).
create or replace function public.compliance_transfers(p_world_id bigint)
returns table (
  transfer_id text, player_id text, player_name text, d date, status integer, status_label text,
  from_club_id text, from_club_name text, from_manager text, to_club_id text, to_club_name text, to_manager text, amount bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(transfer.source_transfer_id, transfer.source_data->>'transferId'),
    transfer.source_data->>'playerId', transfer.player_name,
    case when parsed.d > transfer.first_seen_at::date + 1 then (parsed.d - interval '1 year')::date else parsed.d end,
    transfer.status, transfer.status_label,
    transfer.from_source_club_id, transfer.from_club_name, coalesce(transfer.source_data->>'fromManagerId', '0'),
    transfer.to_source_club_id, transfer.to_club_name, coalesce(transfer.source_data->>'toManagerId', '0'),
    transfer.amount
  from public.soccer_manager_transfers transfer
  cross join lateral (
    select to_date(transfer.accepted_date || ' ' || extract(year from transfer.first_seen_at)::integer, 'Mon DD YYYY') as d
  ) parsed
  where transfer.game_world_id = p_world_id
    and transfer.status in (3, 9)
    and transfer.accepted_date ~ '^[A-Z][a-z]{2} [0-9]{1,2}$';
$$;

-- @permissions private public.compliance_transfers: called only by enqueue_compliance_events()

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
    select account.id from public.manager_portal_accounts account
    join public.admin_users admin on admin.user_id = account.auth_user_id
    where account.active = true
  loop
    perform public.enqueue_manager_notification(v_account, 'admin_alerts', p_title, p_body,
      'https://lab.smtop100.blog/alerts', p_dedupe || ':admin:' || v_account);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- @permissions private public.raise_compliance_event: called only by enqueue_compliance_events()

create or replace function public.enqueue_compliance_events(p_world_slug text default 'top-100')
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
  v_amount text;
begin
  select id, external_world_id into v_world_id, v_source_world from public.game_worlds where slug = p_world_slug;
  if v_world_id is null then return 0; end if;

  -- 1. Confirmed breaches that are back within the limit.
  for v_row in
    select breach.* from public.squad_cap_breaches breach
    where breach.source_world_id = v_source_world and breach.confidence = 'confirmed'
      and breach.resolved_at is not null and breach.status <> 'dismissed'
  loop
    v_count := v_count + public.raise_compliance_event(
      'cap_cleared', 'info', v_row.source_club_id, v_row.club_name,
      'Back within the squad limit: ' || v_row.club_name,
      v_row.club_name || ' is back to 50 or fewer players (sync of ' || to_char(v_row.resolved_at at time zone 'Europe/London', 'FMDD Mon')
        || ', after a peak of ' || v_row.peak_count || ').'
        || case when v_row.inherited then ' The breach began before the current manager was appointed.' else '' end,
      jsonb_build_object('breach_id', v_row.id),
      'cap-cleared:' || v_row.id);
  end loop;

  -- 2. Deals during a ban that its terms do not allow.
  for v_row in
    select ban.id as ban_id, ban.club_name as ban_club, ban.source_club_id as ban_club_id, ban.terms, ban.ends_on, deal.*
    from public.club_transfer_bans ban
    join public.compliance_transfers(v_world_id) deal
      on deal.d between ban.starts_on and ban.ends_on
     and (deal.to_club_id = ban.source_club_id or deal.from_club_id = ban.source_club_id)
    where ban.source_world_id = v_source_world
      and (ban.terms = 'no_transfers'
           or deal.to_club_id = ban.source_club_id
           or deal.to_manager <> '0'
           or coalesce(deal.amount, 0) = 0)
  loop
    v_amount := case when coalesce(v_row.amount, 0) > 0 then to_char(v_row.amount, 'FM999,999,999,999') else 'no fee' end;
    v_count := v_count + public.raise_compliance_event(
      'ban_breach', 'critical', v_row.ban_club_id, v_row.ban_club,
      'Deal during a transfer ban: ' || v_row.ban_club,
      v_row.ban_club || case when v_row.to_club_id = v_row.ban_club_id then ' signed ' else ' sold ' end
        || coalesce(v_row.player_name, 'a player')
        || case when v_row.to_club_id = v_row.ban_club_id then ' from ' || coalesce(v_row.from_club_name, '?') else ' to ' || coalesce(v_row.to_club_name, '?') end
        || ' (' || v_amount || ', ' || to_char(v_row.d, 'FMDD Mon') || ', ' || coalesce(v_row.status_label, 'deal') || ') while banned until '
        || to_char(v_row.ends_on, 'FMDD Mon')
        || case v_row.terms when 'external_cash_sales_only' then '. Only cash sales to clubs outside Top 100 are allowed.' else '. No deals are allowed.' end,
      jsonb_build_object('ban_id', v_row.ban_id, 'transfer_id', v_row.transfer_id),
      'ban:' || v_row.ban_id || ':' || coalesce(v_row.transfer_id, v_row.player_id || ':' || v_row.d));
  end loop;

  -- 3. Required sales: the first sale of the player by the club after the obligation was set.
  for v_row in
    select obligation.*, sale.transfer_id, sale.d, sale.to_club_name, sale.to_manager, sale.amount
    from public.compliance_obligations obligation
    cross join lateral (
      select deal.* from public.compliance_transfers(v_world_id) deal
      where deal.player_id = obligation.source_player_id and deal.from_club_id = obligation.source_club_id
        and deal.d >= obligation.created_at::date - 1
      order by deal.d limit 1
    ) sale
    where obligation.source_world_id = v_source_world and obligation.status = 'open'
  loop
    if v_row.requirement = 'sell' or (v_row.to_manager = '0' and coalesce(v_row.amount, 0) > 0) then
      update public.compliance_obligations
      set status = 'met', resolved_at = now(),
          resolved_transfer = jsonb_build_object('transfer_id', v_row.transfer_id, 'date', v_row.d, 'to', v_row.to_club_name, 'amount', v_row.amount)
      where id = v_row.id;
      v_count := v_count + public.raise_compliance_event(
        'obligation_met', 'info', v_row.source_club_id, v_row.club_name,
        'Required sale made: ' || coalesce(v_row.player_name, 'player') || ' (' || v_row.club_name || ')',
        v_row.club_name || ' sold ' || coalesce(v_row.player_name, 'the player') || ' to ' || coalesce(v_row.to_club_name, '?')
          || coalesce(' for ' || to_char(nullif(v_row.amount, 0), 'FM999,999,999,999'), '') || ' on ' || to_char(v_row.d, 'FMDD Mon') || '.',
        jsonb_build_object('obligation_id', v_row.id, 'transfer_id', v_row.transfer_id),
        'obligation-met:' || v_row.id);
    else
      update public.compliance_obligations
      set status = 'breached', resolved_at = now(),
          resolved_transfer = jsonb_build_object('transfer_id', v_row.transfer_id, 'date', v_row.d, 'to', v_row.to_club_name, 'amount', v_row.amount)
      where id = v_row.id;
      v_count := v_count + public.raise_compliance_event(
        'obligation_breached', 'critical', v_row.source_club_id, v_row.club_name,
        'Required sale made the wrong way: ' || coalesce(v_row.player_name, 'player') || ' (' || v_row.club_name || ')',
        v_row.club_name || ' sold ' || coalesce(v_row.player_name, 'the player') || ' to ' || coalesce(v_row.to_club_name, '?')
          || case when v_row.to_manager <> '0' then ', a Top 100 club,' else '' end
          || case when coalesce(v_row.amount, 0) = 0 then ' for no fee' else '' end
          || ' on ' || to_char(v_row.d, 'FMDD Mon') || '. The ruling required a cash sale to a club outside Top 100.',
        jsonb_build_object('obligation_id', v_row.id, 'transfer_id', v_row.transfer_id),
        'obligation-breached:' || v_row.id);
    end if;
  end loop;

  -- 4. Buying back a player the club was told never to bid for again.
  for v_row in
    select obligation.*, deal.transfer_id, deal.d, deal.from_club_name
    from public.compliance_obligations obligation
    join public.compliance_transfers(v_world_id) deal
      on deal.player_id = obligation.source_player_id and deal.to_club_id = obligation.source_club_id
     and deal.d > coalesce((obligation.resolved_transfer->>'date')::date, obligation.created_at::date)
    where obligation.source_world_id = v_source_world and obligation.no_rebid and obligation.status in ('met', 'breached')
  loop
    v_count := v_count + public.raise_compliance_event(
      'rebid', 'critical', v_row.source_club_id, v_row.club_name,
      'Banned player signed again: ' || coalesce(v_row.player_name, 'player') || ' (' || v_row.club_name || ')',
      v_row.club_name || ' signed ' || coalesce(v_row.player_name, 'the player') || ' again from ' || coalesce(v_row.from_club_name, '?')
        || ' on ' || to_char(v_row.d, 'FMDD Mon') || ', against the ruling that the club may not bid for them again.',
      jsonb_build_object('obligation_id', v_row.id, 'transfer_id', v_row.transfer_id),
      'rebid:' || v_row.id || ':' || coalesce(v_row.transfer_id, v_row.d::text));
  end loop;

  return v_count;
end;
$$;

revoke all on function public.enqueue_compliance_events(text) from public, anon, authenticated;
grant execute on function public.enqueue_compliance_events(text) to service_role;

-- Administrators: record a ban or a required sale, close an obligation, acknowledge an event.
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
  if not public.is_admin() then raise exception 'Only administrators can set transfer bans.'; end if;
  select external_world_id into v_source_world from public.game_worlds where slug = p_world_slug;
  insert into public.club_transfer_bans (source_world_id, source_club_id, club_name, starts_on, ends_on, terms, reason, breach_id, created_by)
  values (v_source_world, p_source_club_id,
    coalesce((select source_club_name from public.soccer_manager_club_crosswalk where source_world_id = v_source_world and source_club_id = p_source_club_id), 'Club ' || p_source_club_id),
    p_starts_on, p_ends_on, p_terms, p_reason, p_breach_id, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_club_transfer_ban(text, date, date, text, text, bigint, text) from public, anon;
grant execute on function public.set_club_transfer_ban(text, date, date, text, text, bigint, text) to authenticated;

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
  if not public.is_admin() then raise exception 'Only administrators can add required sales.'; end if;
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

revoke all on function public.add_compliance_obligation(text, text, text, boolean, text, bigint, text) from public, anon;
grant execute on function public.add_compliance_obligation(text, text, text, boolean, text, bigint, text) to authenticated;

create or replace function public.set_compliance_obligation_status(p_obligation_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only administrators can change required sales.'; end if;
  if p_status not in ('open', 'waived', 'met', 'breached') then raise exception 'Unknown status %', p_status; end if;
  update public.compliance_obligations set status = p_status, resolved_at = case when p_status = 'open' then null else now() end where id = p_obligation_id;
end;
$$;

revoke all on function public.set_compliance_obligation_status(bigint, text) from public, anon;
grant execute on function public.set_compliance_obligation_status(bigint, text) to authenticated;

create or replace function public.acknowledge_compliance_event(p_event_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only administrators can acknowledge alerts.'; end if;
  update public.compliance_events set acknowledged_by = auth.uid(), acknowledged_at = now() where id = p_event_id;
end;
$$;

revoke all on function public.acknowledge_compliance_event(bigint) from public, anon;
grant execute on function public.acknowledge_compliance_event(bigint) to authenticated;

RESET check_function_bodies;
