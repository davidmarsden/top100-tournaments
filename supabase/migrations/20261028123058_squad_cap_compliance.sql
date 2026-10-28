-- Squad cap compliance (Top 100 rule 4.1: at most 50 players; loans count both ways).
--
-- Two sources of evidence, both from Soccer Manager Sync:
--
-- 1. Confirmed: a reviewed squad capture (squad_scope.playerCount) above the
--    limit. Consecutive over-limit captures of a club form one breach, which
--    resolves itself once a later capture is back within the limit.
-- 2. Between syncs: syncs are not continuous, so a club can go over and back
--    between two captures (Lyon, S28 turn 34: two free agents in, one sale
--    out). Each interval between two captures is replayed day by day from
--    the transfer archive. Transfers carry a day, not a time, so a day's
--    signings are assumed to land before its sales. Squad changes that are
--    not transfers (youth intake, releases) show up as drift between the two
--    captures and could have happened on any day, so the replay is done from
--    both ends: if both walks exceed the limit the breach is "likely",
--    if only the worst case does it is "possible". Neither is a finding until
--    an administrator upholds it.
--
-- Players an administrator rules out of the count, such as signings frozen by a
-- transfer ban (Dinamo Zagreb's six S28 signings made while the club had no
-- manager), are listed in squad_cap_exclusions and left out of both the
-- capture counts and the replay. Loaned-in players are in Soccer Manager's
-- squad count (confirmed with Dinamo Zagreb, October 2026).
--
-- enqueue_squad_cap_alerts() refreshes the register and queues notifications
-- (category admin_alerts, which managers cannot switch off):
-- confirmed breaches go to the club's manager and the administrators at once;
-- likely/possible ones go to administrators, and to the manager only once
-- upheld. It is called every five minutes by push-dispatch-scheduled and is
-- idempotent.

create table public.squad_cap_breaches (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id),
  source_world_id bigint not null,
  source_club_id text not null,
  game_world_club_id bigint references public.game_world_clubs(id),
  team_id bigint references public.teams(id),
  club_name text not null,
  manager_id bigint references public.managers(id),
  manager_name text,
  window_key text not null,
  confidence text not null check (confidence in ('confirmed', 'likely', 'possible')),
  status text not null default 'open' check (status in ('open', 'resolved', 'upheld', 'dismissed')),
  squad_limit integer not null,
  peak_count integer not null,
  current_count integer,
  started_on date,
  ended_on date,
  key_date date,
  evidence jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  resolved_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  manager_notified_at timestamptz,
  admins_notified_at timestamptz,
  unique (source_world_id, source_club_id, window_key)
);

comment on table public.squad_cap_breaches is
  'Register of Top 100 squad-limit breaches detected from Soccer Manager Sync. Written only by refresh_squad_cap_breaches() and review_squad_cap_breach().';

create table public.squad_cap_exclusions (
  id bigint generated always as identity primary key,
  source_world_id bigint not null,
  source_club_id text not null,
  source_player_id text not null,
  player_name text,
  reason text not null,
  excluded_from date,
  excluded_until date,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (source_world_id, source_club_id, source_player_id)
);

comment on table public.squad_cap_exclusions is
  'Players an administrator has ruled out of a club''s squad-limit count (for example signings frozen by a transfer ban). Written through set_squad_cap_exclusion().';

alter table public.squad_cap_exclusions enable row level security;
create policy "Admins read squad cap exclusions" on public.squad_cap_exclusions
  for select to authenticated using (public.is_admin());
grant select on public.squad_cap_exclusions to authenticated;

alter table public.squad_cap_breaches enable row level security;
create policy "Admins read squad cap breaches" on public.squad_cap_breaches
  for select to authenticated using (public.is_admin());
grant select on public.squad_cap_breaches to authenticated;

