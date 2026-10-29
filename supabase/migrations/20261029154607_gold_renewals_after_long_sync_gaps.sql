-- Gold renewals found however long between syncs. The first version only saw a renewal when
-- the end date jumped by more than the time between syncs, so 20 days left on 1 October then
-- 19 on 1 November (a renewal) kept the October end date and raised a false "Gold ended".
set check_function_bodies = false;

-- Each club's current manager's Gold end date. Every sync implies one (its date plus the days
-- left). Only 0-day readings drift (Soccer Manager keeps showing 0 after Gold runs out), so a
-- renewal is a reading with days left whose end date is more than a day later than the one
-- before, however long between syncs; the end date is the earliest implied since then.
create or replace function public.manager_gold_expiry(p_source_world bigint)
returns table (source_club_id text, sm_manager_id text, expires_on date)
language sql
stable
security definer
set search_path = ''
as $$
  with readings as (
    select snapshot.source_club_id, snapshot.sm_manager_id, snapshot.captured_at,
      snapshot.gold_days_left,
      (snapshot.captured_at at time zone 'UTC')::date as day,
      (snapshot.captured_at at time zone 'UTC')::date + snapshot.gold_days_left as implied
    from public.manager_signal_snapshots snapshot
    where snapshot.source_world_id = p_source_world and snapshot.gold_days_left is not null and snapshot.sm_manager_id is not null
  ), stepped as (
    select readings.*,
      lag(readings.implied) over by_manager as previous_implied
    from readings
    window by_manager as (partition by readings.source_club_id, readings.sm_manager_id order by readings.captured_at)
  ), renewals as (
    select stepped.*,
      sum(case when stepped.previous_implied is not null and stepped.gold_days_left > 0
               and stepped.implied > stepped.previous_implied + 1 then 1 else 0 end)
        over (partition by stepped.source_club_id, stepped.sm_manager_id order by stepped.captured_at) as period
    from stepped
  ), current_period as (
    select renewals.*, max(renewals.period) over (partition by renewals.source_club_id, renewals.sm_manager_id) as last_period
    from renewals
  )
  select current_period.source_club_id, current_period.sm_manager_id, min(current_period.implied)
  from current_period
  where current_period.period = current_period.last_period
  group by current_period.source_club_id, current_period.sm_manager_id;
$$;

revoke all on function public.manager_gold_expiry(bigint) from public, anon, authenticated;

-- @permissions private public.manager_gold_expiry: used only by the manager status and appointment functions
