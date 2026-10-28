-- Gold/login confirmation from the admin alerts page failed with "UPDATE
-- requires a WHERE clause": Supabase rejects unqualified updates from web
-- requests, and the confirm function re-read every snapshot without one.
--
-- Soccer Manager's Manager List sends last online as HTML,
-- <span style="display:none">5</span><span ...>5 days ago</span>, where the
-- hidden number is the days since last online. manager_signal_login_at() reads
-- that (or the visible "Today" / "Yesterday" / "N days ago") against the
-- snapshot's capture time, for readings stored before Sync parsed it itself.

create or replace function public.manager_signal_login_at(p_value text, p_captured timestamptz)
returns timestamptz
language sql
immutable
set search_path to ''
as $function$
  select case
    when p_value is null or p_captured is null then null
    when substring(p_value from 'display:\s*none[^>]*>\s*([0-9]{1,4})\s*<') is not null
      then p_captured - make_interval(days => substring(p_value from 'display:\s*none[^>]*>\s*([0-9]{1,4})\s*<')::integer)
    when lower(btrim(regexp_replace(p_value, '<[^>]*>', '', 'g'))) in ('today', 'online', 'now') then p_captured
    when lower(btrim(regexp_replace(p_value, '<[^>]*>', '', 'g'))) = 'yesterday' then p_captured - interval '1 day'
    when lower(btrim(regexp_replace(p_value, '<[^>]*>', '', 'g'))) ~ '^[0-9]{1,4}\s+days?\s+ago$'
      then p_captured - make_interval(days => substring(lower(regexp_replace(p_value, '<[^>]*>', '', 'g')) from '([0-9]{1,4})')::integer)
    else null
  end;
$function$;

revoke all on function public.manager_signal_login_at(text, timestamptz) from public, anon;
grant execute on function public.manager_signal_login_at(text, timestamptz) to authenticated, service_role;

create or replace function public.confirm_manager_signal_field(p_key text, p_confirmed boolean)
returns public.manager_signal_fields
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.manager_signal_fields;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can confirm signal fields.'; end if;

  update public.manager_signal_fields
  set confirmed = p_confirmed, confirmed_by = auth.uid(), confirmed_at = now()
  where key = p_key
  returning * into v_row;
  if v_row.key is null then raise exception 'Unknown field %', p_key; end if;

  -- Every snapshot is re-read; "where true" satisfies Supabase's safe-update guard.
  update public.manager_signal_snapshots snapshot
  set gold = (select (field->>'gold')::boolean
                from jsonb_array_elements(snapshot.fields) field
                join public.manager_signal_fields known on known.key = field->>'key' and known.confirmed and known.kind = 'gold'
               where field->>'gold' in ('true', 'false') limit 1),
      last_login_at = (select max(coalesce(nullif(field->>'loginAt', '')::timestamptz,
                                           public.manager_signal_login_at(field->>'value', snapshot.captured_at)))
                         from jsonb_array_elements(snapshot.fields) field
                         join public.manager_signal_fields known on known.key = field->>'key' and known.confirmed and known.kind = 'login')
  where true;

  return v_row;
end;
$function$;

revoke all on function public.confirm_manager_signal_field(text, boolean) from public, anon;
grant execute on function public.confirm_manager_signal_field(text, boolean) to authenticated;

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
$function$;

revoke all on function public.record_soccer_manager_manager_signals(text, timestamptz, jsonb) from public, anon;
grant execute on function public.record_soccer_manager_manager_signals(text, timestamptz, jsonb) to authenticated;
