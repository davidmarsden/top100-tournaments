-- Published appointments: one list of applicants, not a list per club.
--
-- Top 100 doesn't publish which clubs each manager applied for, or show anyone as having missed
-- out on a particular job. The published vacancy scoring held every applicant's score for every
-- club, their current club and record, and the suggested allocation. Now the public decisions
-- carry one list: every applicant's name, a single appointment score and its breakdown, measured
-- against the highest division among the round's vacancies (the yardstick). Club choices, records
-- and the allocation are left out. The admin pages are unchanged.

-- @permissions private public.appointment_public_vacancy_scores: used only by public_appointment_decisions below
create or replace function public.appointment_public_vacancy_scores(p_result jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with yardstick as (
    select vacancy.value->>'club' as club, (vacancy.value->>'division')::int as division
    from jsonb_array_elements(coalesce(p_result->'vacancies', '[]'::jsonb)) as vacancy(value)
    order by (vacancy.value->>'division')::int, vacancy.value->>'club'
    limit 1
  ),
  applicant as (
    select entry.value->>'display' as display,
           entry.value->'byVacancy'->(select club from yardstick) as scored
    from jsonb_array_elements(coalesce(p_result->'applicants', '[]'::jsonb)) as entry(value)
  )
  select jsonb_build_object(
    'currentSeason', p_result->'currentSeason',
    'yardstickDivision', (select division from yardstick),
    'applicants', coalesce((
      select jsonb_agg(jsonb_build_object('display', applicant.display, 'total', applicant.scored->'total', 'breakdown', applicant.scored->'breakdown')
                       order by (applicant.scored->>'total')::numeric desc nulls last, applicant.display)
      from applicant where applicant.scored is not null), '[]'::jsonb));
$$;
revoke all on function public.appointment_public_vacancy_scores(jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_appointment_decisions(p_season integer DEFAULT NULL::integer, p_world_slug text DEFAULT 'top-100'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'vacancies', coalesce((select jsonb_agg(jsonb_build_object('id', vacancy.id, 'club', vacancy.club_name, 'division', vacancy.division,
                   'context', vacancy.context, 'appointed', (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.appointed_manager_id),
                   'reason', vacancy.decision_reason, 'publishedAt', vacancy.published_at,
                   'votes', case when vacancy.publish_votes then coalesce((select jsonb_agg(jsonb_build_object('voter', vote.voter_name, 'choice', vote.choice, 'reason', vote.reason))
                             from public.appointment_votes vote where vote.subject_kind = 'vacancy' and vote.subject_id = vacancy.id), '[]'::jsonb) else '[]'::jsonb end)
                   order by vacancy.division, vacancy.club_name)
                 from public.appointment_vacancies vacancy
                 where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.published_at is not null), '[]'::jsonb),
    'scores', coalesce((select jsonb_object_agg(round.kind,
                  case when round.kind = 'vacancies' then public.appointment_public_vacancy_scores(round.result - 'comparisons')
                       else round.result - 'comparisons' end)
                from public.appointment_rounds round
                where round.game_world_id = v_world and round.season = v_season and round.published_at is not null), '{}'::jsonb)
  );
end;
$function$;
