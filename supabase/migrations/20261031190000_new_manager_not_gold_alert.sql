-- Gold alerts for a manager who takes over a club without Gold (new arrivals were missed: the
-- lapse alert only fires on a change between two readings of the same manager). The scheduled
-- dispatcher now runs these alerts for Top 100 Regen as well as Top 100.
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
  v_world_name text;
begin
  select id, external_world_id, name into v_world_id, v_source_world, v_world_name from public.game_worlds where slug = p_world_slug;
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

  -- New manager without Gold: the club's latest reading is not Gold, it is the manager's first
  -- reading at the club, and the club was read before under someone else (so a manager change
  -- was seen, not a first sync). Gold is required in every Top 100 game world. Once per manager
  -- and club; the manager is told too.
  for v_row in
    with latest as (
      select distinct on (snapshot.source_club_id) snapshot.*
      from public.manager_signal_snapshots snapshot
      where snapshot.source_world_id = v_source_world and snapshot.sm_manager_id is not null
      order by snapshot.source_club_id, snapshot.captured_at desc
    ), arrivals as (
      select latest.*, (select min(first_seen.captured_at) from public.manager_signal_snapshots first_seen
                        where first_seen.source_world_id = v_source_world and first_seen.source_club_id = latest.source_club_id
                          and first_seen.sm_manager_id = latest.sm_manager_id) as arrived_at
      from latest where latest.gold is false
    )
    select arrivals.* from arrivals
    where exists (select 1 from public.manager_signal_snapshots before_arrival
                  where before_arrival.source_world_id = v_source_world and before_arrival.source_club_id = arrivals.source_club_id
                    and before_arrival.sm_manager_id is distinct from arrivals.sm_manager_id
                    and before_arrival.captured_at < arrivals.arrived_at)
  loop
    select coalesce(display_name, name) into v_name from public.managers where id = v_row.manager_id;
    v_count := v_count + public.raise_manager_status_alert(
      'gold', 'warning', v_world_id, v_row.club_name, v_row.manager_id, v_name,
      'New manager not Gold: ' || coalesce(v_row.club_name, 'unknown club') || ' (' || v_world_name || ')',
      coalesce(v_name, 'The new manager') || ' took over ' || coalesce(v_row.club_name, 'a club') || ' in ' || v_world_name
        || ' but is not a Gold member. Every Top 100 manager must be.',
      'Welcome to ' || v_world_name || '. Every manager here must be a Gold member, and your Soccer Manager profile shows you are not.'
        || ' Without Gold you cannot complete transfers with other managers and your tactical options are limited. Please take out Gold membership as soon as you can.',
      'goldnew:' || v_row.sm_manager_id || ':' || v_row.source_club_id,
      true);
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
