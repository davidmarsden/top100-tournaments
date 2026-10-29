-- Gold unclear instead of Gold ended. Soccer Manager lets Gold run up to 2 days past its end
-- date so renewals can go through, and its profile shows 0 days left throughout, while the
-- Manager List keeps the badge. So the badge plus 0 days since a date now past no longer counts
-- as Gold having ended: administrators get one "Gold unclear – check" alert, and appointments
-- go by the badge and flag the manager for checking.
set check_function_bodies = false;

create or replace function public.enqueue_manager_status_alerts(p_world_slug text default 'top-100')
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_world_id bigint;
  v_source_world bigint;
  v_row record;
  v_count integer := 0;
  v_name text;
begin
  select id, external_world_id into v_world_id, v_source_world from public.game_worlds where slug = p_world_slug;
  if v_world_id is null then return 0; end if;

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

  -- Gold running out (days left from the manager's profile): 14 days, then 7 days, before
  -- the date it ends; once per expiry date at each stage, so a renewal starts afresh. The
  -- date comes from manager_gold_expiry, so it stays the same from sync to sync.
  for v_row in
    select latest.*, expiry.expires_on
    from (
      select distinct on (snapshot.source_club_id) snapshot.*
      from public.manager_signal_snapshots snapshot
      where snapshot.source_world_id = v_source_world
      order by snapshot.source_club_id, snapshot.captured_at desc
    ) latest
    join public.manager_gold_expiry(v_source_world) expiry
      on expiry.source_club_id = latest.source_club_id and expiry.sm_manager_id = latest.sm_manager_id
    where latest.gold is not false
      and expiry.expires_on between (now() at time zone 'UTC')::date and (now() at time zone 'UTC')::date + 14
  loop
    select coalesce(display_name, name) into v_name from public.managers where id = v_row.manager_id;
    v_count := v_count + public.raise_manager_status_alert(
      'gold', case when v_row.expires_on <= (now() at time zone 'UTC')::date + 7 then 'warning' else 'info' end,
      v_world_id, v_row.club_name, v_row.manager_id, v_name,
      'Gold ends ' || to_char(v_row.expires_on, 'FMDD Mon') || ': ' || coalesce(v_row.club_name, 'unknown club'),
      coalesce(v_name, 'The manager') || '''s Gold membership runs out on ' || to_char(v_row.expires_on, 'FMDD Mon') || '.',
      'Your Gold membership runs out on ' || to_char(v_row.expires_on, 'FMDD Mon')
        || '. Every Top 100 manager must be a Gold member, so please renew it before then.',
      'goldexpiry' || case when v_row.expires_on <= (now() at time zone 'UTC')::date + 7 then '7' else '14' end
        || ':' || coalesce(v_row.sm_manager_id, v_row.source_club_id) || ':' || to_char(v_row.expires_on, 'YYYYMMDD'),
      true);
  end loop;

  -- Gold unclear: the profile has shown no days left since a date now past, while the Manager
  -- List still shows the badge. Gold has run out, or is in the up to 2 days' grace Soccer Manager
  -- allows for renewals; an administrator checks. Once per date, for administrators only. Same
  -- dedupe key as the "Gold ended" alert this replaces, so nobody is alerted twice.
  for v_row in
    select latest.*, expiry.expires_on
    from (
      select distinct on (snapshot.source_club_id) snapshot.*
      from public.manager_signal_snapshots snapshot
      where snapshot.source_world_id = v_source_world
      order by snapshot.source_club_id, snapshot.captured_at desc
    ) latest
    join public.manager_gold_expiry(v_source_world) expiry
      on expiry.source_club_id = latest.source_club_id and expiry.sm_manager_id = latest.sm_manager_id
    where latest.gold is true and expiry.expires_on < (now() at time zone 'UTC')::date
  loop
    select coalesce(display_name, name) into v_name from public.managers where id = v_row.manager_id;
    v_count := v_count + public.raise_manager_status_alert(
      'gold', 'warning', v_world_id, v_row.club_name, v_row.manager_id, v_name,
      'Gold unclear – check: ' || coalesce(v_row.club_name, 'unknown club'),
      coalesce(v_name, 'The manager') || '''s profile has shown no days of Gold left since ' || to_char(v_row.expires_on, 'FMDD Mon')
        || ', but the Manager List still shows the Gold badge. Their Gold has run out, or is in the up to 2 days'' grace'
        || ' Soccer Manager allows for renewals: please check.',
      null,
      'goldended:' || coalesce(v_row.sm_manager_id, v_row.source_club_id) || ':' || to_char(v_row.expires_on, 'YYYYMMDD'),
      false);
  end loop;

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
$function$;

revoke all on function public.enqueue_manager_status_alerts(text) from public, anon, authenticated;
grant execute on function public.enqueue_manager_status_alerts(text) to service_role;

create or replace function public.appointment_manager_inputs(p_world_id bigint, p_season integer, p_manager_ids bigint[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(ids.manager_id::text, jsonb_strip_nulls(jsonb_build_object(
    -- The Manager List badge decides Gold. When the profile has shown no days left since a date now
    -- past but the badge is still on, it is unclear (run out, or in Soccer Manager's renewal grace):
    -- flagged for an administrator to check, not counted against the manager.
    'gold', signal.gold,
    'goldUnclearSince', case when signal.gold is true then signal.gold_ended_on end,
    'goldDaysLeft', signal.gold_days_left,
    'gameWorlds', signal.game_worlds,
    'running', case when official.manager_id is not null then 3 else 0 end,
    'competitions', (select count(distinct entry.tournament_id) from public.tournament_entries entry
                       join public.tournaments tournament on tournament.id = entry.tournament_id
                       join public.seasons season on season.id = tournament.season_id
                      where entry.manager_id = ids.manager_id and season.number between p_season - 1 and p_season
                        and not coalesce(entry.withdrawn, false)),
    'topManagerDeals', (select count(*) from public.soccer_manager_transfers transfer
                         where transfer.game_world_id = p_world_id
                           and transfer.from_manager_id is not null and transfer.to_manager_id is not null
                           and transfer.from_manager_id <> transfer.to_manager_id
                           and ids.manager_id in (transfer.from_manager_id, transfer.to_manager_id)
                           and transfer.first_seen_at >= now() - interval '120 days'),
    'forfeits', (select count(*) from public.forfeits forfeit
                   join public.tournament_entries entry on entry.id = forfeit.forfeiting_entry_id
                   join public.tournaments tournament on tournament.id = entry.tournament_id
                   join public.seasons season on season.id = tournament.season_id
                  where entry.manager_id = ids.manager_id and season.number = p_season),
    'openSanction', (select string_agg(coalesce(ban.terms, 'transfer ban') || ' until ' || to_char(ban.ends_on, 'FMDD Mon YYYY'), '; ')
                       from public.club_transfer_bans ban
                       join public.appointment_world_managers(p_world_id) club on club.club_name = ban.club_name
                      where club.manager_id = ids.manager_id and ban.ends_on >= current_date)
  ))), '{}'::jsonb)
  from unnest(p_manager_ids) ids(manager_id)
  left join lateral (
    select snapshot.gold, snapshot.gold_days_left, snapshot.game_worlds,
      (select expiry.expires_on from public.manager_gold_expiry(snapshot.source_world_id) expiry
        where expiry.source_club_id = snapshot.source_club_id and expiry.sm_manager_id = snapshot.sm_manager_id
          and expiry.expires_on < (now() at time zone 'UTC')::date) as gold_ended_on
    from public.manager_signal_snapshots snapshot
    where snapshot.game_world_id = p_world_id and snapshot.manager_id = ids.manager_id
    order by snapshot.captured_at desc limit 1
  ) signal on true
  left join public.top100_officials official on official.manager_id = ids.manager_id;
$$;

revoke all on function public.appointment_manager_inputs(bigint, integer, bigint[]) from public, anon, authenticated;

-- "Gold ended" alerts already raised now read as Gold unclear.
update public.admin_alert_log
set title = 'Gold unclear – check: ' || coalesce(club_name, 'unknown club'),
    body = coalesce(manager_name, 'The manager') || '''s profile has shown no days of Gold left since '
      || to_char(to_date(split_part(dedupe_key, ':', 3), 'YYYYMMDD'), 'FMDD Mon')
      || ', but the Manager List still shows the Gold badge. Their Gold has run out, or is in the up to 2 days'' grace'
      || ' Soccer Manager allows for renewals: please check.'
where dedupe_key like 'goldended:%' and title like 'Gold ended%';
