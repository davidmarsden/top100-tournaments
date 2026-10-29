-- Appointments: mark mid-season takeovers automatically. A manager whose club assignment
-- was first recorded after the season started took over mid-season. The sync records when it
-- first saw each assignment, so takeovers before the sync started (S28: game 25) still need
-- the admin team's tick; loading never unticks one.
set check_function_bodies = false;

-- Clubs whose current manager took over after this season started. The season start is
-- the first league snapshot with two or fewer games played in the last 150 days, or, for a
-- season already under way when the sync began, the sync's first assignment.
create or replace function public.appointment_mid_season_clubs(p_world_id bigint)
returns table (club_name text, assigned_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with season_start as (
    select coalesce(
      (select min(snapshot.captured_at) from public.league_standing_snapshots snapshot
       where snapshot.game_world_id = p_world_id and snapshot.played <= 2 and snapshot.captured_at > now() - interval '150 days'),
      (select min(assignment.assigned_at) from public.soccer_manager_world_manager_assignments assignment
       where assignment.game_world_id = p_world_id)) as started_at
  )
  select managed.club_name, assignment.assigned_at
  from season_start, public.appointment_world_managers(p_world_id) managed
  join public.soccer_manager_club_crosswalk crosswalk on crosswalk.game_world_club_id = managed.game_world_club_id
  join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = p_world_id and assignment.team_id = crosswalk.team_id
  where assignment.assigned_at > season_start.started_at + interval '2 days';
$$;

revoke all on function public.appointment_mid_season_clubs(bigint) from public, anon, authenticated;

-- @permissions private public.appointment_mid_season_clubs: used only by load_appointment_reviews

create or replace function public.load_appointment_reviews(p_season integer default null, p_world_slug text default 'top-100')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
  v_count integer;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can load reviews.'; end if;

  insert into public.appointment_reviews (game_world_id, season, club_name, division, position, manager_id, manager_name, points, games_left, certain)
  select v_world, v_season, candidate.club_name, candidate.division, candidate.position, candidate.manager_id, candidate.manager_name,
    candidate.points, candidate.games_left, candidate.certain
  from public.appointment_bottom_three_candidates(v_world) candidate
  on conflict (game_world_id, season, club_name) do update
    set division = excluded.division, position = excluded.position, points = excluded.points,
        games_left = excluded.games_left, certain = excluded.certain, cleared_at = null
    where public.appointment_reviews.published_at is null;

  -- Managers Top 100's records show taking over after the season started.
  update public.appointment_reviews review set took_over_mid_season = true
  where review.game_world_id = v_world and review.season = v_season
    and review.published_at is null and not review.took_over_mid_season
    and review.club_name in (select mid.club_name from public.appointment_mid_season_clubs(v_world) mid);

  -- Clubs that have finished clear: hidden, unless the admin team has already decided them.
  update public.appointment_reviews review set cleared_at = now()
  where review.game_world_id = v_world and review.season = v_season
    and review.published_at is null and review.decision is null and review.cleared_at is null
    and review.club_name not in (select candidate.club_name from public.appointment_bottom_three_candidates(v_world) candidate);

  select count(*) into v_count from public.appointment_reviews review
  where review.game_world_id = v_world and review.season = v_season and review.cleared_at is null;
  return v_count;
end;
$$;

revoke all on function public.load_appointment_reviews(integer, text) from public, anon;
grant execute on function public.load_appointment_reviews(integer, text) to authenticated;
