-- "N days ago" readings resolve to the start of the capture day (UTC) minus N
-- days, so the same absence gives the same last_login_at on every sync: the
-- 7- and 10-day alert dedupe keys include last_login_at, and capture time minus
-- N days moved with each sync and could alert again for the same absence.

create or replace function public.manager_signal_login_at(p_value text, p_captured timestamptz)
returns timestamptz
language sql
immutable
set search_path to ''
as $function$
  with parsed as (
    select date_trunc('day', p_captured, 'UTC') as day,
      substring(p_value from 'display:\s*none[^>]*>\s*([0-9]{1,4})\s*<') as hidden,
      lower(btrim(regexp_replace(p_value, '<[^>]*>', '', 'g'))) as visible
  )
  select case
    when p_value is null or p_captured is null then null
    when hidden is not null then day - make_interval(days => hidden::integer)
    when visible in ('today', 'online', 'now') then day
    when visible = 'yesterday' then day - interval '1 day'
    when visible ~ '^[0-9]{1,4}\s+days?\s+ago$' then day - make_interval(days => substring(visible from '([0-9]{1,4})')::integer)
    else null
  end
  from parsed;
$function$;

revoke all on function public.manager_signal_login_at(text, timestamptz) from public, anon;
grant execute on function public.manager_signal_login_at(text, timestamptz) to authenticated, service_role;
