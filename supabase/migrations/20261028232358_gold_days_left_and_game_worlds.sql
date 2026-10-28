-- From each manager's Soccer Manager profile, Sync everything now keeps the days
-- of Gold left and the number of game worlds they manage in.
--   * manager_signal_snapshots stores both;
--   * manager_profile_overview shows them, with the date Gold runs out;
--   * enqueue_manager_status_alerts warns the manager and the administrators 14
--     and 7 days before Gold runs out, once per expiry date at each stage.

alter table public.manager_signal_snapshots
  add column if not exists gold_days_left integer check (gold_days_left >= 0),
  add column if not exists game_worlds integer check (game_worlds >= 0);

create or replace function public.record_soccer_manager_manager_signals(target_setup_id text, target_captured_at timestamp with time zone, target_signals jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
      (select max(coalesce(nullif(field->>'loginAt', '')::timestamptz,
                           public.manager_signal_login_at(field->>'value', v_captured)))
         from jsonb_array_elements(coalesce(manager_rows.manager->'fields', '[]'::jsonb)) field
         join public.manager_signal_fields known on known.key = field->>'key' and known.confirmed and known.kind = 'login') as last_login_at
    from manager_rows
  )
  insert into public.manager_signal_snapshots (
    game_world_id, source_world_id, source_club_id, sm_manager_id, manager_id, club_name, captured_at, fields, gold, last_login_at,
    gold_days_left, game_worlds
  )
  select v_world_id, v_source_world, readings.manager->>'clubId', nullif(readings.manager->>'managerId', ''),
    assignment.manager_id, crosswalk.source_club_name, v_captured,
    coalesce(readings.manager->'fields', '[]'::jsonb), readings.gold, readings.last_login_at,
    case when readings.manager->>'goldDaysLeft' ~ '^[0-9]{1,5}$' then (readings.manager->>'goldDaysLeft')::integer end,
    case when readings.manager->>'gameWorlds' ~ '^[0-9]{1,4}$' then (readings.manager->>'gameWorlds')::integer end
  from readings
  left join public.soccer_manager_club_crosswalk crosswalk
    on crosswalk.source_world_id = v_source_world and crosswalk.source_club_id = readings.manager->>'clubId'
  left join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = v_world_id and assignment.team_id = crosswalk.team_id
  on conflict (source_world_id, source_club_id, captured_at) do update set
    fields = excluded.fields, gold = excluded.gold, last_login_at = excluded.last_login_at, sm_manager_id = excluded.sm_manager_id,
    gold_days_left = excluded.gold_days_left, game_worlds = excluded.game_worlds;
  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'managers', v_rows,
    'candidateFields', (select count(*) from public.manager_signal_fields),
    'confirmedFields', (select count(*) from public.manager_signal_fields where confirmed)
  );
end;
$function$;

revoke all on function public.record_soccer_manager_manager_signals(text, timestamptz, jsonb) from public, anon;
grant execute on function public.record_soccer_manager_manager_signals(text, timestamptz, jsonb) to authenticated;

-- Days of Gold left, the date Gold runs out and game worlds for each club's latest
-- reading, alongside manager_status_overview (kept as it is, so nothing is dropped).
create or replace function public.manager_profile_overview(p_world_slug text default 'top-100')
returns table (
  club_name text,
  sm_manager_id text,
  gold_days_left integer,
  gold_expires_on date,
  game_worlds integer,
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
  select latest.club_name, latest.sm_manager_id, latest.gold_days_left,
    (latest.captured_at at time zone 'UTC')::date + latest.gold_days_left,
    latest.game_worlds, latest.captured_at
  from (
    select distinct on (snapshot.source_club_id) snapshot.*
    from public.manager_signal_snapshots snapshot
    join public.game_worlds world on world.slug = p_world_slug and snapshot.source_world_id = world.external_world_id
    order by snapshot.source_club_id, snapshot.captured_at desc
  ) latest;
end;
$$;

revoke all on function public.manager_profile_overview(text) from public, anon;
grant execute on function public.manager_profile_overview(text) to authenticated;

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
  -- the date it ends; once per expiry date at each stage, so a renewal starts afresh.
  for v_row in
    select latest.*, (latest.captured_at at time zone 'UTC')::date + latest.gold_days_left as expires_on
    from (
      select distinct on (snapshot.source_club_id) snapshot.*
      from public.manager_signal_snapshots snapshot
      where snapshot.source_world_id = v_source_world
      order by snapshot.source_club_id, snapshot.captured_at desc
    ) latest
    where latest.gold_days_left is not null and latest.gold is not false
      and (latest.captured_at at time zone 'UTC')::date + latest.gold_days_left between (now() at time zone 'UTC')::date and (now() at time zone 'UTC')::date + 14
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
