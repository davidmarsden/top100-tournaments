-- Comparison managers are scored with the same inputs from Top 100's records as applicants:
-- the overview resolves each vacancy's comparison manager to a manager id and loads their inputs.
-- A comparison manager named on a vacancy, as a manager id (null when the name matches no one, or more than one).
-- @permissions private public.appointment_comparison_manager_id(text): helper called only by the security-definer appointment_admin_overview.
create or replace function public.appointment_comparison_manager_id(p_name text)
returns bigint
language sql
stable
set search_path to ''
as $function$
  select case when count(*) = 1 then min(m.id) end
  from public.managers m
  where lower(trim(p_name)) in (lower(m.name), lower(m.display_name));
$function$;

revoke all on function public.appointment_comparison_manager_id(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.appointment_admin_overview(p_world_slug text DEFAULT 'top-100'::text, p_season integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.comparison_manager is not null
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
$function$;
