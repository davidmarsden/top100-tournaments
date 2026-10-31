-- Each vacancy names a manager to compare applicants with: the club's outgoing (or previous)
-- manager. Admin only: the comparison is left out of the published scores.
alter table public.appointment_vacancies add column if not exists comparison_manager text;

update public.appointment_vacancies set comparison_manager = 'Dario Saviano'
where club_name = 'Borussia Dortmund' and season = 28 and comparison_manager is null;
update public.appointment_vacancies set comparison_manager = 'Luís André Libras-Boas'
where club_name = 'Hellas Verona' and season = 28 and comparison_manager is null;

drop function if exists public.upsert_appointment_vacancy(text, integer, text, timestamptz, bigint, integer, text);

-- A new vacancy compares with the club's current manager unless another is named.
create or replace function public.upsert_appointment_vacancy(
  p_club_name text, p_division integer, p_context text default null, p_closes_at timestamptz default null,
  p_id bigint default null, p_season integer default null, p_world_slug text default 'top-100',
  p_comparison_manager text default null)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_id bigint;
  v_comparison text := nullif(trim(p_comparison_manager), '');
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can publish vacancies.'; end if;
  if p_id is null then
    insert into public.appointment_vacancies (game_world_id, season, club_name, division, context, closes_at, comparison_manager)
    values (v_world, coalesce(p_season, public.appointment_current_season(p_world_slug)), trim(p_club_name), p_division,
            nullif(trim(p_context), ''), p_closes_at,
            coalesce(v_comparison, (select club.manager_name from public.appointment_world_managers(v_world) club
                                    where club.club_name = trim(p_club_name) limit 1)))
    returning id into v_id;
  else
    update public.appointment_vacancies vacancy
    set club_name = trim(p_club_name), division = p_division, context = nullif(trim(p_context), ''), closes_at = p_closes_at,
        comparison_manager = coalesce(v_comparison, vacancy.comparison_manager)
    where vacancy.id = p_id and vacancy.published_at is null
    returning id into v_id;
    if v_id is null then raise exception 'That vacancy is already published.'; end if;
  end if;
  return v_id;
end;
$function$;

revoke all on function public.upsert_appointment_vacancy(text, integer, text, timestamptz, bigint, integer, text, text) from public, anon;
grant execute on function public.upsert_appointment_vacancy(text, integer, text, timestamptz, bigint, integer, text, text) to authenticated;

-- Changing a vacancy's comparison manager, any time before it is published.
create or replace function public.set_appointment_vacancy_comparison(p_id bigint, p_manager text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can manage appointments.'; end if;
  update public.appointment_vacancies set comparison_manager = nullif(trim(p_manager), '')
  where id = p_id and published_at is null;
  if not found then raise exception 'That vacancy is already published.'; end if;
end;
$function$;

revoke all on function public.set_appointment_vacancy_comparison(bigint, text) from public, anon;
grant execute on function public.set_appointment_vacancy_comparison(bigint, text) to authenticated;

-- Published scores leave out the comparison managers.
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
                   'votes', coalesce((select jsonb_agg(jsonb_build_object('voter', vote.voter_name, 'choice', vote.choice, 'reason', vote.reason))
                             from public.appointment_votes vote where vote.subject_kind = 'vacancy' and vote.subject_id = vacancy.id), '[]'::jsonb))
                   order by vacancy.division, vacancy.club_name)
                 from public.appointment_vacancies vacancy
                 where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.published_at is not null), '[]'::jsonb),
    'scores', coalesce((select jsonb_object_agg(round.kind, round.result - 'comparisons')
                from public.appointment_rounds round
                where round.game_world_id = v_world and round.season = v_season and round.published_at is not null), '{}'::jsonb)
  );
end;
$function$;
