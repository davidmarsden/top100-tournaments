-- Admin-only read model for the first Manager Lab match-performance dashboard.

create or replace function public.manager_lab_match_summary(
  target_setup_id text,
  target_source_club_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_id text := nullif(trim(target_setup_id), '');
  source_club_id text := nullif(trim(target_source_club_id), '');
  v_world_id bigint;
  result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;

  if setup_id is null or setup_id !~ '^[0-9]+$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;

  select id into v_world_id
  from public.game_worlds
  where external_world_id = setup_id::bigint
  order by id limit 1;

  if v_world_id is null then
    raise exception 'No archived Soccer Manager world %', setup_id;
  end if;

  if source_club_id is null then
    select coalesce(s.home_source_club_id, s.away_source_club_id)
      into source_club_id
    from public.soccer_manager_match_snapshots s
    where s.game_world_id = v_world_id
    order by s.captured_at desc, s.id desc
    limit 1;
  end if;

  with latest as (
    select distinct on (s.source_fixture_id) s.*
    from public.soccer_manager_match_snapshots s
    where s.game_world_id = v_world_id
      and source_club_id in (s.home_source_club_id, s.away_source_club_id)
    order by s.source_fixture_id, s.source_version desc
  ), matches as (
    select
      s.source_fixture_id as "fixtureId",
      coalesce(s.source_data->'fixture'->>'date', s.source_data->>'turnDate') as "date",
      coalesce(s.competition_name, s.source_data->'competition'->>'name', 'Unknown') as competition,
      case when s.home_source_club_id = source_club_id then s.away_name else s.home_name end as opponent,
      case when s.home_source_club_id = source_club_id then 'H' else 'A' end as venue,
      case when s.home_source_club_id = source_club_id then s.home_score else s.away_score end as "goalsFor",
      case when s.home_source_club_id = source_club_id then s.away_score else s.home_score end as "goalsAgainst",
      case
        when (case when s.home_source_club_id = source_club_id then s.home_score else s.away_score end) >
             (case when s.home_source_club_id = source_club_id then s.away_score else s.home_score end) then 'W'
        when s.home_score = s.away_score then 'D'
        else 'L'
      end as result,
      case when s.home_source_club_id = source_club_id
        then nullif(s.source_data->'stats'->'home'->>'possession','')::numeric
        else nullif(s.source_data->'stats'->'away'->>'possession','')::numeric end as possession,
      case when s.home_source_club_id = source_club_id
        then nullif(s.source_data->'stats'->'home'->>'shots','')::integer
        else nullif(s.source_data->'stats'->'away'->>'shots','')::integer end as shots,
      case when s.home_source_club_id = source_club_id
        then nullif(s.source_data->'stats'->'home'->>'shotsOnTarget','')::integer
        else nullif(s.source_data->'stats'->'away'->>'shotsOnTarget','')::integer end as "shotsOnTarget",
      case when s.home_source_club_id = source_club_id
        then nullif(s.source_data->'stats'->'home'->>'corners','')::integer
        else nullif(s.source_data->'stats'->'away'->>'corners','')::integer end as corners,
      case when s.home_source_club_id = source_club_id then s.source_data->'tactics'->'home' else s.source_data->'tactics'->'away' end as tactics
    from latest s
  )
  select jsonb_build_object(
    'setupId', setup_id,
    'sourceClubId', source_club_id,
    'matches', coalesce(jsonb_agg(to_jsonb(matches) order by "date", "fixtureId"), '[]'::jsonb)
  ) into result
  from matches;

  return result;
end;
$$;

revoke all on function public.manager_lab_match_summary(text, text) from public, anon;
grant execute on function public.manager_lab_match_summary(text, text) to authenticated, service_role;