-- Squad size at every reviewed capture, less excluded players.
create or replace function public.squad_cap_captures(p_source_world bigint)
returns table (club text, n integer, captured_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (change.after_data->>'clubId', run.captured_at)
    change.after_data->>'clubId' as club,
    (change.after_data->>'playerCount')::integer
      - (select count(*)::integer
         from jsonb_array_elements_text(coalesce(change.after_data->'rosterPlayerIds', '[]'::jsonb)) roster(player_id)
         join public.squad_cap_exclusions exclusion
           on exclusion.source_world_id = p_source_world
          and exclusion.source_club_id = change.after_data->>'clubId'
          and exclusion.source_player_id = roster.player_id
          and (exclusion.excluded_from is null or run.captured_at::date >= exclusion.excluded_from)
          and (exclusion.excluded_until is null or run.captured_at::date <= exclusion.excluded_until)) as n,
    run.captured_at
  from public.soccer_manager_sync_changes change
  join public.soccer_manager_sync_runs run on run.id = change.run_id
  where change.entity_type = 'squad_scope'
    and change.status = 'approved'
    and change.after_data->>'setupId' = p_source_world::text
    and change.after_data->>'playerCount' ~ '^[0-9]+$'
  order by change.after_data->>'clubId', run.captured_at, change.id desc;
$$;

-- Day-by-day replay of every interval between two captures of a club.
create or replace function public.squad_cap_replay(p_world_id bigint, p_source_world bigint)
returns table (
  club text, n integer, captured_at timestamptz, prev_n integer, prev_at timestamptz, d date,
  turn integer, ins integer, net integer, transfers jsonb,
  before_backward bigint, before_forward bigint, drift bigint, peak_high bigint, peak_low bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with intervals as (
    select club, n, captured_at,
      lag(n) over w as prev_n,
      lag(captured_at) over w as prev_at
    from public.squad_cap_captures(p_source_world)
    window w as (partition by club order by captured_at)
  ),
  all_moves as (
    select transfer.to_source_club_id as club, 1 as delta, transfer.source_turn, transfer.player_name,
      transfer.from_club_name, transfer.to_club_name, transfer.accepted_date, transfer.first_seen_at,
      transfer.source_data->>'playerId' as player_id
    from public.soccer_manager_transfers transfer
    where transfer.game_world_id = p_world_id and transfer.status = 9
    union all
    select transfer.from_source_club_id, -1, transfer.source_turn, transfer.player_name,
      transfer.from_club_name, transfer.to_club_name, transfer.accepted_date, transfer.first_seen_at,
      transfer.source_data->>'playerId'
    from public.soccer_manager_transfers transfer
    where transfer.game_world_id = p_world_id and transfer.status = 9
  ),
  moves as (
    -- Excluded players never count, so their moves do not change the count either.
    select move.* from all_moves move
    where not exists (
      select 1 from public.squad_cap_exclusions exclusion
      where exclusion.source_world_id = p_source_world
        and exclusion.source_club_id = move.club
        and exclusion.source_player_id = move.player_id)
  ),
  dated as (
    -- accepted_date has no year ("Oct 19"): take the year it was first seen,
    -- stepping back a year when that lands in the future (a December deal first seen in January).
    select move.*,
      case when parsed.d > move.first_seen_at::date + 1 then (parsed.d - interval '1 year')::date else parsed.d end as d
    from moves move
    cross join lateral (
      select to_date(move.accepted_date || ' ' || extract(year from move.first_seen_at)::integer, 'Mon DD YYYY') as d
    ) parsed
    where move.club is not null and move.club <> '0' and move.accepted_date ~ '^[A-Z][a-z]{2} [0-9]{1,2}$'
  ),
  days as (
    select interval_row.club, interval_row.n, interval_row.captured_at, interval_row.prev_n, interval_row.prev_at, dated.d,
      max(dated.source_turn) as turn,
      count(*) filter (where dated.delta > 0)::integer as ins,
      sum(dated.delta)::integer as net,
      jsonb_agg(jsonb_build_object('player', dated.player_name, 'from', dated.from_club_name, 'to', dated.to_club_name)
                order by dated.delta desc, dated.player_name) as transfers
    from intervals interval_row
    join dated on dated.club = interval_row.club
      and dated.d > interval_row.prev_at::date
      and dated.d <= interval_row.captured_at::date
    group by interval_row.club, interval_row.n, interval_row.captured_at, interval_row.prev_n, interval_row.prev_at, dated.d
  ),
  walked as (
    select days.*,
      -- Backward from the later capture, and forward from the earlier one.
      days.n - sum(days.net) over (partition by days.club, days.captured_at order by days.d desc
                                   rows between unbounded preceding and current row) as before_backward,
      days.prev_n + coalesce(sum(days.net) over (partition by days.club, days.captured_at order by days.d
                                                 rows between unbounded preceding and 1 preceding), 0) as before_forward,
      days.n - sum(days.net) over (partition by days.club, days.captured_at) - days.prev_n as drift
    from days
  )
  select walked.*,
    greatest(before_backward, before_forward) + ins as peak_high,
    least(before_backward, before_forward) + ins as peak_low
  from walked;
$$;

-- @permissions private public.squad_cap_captures: called only by refresh_squad_cap_breaches()
-- @permissions private public.squad_cap_replay: called only by refresh_squad_cap_breaches()

create or replace function public.refresh_squad_cap_breaches(p_world_slug text default 'top-100', p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world_id bigint;
  v_source_world bigint;
  v_before integer;
  v_after integer;
begin
  select world.id, world.external_world_id into v_world_id, v_source_world
  from public.game_worlds world where world.slug = p_world_slug;
  if v_world_id is null or v_source_world is null then return 0; end if;

  select count(*) into v_before from public.squad_cap_breaches where game_world_id = v_world_id;

  -- 1. Confirmed breaches: runs of consecutive over-limit captures.
  with flagged as (
    select capture.*,
      capture.n > p_limit as over,
      sum(case when capture.n > p_limit then 0 else 1 end) over (partition by club order by captured_at) as grp,
      max(captured_at) over (partition by club) as latest_at
    from public.squad_cap_captures(v_source_world) capture
  ),
  episodes as (
    select club, grp,
      min(captured_at) as first_at,
      max(captured_at) as last_at,
      max(n) as peak,
      (array_agg(n order by captured_at desc))[1] as last_n,
      bool_or(captured_at = latest_at) as ongoing,
      jsonb_agg(jsonb_build_object('captured_at', captured_at, 'players', n) order by captured_at) as captures
    from flagged where over
    group by club, grp
  ),
  enriched as (
    select episode.*,
      (select min(capture.captured_at) from public.squad_cap_captures(v_source_world) capture
        where capture.club = episode.club and capture.captured_at > episode.last_at) as cleared_at,
      (select min(day.d) from public.squad_cap_replay(v_world_id, v_source_world) day
        where day.club = episode.club and day.captured_at = episode.first_at and day.peak_high > p_limit) as estimated_start
    from episodes episode
  )
  insert into public.squad_cap_breaches as breach (
    game_world_id, source_world_id, source_club_id, game_world_club_id, team_id, club_name, manager_id, manager_name,
    window_key, confidence, status, squad_limit, peak_count, current_count, started_on, ended_on, evidence, resolved_at
  )
  select v_world_id, v_source_world, enriched.club, crosswalk.game_world_club_id, crosswalk.team_id,
    coalesce(crosswalk.source_club_name, 'Club ' || enriched.club), assignment.manager_id,
    coalesce(manager.display_name, manager.name, assignment.source_manager_name),
    'sync:' || to_char(enriched.first_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'confirmed',
    case when enriched.ongoing then 'open' else 'resolved' end,
    p_limit, enriched.peak, enriched.last_n,
    coalesce(enriched.estimated_start, enriched.first_at::date),
    case when enriched.ongoing then null else enriched.cleared_at::date end,
    jsonb_build_object('captures', enriched.captures, 'estimated_start_from_transfers', enriched.estimated_start),
    case when enriched.ongoing then null else coalesce(enriched.cleared_at, now()) end
  from enriched
  left join public.soccer_manager_club_crosswalk crosswalk
    on crosswalk.source_world_id = v_source_world and crosswalk.source_club_id = enriched.club
  left join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = v_world_id and assignment.team_id = crosswalk.team_id
  left join public.managers manager on manager.id = assignment.manager_id
  on conflict (source_world_id, source_club_id, window_key) do update set
    peak_count = excluded.peak_count,
    current_count = excluded.current_count,
    started_on = excluded.started_on,
    ended_on = excluded.ended_on,
    evidence = excluded.evidence,
    last_checked_at = now(),
    -- An administrator's decision stands; otherwise follow the captures.
    status = case when breach.status in ('upheld', 'dismissed') then breach.status else excluded.status end,
    resolved_at = case when excluded.status = 'resolved' then coalesce(breach.resolved_at, excluded.resolved_at) else null end;

  -- 2. Between-sync breaches, one per club and interval, only where both
  --    captures were within the limit (otherwise the confirmed breach covers it).
  with interval_breaches as (
    select day.club, day.captured_at, day.prev_at, day.n, day.prev_n,
      max(day.peak_high) as peak_high,
      max(day.peak_low) as peak_low,
      min(day.d) filter (where day.peak_high > p_limit) as started_on,
      max(day.d) filter (where day.peak_high > p_limit) as ended_on,
      -- The day most likely to be over: highest best-case peak, then the most signings.
      (array_agg(day.d order by day.peak_low desc, day.ins desc, day.peak_high desc, day.d desc)
        filter (where day.peak_high > p_limit))[1] as key_date,
      max(day.drift) as drift,
      jsonb_agg(jsonb_build_object(
        'date', day.d, 'turn', day.turn, 'peak_low', day.peak_low, 'peak_high', day.peak_high,
        'transfers', day.transfers) order by day.d) filter (where day.peak_high > p_limit) as days
    from public.squad_cap_replay(v_world_id, v_source_world) day
    where day.n <= p_limit and day.prev_n <= p_limit
    group by day.club, day.captured_at, day.prev_at, day.n, day.prev_n
    having max(day.peak_high) > p_limit
  )
  insert into public.squad_cap_breaches as breach (
    game_world_id, source_world_id, source_club_id, game_world_club_id, team_id, club_name, manager_id, manager_name,
    window_key, confidence, status, squad_limit, peak_count, current_count, started_on, ended_on, key_date, evidence
  )
  select v_world_id, v_source_world, interval_breach.club, crosswalk.game_world_club_id, crosswalk.team_id,
    coalesce(crosswalk.source_club_name, 'Club ' || interval_breach.club), assignment.manager_id,
    coalesce(manager.display_name, manager.name, assignment.source_manager_name),
    'between:' || to_char(interval_breach.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'),
    case when interval_breach.peak_low > p_limit then 'likely' else 'possible' end,
    'open', p_limit, interval_breach.peak_high, interval_breach.n,
    interval_breach.started_on, interval_breach.ended_on, interval_breach.key_date,
    jsonb_build_object(
      'previous_capture', jsonb_build_object('captured_at', interval_breach.prev_at, 'players', interval_breach.prev_n),
      'next_capture', jsonb_build_object('captured_at', interval_breach.captured_at, 'players', interval_breach.n),
      'peak_range', jsonb_build_array(interval_breach.peak_low, interval_breach.peak_high),
      'non_transfer_change', interval_breach.drift,
      'days', interval_breach.days)
  from interval_breaches interval_breach
  left join public.soccer_manager_club_crosswalk crosswalk
    on crosswalk.source_world_id = v_source_world and crosswalk.source_club_id = interval_breach.club
  left join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = v_world_id and assignment.team_id = crosswalk.team_id
  left join public.managers manager on manager.id = assignment.manager_id
  on conflict (source_world_id, source_club_id, window_key) do update set
    confidence = excluded.confidence,
    peak_count = excluded.peak_count,
    started_on = excluded.started_on,
    ended_on = excluded.ended_on,
    key_date = excluded.key_date,
    evidence = excluded.evidence,
    last_checked_at = now();

  select count(*) into v_after from public.squad_cap_breaches where game_world_id = v_world_id;
  return v_after - v_before;
end;
$$;

revoke all on function public.refresh_squad_cap_breaches(text, integer) from public, anon, authenticated;
grant execute on function public.refresh_squad_cap_breaches(text, integer) to service_role;

create or replace function public.squad_cap_breach_message(p_breach public.squad_cap_breaches)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_breach.confidence = 'confirmed' and p_breach.status = 'open' then
      p_breach.club_name || ' has ' || coalesce(p_breach.current_count, p_breach.peak_count) || ' players. Rule 4.1 allows '
        || p_breach.squad_limit || ', and loans count both ways. Please sell or release '
        || (coalesce(p_breach.current_count, p_breach.peak_count) - p_breach.squad_limit)
        || ' before the next transfer turn and let the admins know. Breaches can lead to a transfer ban (rule 7).'
    else
      p_breach.club_name || ' went over the ' || p_breach.squad_limit || '-player limit (up to ' || p_breach.peak_count
        || ' players' || coalesce(' on ' || to_char(coalesce(p_breach.key_date, p_breach.started_on), 'FMDD Mon'), '')
        || '). Rule 4.1 applies at all times, including between transfer turns. Please keep the squad at '
        || p_breach.squad_limit || ' or fewer before completing new signings.'
  end;
$$;

-- @permissions private public.squad_cap_breach_message: message helper called only by enqueue_squad_cap_alerts()

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
  v_admin_url constant text := 'https://lab.smtop100.blog/compliance';
begin
  perform public.refresh_squad_cap_breaches('top-100', 50);

  -- Managers: confirmed breaches that are still open, and anything an administrator upheld.
  for v_breach in
    select * from public.squad_cap_breaches
    where manager_notified_at is null
      and status <> 'dismissed'
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

  -- Administrators: every new breach, with the manager's reach so a missing
  -- Manager Portal account can be followed up directly.
  for v_breach in
    select * from public.squad_cap_breaches
    where admins_notified_at is null and status <> 'dismissed'
  loop
    for v_account in
      select account.id
      from public.manager_portal_accounts account
      join public.admin_users admin on admin.user_id = account.auth_user_id
      where account.active = true
    loop
      perform public.enqueue_manager_notification(
        v_account, 'admin_alerts',
        case v_breach.confidence
          when 'confirmed' then 'Squad limit breach: '
          when 'likely' then 'Likely squad limit breach: '
          else 'Possible squad limit breach: '
        end || v_breach.club_name || ' (' || v_breach.peak_count || ')',
        coalesce(v_breach.manager_name, 'No manager on record')
          || case when exists (select 1 from public.manager_portal_accounts account
                               where account.manager_id = v_breach.manager_id and account.active = true)
               then case when v_breach.confidence = 'confirmed' then ' has been notified.' else ' is notified once you uphold it.' end
               else ' has no Manager Portal account: contact them directly.' end
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

revoke all on function public.enqueue_squad_cap_alerts() from public, anon, authenticated;
grant execute on function public.enqueue_squad_cap_alerts() to service_role;

-- Administrator decision on a breach: uphold (manager is notified) or dismiss.
create or replace function public.review_squad_cap_breach(p_breach_id bigint, p_status text, p_note text default null)
returns public.squad_cap_breaches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.squad_cap_breaches;
begin
  if not public.is_admin() then raise exception 'Only administrators can review squad limit breaches.'; end if;
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

revoke all on function public.review_squad_cap_breach(bigint, text, text) from public, anon;
grant execute on function public.review_squad_cap_breach(bigint, text, text) to authenticated;

-- Administrator: rule a player out of (p_exclude) or back into a club's count.
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
  if not public.is_admin() then raise exception 'Only administrators can change squad limit exclusions.'; end if;
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

revoke all on function public.set_squad_cap_exclusion(text, text, text, boolean, text) from public, anon;
grant execute on function public.set_squad_cap_exclusion(text, text, text, boolean, text) to authenticated;

-- Current squad size of every club in a world, from the latest reviewed squad capture,
-- less any players excluded from the count.
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
  if not public.is_admin() then raise exception 'Only administrators can view squad compliance.'; end if;

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

revoke all on function public.squad_cap_overview(text) from public, anon;
grant execute on function public.squad_cap_overview(text) to authenticated;
