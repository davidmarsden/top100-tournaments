-- An appointee who declines a published appointment (rule 3.2: an appointment is offered to the
-- manager, who confirms within 24 hours). The decision stays published, as a record of what happened,
-- but the club is no longer filled: the public page shows who declined and when, the profile card and
-- Chat announcement no longer apply, and the club can be advertised again in the next round.
--
-- record_appointment_declined(p_id, p_note) (officials only): for a published vacancy with an
-- appointee, moves the appointee to declined_manager_id, records when and an optional note, and
-- clears appointed_manager_id.

alter table public.appointment_vacancies
  add column if not exists declined_at timestamptz,
  add column if not exists declined_manager_id bigint references public.managers(id),
  add column if not exists declined_note text check (declined_note is null or length(declined_note) <= 500);

create or replace function public.record_appointment_declined(p_id bigint, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy public.appointment_vacancies;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can record a declined appointment.'; end if;
  select * into v_vacancy from public.appointment_vacancies where id = p_id for update;
  if v_vacancy.id is null then raise exception 'No such vacancy.'; end if;
  if v_vacancy.published_at is null then raise exception 'Only a published appointment can be declined. Change the team decision instead.'; end if;
  if v_vacancy.appointed_manager_id is null then raise exception 'This vacancy has no appointee to decline it.'; end if;
  update public.appointment_vacancies
  set declined_manager_id = appointed_manager_id, declined_at = now(), declined_note = nullif(trim(p_note), ''),
      appointed_manager_id = null
  where id = p_id;
end;
$$;
revoke all on function public.record_appointment_declined(bigint, text) from public, anon;
grant execute on function public.record_appointment_declined(bigint, text) to authenticated;

-- One published vacancy as the public sees it, now with any declined appointment.
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
    'declined', (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.declined_manager_id),
    'declinedAt', vacancy.declined_at, 'declinedNote', vacancy.declined_note,
    'votes', case when vacancy.publish_votes then coalesce((select jsonb_agg(jsonb_build_object('voter', vote.voter_name, 'choice', vote.choice, 'reason', vote.reason))
                  from public.appointment_votes vote where vote.subject_kind = 'vacancy' and vote.subject_id = vacancy.id), '[]'::jsonb)
                  else '[]'::jsonb end);
$$;

revoke all on function public.appointment_public_vacancy(public.appointment_vacancies) from public, anon, authenticated;

-- Admin overview: archived rounds now show a declined appointment (and the admin page offers
-- "Appointee declined" there, since a round is often archived soon after publishing).
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
                                   'appointed', (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.appointed_manager_id),
                                   'declined', (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.declined_manager_id),
                                   'declinedAt', vacancy.declined_at)
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
