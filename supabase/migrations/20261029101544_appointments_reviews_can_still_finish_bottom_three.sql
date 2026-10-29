-- Appointments: bottom-three reviews start before the season ends (three games out), so they
-- include every club that can still mathematically finish in the bottom three, not only the
-- current bottom three. Each load refreshes positions and points and marks the clubs certain
-- to finish there. Clubs that have since finished clear are marked cleared (not deleted, so
-- nothing is lost if one comes back) and are left out everywhere, unless already decided.
set check_function_bodies = false;

alter table public.appointment_reviews add column if not exists points integer;
alter table public.appointment_reviews add column if not exists games_left integer;
alter table public.appointment_reviews add column if not exists certain boolean not null default true;
alter table public.appointment_reviews add column if not exists cleared_at timestamptz;

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

-- Cleared reviews are left out of everything below.
create or replace function public.appointment_admin_overview(p_world_slug text default 'top-100', p_season integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
  v_ids bigint[];
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can manage appointments.'; end if;
  select array_agg(distinct id) into v_ids from (
    select application.manager_id as id from public.appointment_applications application
    where application.game_world_id = v_world and application.season = v_season
    union select review.manager_id from public.appointment_reviews review
    where review.game_world_id = v_world and review.season = v_season and review.manager_id is not null and review.cleared_at is null
  ) managers;
  return jsonb_build_object(
    'season', v_season,
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('club', club.club_name, 'division', club.division, 'position', club.position,
               'played', club.played, 'managerId', club.manager_id, 'manager', club.manager_name) order by club.division, club.position)
             from public.appointment_world_managers(v_world) club), '[]'::jsonb),
    'vacancies', coalesce((select jsonb_agg(to_jsonb(vacancy) || jsonb_build_object('appointedManager',
                   (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.appointed_manager_id))
                   order by vacancy.division, vacancy.club_name)
                 from public.appointment_vacancies vacancy where vacancy.game_world_id = v_world and vacancy.season = v_season), '[]'::jsonb),
    'applications', coalesce((select jsonb_agg(to_jsonb(application) || jsonb_build_object(
                     'managerName', club.manager_name, 'club', club.club_name, 'clubDivision', club.division, 'clubPosition', club.position)
                     order by application.submitted_at)
                   from public.appointment_applications application
                   left join lateral (select * from public.appointment_world_managers(v_world) c where c.manager_id = application.manager_id limit 1) club on true
                   where application.game_world_id = v_world and application.season = v_season), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(review) order by review.division, review.position)
                 from public.appointment_reviews review where review.game_world_id = v_world and review.season = v_season and review.cleared_at is null), '[]'::jsonb),
    'rounds', coalesce((select jsonb_object_agg(round.kind, to_jsonb(round))
                from public.appointment_rounds round where round.game_world_id = v_world and round.season = v_season), '{}'::jsonb),
    'votes', coalesce((select jsonb_agg(to_jsonb(vote) || jsonb_build_object('mine', vote.voter = auth.uid()) order by vote.created_at)
               from public.appointment_votes vote
               where (vote.subject_kind = 'vacancy' and vote.subject_id in (select id from public.appointment_vacancies where game_world_id = v_world and season = v_season))
                  or (vote.subject_kind = 'review' and vote.subject_id in (select id from public.appointment_reviews where game_world_id = v_world and season = v_season and cleared_at is null))), '[]'::jsonb),
    'inputs', public.appointment_manager_inputs(v_world, v_season, coalesce(v_ids, '{}'))
  );
end;
$$;

revoke all on function public.appointment_admin_overview(text, integer) from public, anon;
grant execute on function public.appointment_admin_overview(text, integer) to authenticated;

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
               where review.game_world_id = v_world and review.season = v_season and review.manager_id = v_manager and review.cleared_at is null)
  );
end;
$$;

revoke all on function public.my_appointments(text) from public, anon;
grant execute on function public.my_appointments(text) to authenticated;

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
    and review.manager_id = v_manager and review.published_at is null and review.cleared_at is null
  returning review.id into v_review;
  if v_review is null then raise exception 'You have no open bottom-three review.'; end if;
  return public.my_appointments(p_world_slug);
end;
$$;

revoke all on function public.set_review_wish(text, text, text) from public, anon;
grant execute on function public.set_review_wish(text, text, text) to authenticated;

create or replace function public.cast_appointment_vote(p_subject_kind text, p_subject_id bigint, p_choice text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can vote.'; end if;
  if p_subject_kind = 'vacancy' and not exists (select 1 from public.appointment_vacancies where id = p_subject_id and published_at is null)
     or p_subject_kind = 'review' and not exists (select 1 from public.appointment_reviews where id = p_subject_id and published_at is null and cleared_at is null)
     or p_subject_kind not in ('vacancy', 'review') then
    raise exception 'That decision is not open for votes.';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Every vote needs a reason.'; end if;
  select coalesce(manager.display_name, manager.name) into v_name
  from public.manager_portal_accounts account join public.managers manager on manager.id = account.manager_id
  where account.auth_user_id = auth.uid() and account.active order by account.id limit 1;
  insert into public.appointment_votes (subject_kind, subject_id, voter, voter_name, choice, reason)
  values (p_subject_kind, p_subject_id, auth.uid(), v_name, trim(p_choice), trim(p_reason))
  on conflict (subject_kind, subject_id, voter) do update set choice = excluded.choice, reason = excluded.reason, updated_at = now();
end;
$$;

revoke all on function public.cast_appointment_vote(text, bigint, text, text) from public, anon;
grant execute on function public.cast_appointment_vote(text, bigint, text, text) to authenticated;

create or replace function public.decide_appointment_review(p_id bigint, p_decision text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can decide reviews.'; end if;
  if p_decision is not null and p_decision not in ('reappoint', 'secondChance', 'anotherClub', 'leave') then raise exception 'Unknown decision %', p_decision; end if;
  update public.appointment_reviews review
  set decision = p_decision, decision_reason = nullif(trim(p_reason), ''), decided_at = case when p_decision is null then null else now() end
  where review.id = p_id and review.published_at is null and review.cleared_at is null;
end;
$$;

revoke all on function public.decide_appointment_review(bigint, text, text) from public, anon;
grant execute on function public.decide_appointment_review(bigint, text, text) to authenticated;
