-- Squad limit breaches: only an actual count over the limit on a sync, or a report.
--
-- The between-sync replay (likely and possible breaches) raised too many false
-- alarms, mostly youth intake and other squad changes that are not transfers. A
-- breach is now either:
--   * a sync that captured more than 50 players (source 'sync', confirmed); or
--   * a report: by an administrator (source 'admin_report', confirmed, so the club's
--     manager is told at once), or by a manager through Manager Portal (source
--     'manager_report', confidence 'possible': administrators are told and the club's
--     manager only once they uphold it).
-- Existing between-sync rows stay in the table but are no longer listed or alerted on.

-- Function bodies read Soccer Manager Sync tables that Manager Lab's migrations create,
-- so they are not checked here (as in the baseline).
SET check_function_bodies = false;

alter table public.squad_cap_breaches
  add column source text not null default 'sync' check (source in ('sync', 'admin_report', 'manager_report')),
  add column reported_by_account bigint references public.manager_portal_accounts(id);

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

  -- Runs of consecutive over-limit captures. The transfer replay only dates the
  -- start of a run; it no longer raises breaches of its own.
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

  select count(*) into v_after from public.squad_cap_breaches where game_world_id = v_world_id;
  return v_after - v_before;
end;
$$;


create or replace function public.squad_cap_breach_message(p_breach public.squad_cap_breaches)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_breach.source <> 'sync' then
      p_breach.club_name || ' was reported with ' || p_breach.peak_count || ' players'
        || coalesce(' on ' || to_char(p_breach.started_on, 'FMDD Mon'), '') || '. Rule 4.1 allows '
        || p_breach.squad_limit || ' at all times, and loans count both ways. If the squad is still over, please sell or release '
        || (p_breach.peak_count - p_breach.squad_limit)
        || ' before the next transfer turn and let the admins know. Breaches can lead to a transfer ban (rule 7).'
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
      and (confidence = 'confirmed' or source = 'manager_report' or status = 'upheld')
  loop
    for v_account in
      select account.id
      from public.top100_official_accounts() account(id)
    loop
      perform public.enqueue_manager_notification(
        v_account, 'admin_alerts',
        case
          when v_breach.source = 'manager_report' then 'Reported squad limit breach: '
          else 'Squad limit breach: '
        end || v_breach.club_name || ' (' || v_breach.peak_count || ')',
        case
          when v_breach.source = 'manager_report' then
            'Reported by ' || coalesce(v_breach.evidence->>'reported_by', 'a manager')
              || coalesce(' for ' || to_char(v_breach.started_on, 'FMDD Mon'), '')
              || coalesce(': ' || nullif(v_breach.evidence->>'note', ''), '') || '. '
              || coalesce(v_breach.manager_name, 'The manager') || ' is notified once you uphold it.'
          when v_breach.inherited then 'Began before ' || coalesce(v_breach.manager_name, 'the current manager') || ' was appointed, so they have not been notified.'
          else coalesce(v_breach.manager_name, 'No manager on record')
            || case when exists (select 1 from public.manager_portal_accounts account
                                 where account.manager_id = v_breach.manager_id and account.active = true)
                 then ' has been notified.'
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


-- A report of a club over the limit, by an administrator or by a manager signed in to
-- Manager Portal. Returns the breach id.
create or replace function public.report_squad_cap_breach(
  p_club_name text,
  p_players integer,
  p_observed_on date default current_date,
  p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_official boolean := public.is_top100_official();
  v_account public.manager_portal_accounts;
  v_world public.game_worlds;
  v_club public.soccer_manager_club_crosswalk;
  v_reporter text;
  v_id bigint;
begin
  select * into v_account from public.manager_portal_accounts account
  where account.auth_user_id = auth.uid() and account.active = true
  order by account.id limit 1;
  if not v_official and v_account.id is null then
    raise exception 'Sign in to Manager Portal to report a squad limit breach.';
  end if;
  if p_players is null or p_players <= 50 then
    raise exception 'The limit is 50 players: report a squad of 51 or more.';
  end if;
  if p_observed_on is null or p_observed_on > current_date then
    raise exception 'Give the date the squad was over the limit.';
  end if;

  select * into v_world from public.game_worlds where slug = 'top-100';
  select * into v_club from public.soccer_manager_club_crosswalk crosswalk
  where crosswalk.source_world_id = v_world.external_world_id
    and lower(crosswalk.source_club_name) = lower(trim(p_club_name))
  limit 1;
  if v_club.source_club_id is null then
    raise exception 'No Top 100 club called %.', p_club_name;
  end if;

  select coalesce(manager.display_name, manager.name) into v_reporter
  from public.managers manager where manager.id = v_account.manager_id;

  insert into public.squad_cap_breaches (
    game_world_id, source_world_id, source_club_id, game_world_club_id, team_id, club_name, manager_id, manager_name,
    window_key, confidence, status, squad_limit, peak_count, started_on, key_date, evidence, source, reported_by_account
  )
  select v_world.id, v_world.external_world_id, v_club.source_club_id, v_club.game_world_club_id, v_club.team_id,
    v_club.source_club_name, assignment.manager_id,
    coalesce(manager.display_name, manager.name, assignment.source_manager_name),
    'report:' || to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || ':' || coalesce(v_account.id, 0),
    case when v_official then 'confirmed' else 'possible' end,
    'open', 50, p_players, p_observed_on, p_observed_on,
    jsonb_build_object('reported_by', coalesce(v_reporter, 'An administrator'), 'note', nullif(trim(coalesce(p_note, '')), '')),
    case when v_official then 'admin_report' else 'manager_report' end,
    v_account.id
  from (select 1) one
  left join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = v_world.id and assignment.team_id = v_club.team_id
  left join public.managers manager on manager.id = assignment.manager_id
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.report_squad_cap_breach(text, integer, date, text) from public, anon;
grant execute on function public.report_squad_cap_breach(text, integer, date, text) to authenticated, service_role;

RESET check_function_bodies;
