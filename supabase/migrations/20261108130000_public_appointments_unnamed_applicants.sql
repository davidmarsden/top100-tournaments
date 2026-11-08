-- Published appointments: unsuccessful applicants are not named.
--
-- Top 100 has never published the names of managers who applied for a club and didn't get it.
-- The published vacancy scoring kept every applicant's name, current club and record, plus the
-- suggested allocation. Now only appointed managers keep their name and details; every other
-- applicant is shown as an unnamed applicant with their score and its breakdown only, their club
-- choices are kept under the same anonymous key (so each club still lists its own applicants),
-- and the allocation is left out. The admin pages are unchanged.

-- @permissions private public.appointment_public_vacancy_scores: used only by public_appointment_decisions below
create or replace function public.appointment_public_vacancy_scores(p_result jsonb, p_appointed text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with applicant as (
    select entry.value as item, entry.ordinality as ord,
           (entry.value->>'key') = any(coalesce(p_appointed, '{}')) as named,
           case when (entry.value->>'key') = any(coalesce(p_appointed, '{}')) then entry.value->>'key'
                else 'applicant-' || entry.ordinality end as public_key
    from jsonb_array_elements(coalesce(p_result->'applicants', '[]'::jsonb)) with ordinality as entry(value, ordinality)
  )
  select (p_result - 'allocation' - 'applicants' - 'preferences')
    || jsonb_build_object('applicants', coalesce((
         select jsonb_agg(case when applicant.named then applicant.item
                  else jsonb_build_object('key', applicant.public_key, 'display', null,
                    'byVacancy', (select coalesce(jsonb_object_agg(score.key, jsonb_build_object('total', score.value->'total', 'breakdown', score.value->'breakdown')), '{}'::jsonb)
                                  from jsonb_each(coalesce(applicant.item->'byVacancy', '{}'::jsonb)) as score(key, value)))
                  end order by applicant.ord)
         from applicant), '[]'::jsonb))
    || case when p_result ? 'preferences' then jsonb_build_object('preferences', coalesce((
         select jsonb_object_agg(applicant.public_key, p_result->'preferences'->(applicant.item->>'key'))
         from applicant where (p_result->'preferences') ? (applicant.item->>'key')), '{}'::jsonb))
       else '{}'::jsonb end;
$$;
revoke all on function public.appointment_public_vacancy_scores(jsonb, text[]) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_appointment_decisions(p_season integer DEFAULT NULL::integer, p_world_slug text DEFAULT 'top-100'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
  v_appointed text[];
begin
  select coalesce(array_agg(vacancy.appointed_manager_id::text), '{}') into v_appointed
  from public.appointment_vacancies vacancy
  where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.published_at is not null
    and vacancy.appointed_manager_id is not null;
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
                  case when round.kind = 'vacancies' then public.appointment_public_vacancy_scores(round.result - 'comparisons', v_appointed)
                       else round.result - 'comparisons' end)
                from public.appointment_rounds round
                where round.game_world_id = v_world and round.season = v_season and round.published_at is not null), '{}'::jsonb)
  );
end;
$function$;
