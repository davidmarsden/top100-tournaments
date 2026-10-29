-- Appointments: bottom-three reviews start before the season ends (three games out), so they
-- include every club that can still mathematically finish in the bottom three, not only the
-- current bottom three. Each load refreshes positions and points, marks the clubs certain to
-- finish there, and drops clubs that are now safe (unless already decided or published).
set check_function_bodies = false;

alter table public.appointment_reviews add column if not exists points integer;
alter table public.appointment_reviews add column if not exists games_left integer;
alter table public.appointment_reviews add column if not exists certain boolean not null default true;

-- Every club that can still finish in its division's bottom three. A club can, when at least
-- (clubs - 3) others can still finish level with or above its current points (it may not win
-- again); it is certain to, when that many are already out of its reach. Ties count as
-- possible, since goal difference can go either way. Once a division's games are all played,
-- the final positions decide.
create or replace function public.appointment_bottom_three_candidates(p_world_id bigint)
returns table (club_name text, division integer, "position" integer, manager_id bigint, manager_name text,
               points integer, games_left integer, certain boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with club as (
    select managed.club_name, managed.division, managed.position, managed.manager_id, managed.manager_name,
      coalesce(standing.points, 0) as points,
      greatest(2 * (count(*) over (partition by managed.division)) - 2 - coalesce(managed.played, 0), 0)::integer as games_left,
      count(*) over (partition by managed.division) as clubs
    from public.appointment_world_managers(p_world_id) managed
    left join public.league_standings_current_by_club standing
      on standing.game_world_id = p_world_id and standing.game_world_club_id = managed.game_world_club_id
  ), judged as (
    select club.*,
      case when (select max(other.games_left) from club other where other.division = club.division) = 0
        then club.position > club.clubs - 3
        else (select count(*) from club other where other.division = club.division and other.club_name <> club.club_name
                and other.points + 3 * other.games_left >= club.points) >= club.clubs - 3 end as possible,
      case when (select max(other.games_left) from club other where other.division = club.division) = 0
        then club.position > club.clubs - 3
        else (select count(*) from club other where other.division = club.division and other.club_name <> club.club_name
                and other.points > club.points + 3 * club.games_left) >= club.clubs - 3 end as is_certain
    from club
  )
  select judged.club_name, judged.division, judged.position, judged.manager_id, judged.manager_name,
    judged.points, judged.games_left, judged.is_certain
  from judged where judged.possible;
$$;

revoke all on function public.appointment_bottom_three_candidates(bigint) from public, anon, authenticated;

-- @permissions private public.appointment_bottom_three_candidates: used only by load_appointment_reviews

create or replace function public.load_appointment_reviews(p_season integer default null, p_world_slug text default 'top-100')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
  v_dropped bigint[];
  v_count integer;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can load reviews.'; end if;

  insert into public.appointment_reviews (game_world_id, season, club_name, division, position, manager_id, manager_name, points, games_left, certain)
  select v_world, v_season, candidate.club_name, candidate.division, candidate.position, candidate.manager_id, candidate.manager_name,
    candidate.points, candidate.games_left, candidate.certain
  from public.appointment_bottom_three_candidates(v_world) candidate
  on conflict (game_world_id, season, club_name) do update
    set division = excluded.division, position = excluded.position, points = excluded.points,
        games_left = excluded.games_left, certain = excluded.certain
    where public.appointment_reviews.published_at is null;

  -- Clubs that are now safe: no review, unless the admin team has already decided it.
  select coalesce(array_agg(review.id), '{}') into v_dropped
  from public.appointment_reviews review
  where review.game_world_id = v_world and review.season = v_season
    and review.published_at is null and review.decision is null
    and review.club_name not in (select candidate.club_name from public.appointment_bottom_three_candidates(v_world) candidate);
  delete from public.appointment_votes vote where vote.subject_kind = 'review' and vote.subject_id = any(v_dropped);
  delete from public.appointment_reviews review where review.id = any(v_dropped);

  select count(*) into v_count from public.appointment_reviews review
  where review.game_world_id = v_world and review.season = v_season;
  return v_count;
end;
$$;

revoke all on function public.load_appointment_reviews(integer, text) from public, anon;
grant execute on function public.load_appointment_reviews(integer, text) to authenticated;

-- The manager's review now says whether the bottom three is certain yet, and when they answered.
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
                 'wish', review.wish, 'wishNote', review.wish_note, 'wishAt', review.wish_at,
                 'certain', review.certain, 'gamesLeft', review.games_left,
                 'decision', case when review.published_at is not null then review.decision end,
                 'reason', case when review.published_at is not null then review.decision_reason end)
               from public.appointment_reviews review
               where review.game_world_id = v_world and review.season = v_season and review.manager_id = v_manager)
  );
end;
$$;

revoke all on function public.my_appointments(text) from public, anon;
grant execute on function public.my_appointments(text) to authenticated;
