-- Appointments (rulebook 3.1, 3.2): see 20261029013005_appointments_tables_and_helpers.sql.
-- SQL function bodies depend on Manager Lab objects, so they are not checked here.
set check_function_bodies = false;

-- ── Managers ────────────────────────────────────────────────────────────────

-- What the signed-in manager sees: their club, the open vacancies, their
-- application, their bottom-three review (if any) and the published decisions.
create or replace function public.my_appointments(p_world_slug text default 'top-100')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := public.appointment_current_season(p_world_slug);
  v_manager bigint := public.appointment_my_manager_id();
begin
  if v_manager is null then return jsonb_build_object('season', v_season, 'manager', null); end if;
  return jsonb_build_object(
    'season', v_season,
    'manager', (select jsonb_build_object('id', club.manager_id, 'name', club.manager_name, 'club', club.club_name,
                  'division', club.division, 'position', club.position)
                from public.appointment_world_managers(v_world) club where club.manager_id = v_manager limit 1),
    'gold', (select jsonb_build_object('gold', snapshot.gold, 'daysLeft', snapshot.gold_days_left)
             from public.manager_signal_snapshots snapshot
             where snapshot.game_world_id = v_world and snapshot.manager_id = v_manager
             order by snapshot.captured_at desc limit 1),
    'vacancies', coalesce((select jsonb_agg(jsonb_build_object('id', vacancy.id, 'club', vacancy.club_name, 'division', vacancy.division,
                  'context', vacancy.context, 'closesAt', vacancy.closes_at,
                  'open', vacancy.status = 'open' and (vacancy.closes_at is null or vacancy.closes_at > now()))
                  order by vacancy.division, vacancy.club_name)
                from public.appointment_vacancies vacancy
                where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.status in ('open', 'closed')), '[]'::jsonb),
    'application', (select jsonb_build_object('preferences', application.preferences, 'note', application.note,
                      'status', application.status, 'submittedAt', application.submitted_at, 'updatedAt', application.updated_at)
                    from public.appointment_applications application
                    where application.game_world_id = v_world and application.season = v_season and application.manager_id = v_manager),
    'review', (select jsonb_build_object('id', review.id, 'club', review.club_name, 'division', review.division, 'position', review.position,
                 'wish', review.wish, 'wishNote', review.wish_note,
                 'decision', case when review.published_at is not null then review.decision end,
                 'reason', case when review.published_at is not null then review.decision_reason end)
               from public.appointment_reviews review
               where review.game_world_id = v_world and review.season = v_season and review.manager_id = v_manager)
  );
end;
$$;

revoke all on function public.my_appointments(text) from public, anon;
grant execute on function public.my_appointments(text) to authenticated;

-- Apply (or change an application) for this season's open vacancies, in order of preference.
create or replace function public.submit_vacancy_application(p_vacancy_ids bigint[], p_note text default null, p_world_slug text default 'top-100')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := public.appointment_current_season(p_world_slug);
  v_manager bigint := public.appointment_my_manager_id();
  v_ids bigint[];
  v_gold boolean;
  v_club text;
begin
  if v_manager is null then raise exception 'Sign in with your Manager Portal account to apply.'; end if;
  select array_agg(id order by ordinality) into v_ids
  from (select distinct on (id) id, ordinality from unnest(p_vacancy_ids) with ordinality as chosen(id, ordinality) order by id, ordinality) chosen;
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Choose at least one club.'; end if;
  if exists (select 1 from unnest(v_ids) chosen(id)
             where not exists (select 1 from public.appointment_vacancies vacancy
                               where vacancy.id = chosen.id and vacancy.game_world_id = v_world and vacancy.season = v_season
                                 and vacancy.status = 'open' and (vacancy.closes_at is null or vacancy.closes_at > now()))) then
    raise exception 'Applications for one of those clubs are closed.';
  end if;

  select snapshot.gold into v_gold from public.manager_signal_snapshots snapshot
  where snapshot.game_world_id = v_world and snapshot.manager_id = v_manager order by snapshot.captured_at desc limit 1;
  if v_gold is false then raise exception 'Every Top 100 manager must be a Gold member, so applying needs Gold membership.'; end if;

  select club.club_name into v_club from public.appointment_world_managers(v_world) club where club.manager_id = v_manager limit 1;
  if exists (select 1 from public.appointment_vacancies vacancy where vacancy.id = any (v_ids) and vacancy.club_name = v_club) then
    raise exception 'You already manage %.', v_club;
  end if;

  insert into public.appointment_applications (game_world_id, season, manager_id, preferences, note, status)
  values (v_world, v_season, v_manager, v_ids, nullif(trim(p_note), ''), 'active')
  on conflict (game_world_id, season, manager_id) do update
    set preferences = excluded.preferences, note = excluded.note, status = 'active', updated_at = now();
  return public.my_appointments(p_world_slug);
end;
$$;

revoke all on function public.submit_vacancy_application(bigint[], text, text) from public, anon;
grant execute on function public.submit_vacancy_application(bigint[], text, text) to authenticated;

create or replace function public.withdraw_vacancy_application(p_world_slug text default 'top-100')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager bigint := public.appointment_my_manager_id();
begin
  if v_manager is null then raise exception 'Sign in with your Manager Portal account.'; end if;
  update public.appointment_applications application set status = 'withdrawn', updated_at = now()
  where application.game_world_id = public.appointment_world_id(p_world_slug)
    and application.season = public.appointment_current_season(p_world_slug) and application.manager_id = v_manager;
  return public.my_appointments(p_world_slug);
end;
$$;

revoke all on function public.withdraw_vacancy_application(text) from public, anon;
grant execute on function public.withdraw_vacancy_application(text) to authenticated;

-- A bottom-three manager says whether they want to stay, move or take a break.
create or replace function public.set_review_wish(p_wish text, p_note text default null, p_world_slug text default 'top-100')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager bigint := public.appointment_my_manager_id();
  v_review bigint;
begin
  if v_manager is null then raise exception 'Sign in with your Manager Portal account.'; end if;
  if p_wish is not null and p_wish not in ('stay', 'move', 'break') then raise exception 'Choose stay, move or break.'; end if;
  update public.appointment_reviews review
  set wish = p_wish, wish_note = nullif(trim(p_note), ''), wish_at = now()
  where review.game_world_id = public.appointment_world_id(p_world_slug)
    and review.season = public.appointment_current_season(p_world_slug)
    and review.manager_id = v_manager and review.published_at is null
  returning review.id into v_review;
  if v_review is null then raise exception 'You have no open bottom-three review.'; end if;
  return public.my_appointments(p_world_slug);
end;
$$;

revoke all on function public.set_review_wish(text, text, text) from public, anon;
grant execute on function public.set_review_wish(text, text, text) to authenticated;
