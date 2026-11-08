-- Archive a finished vacancies round, so another round can run in the same season (for example the
-- clubs left vacant by managers who moved). A season held only one vacancies round
-- (appointment_rounds is unique per season and kind), and a published round can't be rescored.
--
-- archive_appointment_round() (officials only):
--   * copies the round's scores and the season's applications into appointment_round_archives;
--   * marks its vacancies archived (published or withdrawn ones; open and undecided ones carry on);
--   * removes archived clubs from applications, deleting applications left with none;
--   * deletes the round row, so the next round can be scored and published.
-- Archived vacancies keep their votes and decisions and leave every working list. The public page
-- shows them as earlier rounds, each with the scores it was published with.

create table public.appointment_round_archives (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id),
  season integer not null check (season > 0),
  kind text not null check (kind = 'vacancies'),
  round jsonb,
  applications jsonb not null default '[]'::jsonb,
  archived_at timestamptz not null default now(),
  archived_by uuid
);
alter table public.appointment_round_archives enable row level security;
create index appointment_round_archives_world_season on public.appointment_round_archives (game_world_id, season);
-- @permissions private public.appointment_round_archives: read and written only through the appointment functions below

alter table public.appointment_vacancies
  add column archived_at timestamptz,
  add column archive_id bigint references public.appointment_round_archives(id);

-- A club can be vacant again in a later round of the same season.
alter table public.appointment_vacancies drop constraint appointment_vacancies_game_world_id_season_club_name_key;
create unique index appointment_vacancies_active_club on public.appointment_vacancies (game_world_id, season, club_name)
  where archived_at is null;

create or replace function public.archive_appointment_round(p_season integer default null, p_world_slug text default 'top-100')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
  v_round public.appointment_rounds%rowtype;
  v_ids bigint[];
  v_archive bigint;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can archive appointment rounds.'; end if;

  select * into v_round from public.appointment_rounds round
  where round.game_world_id = v_world and round.season = v_season and round.kind = 'vacancies';
  if found and v_round.published_at is null then
    raise exception 'Publish this round''s decisions before archiving it.';
  end if;
  if exists (select 1 from public.appointment_vacancies vacancy
             where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.archived_at is null
               and vacancy.decided_at is not null and vacancy.published_at is null) then
    raise exception 'A decision is recorded but not published yet. Publish it before archiving the round.';
  end if;

  select array_agg(vacancy.id) into v_ids from public.appointment_vacancies vacancy
  where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.archived_at is null
    and (vacancy.published_at is not null or vacancy.status = 'withdrawn');
  if v_ids is null then raise exception 'There are no published or withdrawn vacancies to archive.'; end if;

  insert into public.appointment_round_archives (game_world_id, season, kind, round, applications, archived_by)
  values (v_world, v_season, 'vacancies', case when v_round.id is null then null else to_jsonb(v_round) end,
          coalesce((select jsonb_agg(to_jsonb(application) order by application.submitted_at)
                    from public.appointment_applications application
                    where application.game_world_id = v_world and application.season = v_season), '[]'::jsonb),
          auth.uid())
  returning id into v_archive;

  update public.appointment_vacancies vacancy set archived_at = now(), archive_id = v_archive
  where vacancy.id = any (v_ids);

  -- Applications keep only the clubs still in play; one with none left is finished.
  update public.appointment_applications application
  set preferences = array(select chosen from unnest(application.preferences) with ordinality as p(chosen, n)
                          where chosen <> all (v_ids) order by n),
      updated_at = now()
  where application.game_world_id = v_world and application.season = v_season and application.preferences && v_ids;
  delete from public.appointment_applications application
  where application.game_world_id = v_world and application.season = v_season and coalesce(cardinality(application.preferences), 0) = 0;

  delete from public.appointment_rounds round where round.id = v_round.id;
  return v_archive;
end;
$$;

revoke all on function public.archive_appointment_round(integer, text) from public, anon;
grant execute on function public.archive_appointment_round(integer, text) to authenticated;

