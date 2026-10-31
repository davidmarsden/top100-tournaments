-- Community and sanctions are assessed by each official separately; scoring uses the average.
create table if not exists public.appointment_assessments (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id),
  season integer not null,
  manager_id bigint not null references public.managers(id),
  assessor uuid not null,
  assessor_name text,
  community numeric check (community between 0 and 3),
  sanctions numeric check (sanctions between 0 and 5),
  updated_at timestamptz not null default now(),
  unique (game_world_id, season, manager_id, assessor)
);
create index if not exists appointment_assessments_manager_idx on public.appointment_assessments (manager_id);
alter table public.appointment_assessments enable row level security;
-- @permissions private public.appointment_assessments: read and written only through the officials' security-definer functions.
revoke all on public.appointment_assessments from anon, authenticated;

-- An official's own assessment of one manager this season; both blank removes it.
create or replace function public.set_appointment_assessment(p_manager_id bigint, p_community numeric, p_sanctions numeric,
  p_season integer default null, p_world_slug text default 'top-100')
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
  v_name text;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can assess managers.'; end if;
  if p_community is not null and (p_community < 0 or p_community > 3) then raise exception 'Community and social is 0 to 3.'; end if;
  if p_sanctions is not null and (p_sanctions < 0 or p_sanctions > 5) then raise exception 'Sanctions is 0 to 5.'; end if;
  if p_community is null and p_sanctions is null then
    delete from public.appointment_assessments
    where game_world_id = v_world and season = v_season and manager_id = p_manager_id and assessor = auth.uid();
    return;
  end if;
  select coalesce(manager.display_name, manager.name) into v_name
  from public.manager_portal_accounts account join public.managers manager on manager.id = account.manager_id
  where account.auth_user_id = auth.uid() and account.active order by account.id limit 1;
  insert into public.appointment_assessments (game_world_id, season, manager_id, assessor, assessor_name, community, sanctions)
  values (v_world, v_season, p_manager_id, auth.uid(), v_name, p_community, p_sanctions)
  on conflict (game_world_id, season, manager_id, assessor)
  do update set community = excluded.community, sanctions = excluded.sanctions, assessor_name = excluded.assessor_name, updated_at = now();
end;
$function$;

revoke all on function public.set_appointment_assessment(bigint, numeric, numeric, integer, text) from public, anon;
grant execute on function public.set_appointment_assessment(bigint, numeric, numeric, integer, text) to authenticated;

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
$function$;