-- Officials' overview: archived vacancies (and their votes) leave the working lists; the season's
-- archived rounds are listed separately.
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
    union select public.appointment_comparison_manager_id(vacancy.comparison_manager) from public.appointment_vacancies vacancy
    where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.comparison_manager is not null and vacancy.archived_at is null
  ) managers where id is not null;
  return jsonb_build_object(
    'season', v_season,
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('club', club.club_name, 'division', club.division, 'position', club.position,
               'played', club.played, 'managerId', club.manager_id, 'manager', club.manager_name) order by club.division, club.position)
             from public.appointment_world_managers(v_world) club), '[]'::jsonb),
    'vacancies', coalesce((select jsonb_agg(to_jsonb(vacancy) || jsonb_build_object('appointedManager',
                   (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.appointed_manager_id),
                   'comparisonManagerId', public.appointment_comparison_manager_id(vacancy.comparison_manager))
                   order by vacancy.division, vacancy.club_name)
                 from public.appointment_vacancies vacancy
                 where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.archived_at is null), '[]'::jsonb),
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
    'archives', coalesce((select jsonb_agg(jsonb_build_object('id', archive.id, 'archivedAt', archive.archived_at,
                   'applications', jsonb_array_length(archive.applications),
                   'vacancies', coalesce((select jsonb_agg(jsonb_build_object('id', vacancy.id, 'club', vacancy.club_name, 'division', vacancy.division,
                                   'status', vacancy.status, 'publishedAt', vacancy.published_at,
                                   'appointed', (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.appointed_manager_id))
                                   order by vacancy.division, vacancy.club_name)
                                 from public.appointment_vacancies vacancy where vacancy.archive_id = archive.id), '[]'::jsonb))
                   order by archive.archived_at desc)
                 from public.appointment_round_archives archive
                 where archive.game_world_id = v_world and archive.season = v_season), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(to_jsonb(vote) || jsonb_build_object('mine', vote.voter = auth.uid()) order by vote.created_at)
               from public.appointment_votes vote
               where (vote.subject_kind = 'vacancy' and vote.subject_id in (select id from public.appointment_vacancies
                                                                           where game_world_id = v_world and season = v_season and archived_at is null))
                  or (vote.subject_kind = 'review' and vote.subject_id in (select id from public.appointment_reviews where game_world_id = v_world and season = v_season and cleared_at is null))), '[]'::jsonb),
    'inputs', public.appointment_manager_inputs(v_world, v_season, coalesce(v_ids, '{}')),
    -- Each official's community and sanctions assessment, averaged per manager; "mine" is the caller's.
    'assessments', coalesce((select jsonb_object_agg(per.manager_id::text, per.summary) from (
                     select assessed.manager_id, jsonb_strip_nulls(jsonb_build_object(
                       'community', round(avg(assessed.community), 2), 'communityCount', count(assessed.community),
                       'sanctions', round(avg(assessed.sanctions), 2), 'sanctionsCount', count(assessed.sanctions),
                       'assessors', jsonb_agg(assessed.assessor_name order by assessed.assessor_name),
                       'mine', (array_agg(jsonb_strip_nulls(jsonb_build_object('community', assessed.community, 'sanctions', assessed.sanctions)))
                                filter (where assessed.assessor = auth.uid()))[1])) as summary
                     from public.appointment_assessments assessed
                     where assessed.game_world_id = v_world and assessed.season = v_season
                     group by assessed.manager_id) per), '{}'::jsonb)
  );
end;
$$;

-- Manager Portal: archived vacancies are no longer listed.
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
                where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.status in ('open', 'closed')
                  and vacancy.archived_at is null), '[]'::jsonb),
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

-- Public decisions: the current round as before (archived vacancies left out), plus the season's
-- archived rounds, newest first, each with its published decisions and the scores published with it.
create or replace function public.public_appointment_decisions(p_season integer default null, p_world_slug text default 'top-100')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
begin
  return jsonb_build_object(
    'season', v_season,
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', review.id, 'club', review.club_name, 'division', review.division,
                 'position', review.position, 'manager', review.manager_name, 'decision', review.decision, 'reason', review.decision_reason,
                 'publishedAt', review.published_at,
                 'votes', coalesce((select jsonb_agg(jsonb_build_object('voter', vote.voter_name, 'choice', vote.choice, 'reason', vote.reason))
                           from public.appointment_votes vote where vote.subject_kind = 'review' and vote.subject_id = review.id), '[]'::jsonb))
                 order by review.division, review.position)
               from public.appointment_reviews review
               where review.game_world_id = v_world and review.season = v_season and review.published_at is not null), '[]'::jsonb),
    'vacancies', coalesce((select jsonb_agg(public.appointment_public_vacancy(vacancy) order by vacancy.division, vacancy.club_name)
                 from public.appointment_vacancies vacancy
                 where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.published_at is not null
                   and vacancy.archived_at is null), '[]'::jsonb),
    'scores', coalesce((select jsonb_object_agg(round.kind,
                  case when round.kind = 'vacancies' then public.appointment_public_vacancy_scores(round.result - 'comparisons')
                       else round.result - 'comparisons' end)
                from public.appointment_rounds round
                where round.game_world_id = v_world and round.season = v_season and round.published_at is not null), '{}'::jsonb),
    'archivedRounds', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', archive.id, 'archivedAt', archive.archived_at,
                   'vacancies', coalesce((select jsonb_agg(public.appointment_public_vacancy(vacancy) order by vacancy.division, vacancy.club_name)
                                 from public.appointment_vacancies vacancy
                                 where vacancy.archive_id = archive.id and vacancy.published_at is not null), '[]'::jsonb),
                   'scores', case when archive.round is not null and archive.round->>'published_at' is not null
                                  then jsonb_build_object('vacancies', public.appointment_public_vacancy_scores((archive.round->'result') - 'comparisons'))
                                  else '{}'::jsonb end)
                   order by archive.archived_at desc)
                 from public.appointment_round_archives archive
                 where archive.game_world_id = v_world and archive.season = v_season), '[]'::jsonb)
  );
end;
$$;

-- One published vacancy as the public sees it (votes only when the team chose to publish them).
create or replace function public.appointment_public_vacancy(vacancy public.appointment_vacancies)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', vacancy.id, 'club', vacancy.club_name, 'division', vacancy.division,
    'context', vacancy.context, 'appointed', (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.appointed_manager_id),
    'reason', vacancy.decision_reason, 'publishedAt', vacancy.published_at,
    'votes', case when vacancy.publish_votes then coalesce((select jsonb_agg(jsonb_build_object('voter', vote.voter_name, 'choice', vote.choice, 'reason', vote.reason))
                  from public.appointment_votes vote where vote.subject_kind = 'vacancy' and vote.subject_id = vacancy.id), '[]'::jsonb)
                  else '[]'::jsonb end);
$$;

-- @permissions private public.appointment_public_vacancy(public.appointment_vacancies): used only inside public_appointment_decisions()
revoke all on function public.appointment_public_vacancy(public.appointment_vacancies) from public, anon, authenticated;
