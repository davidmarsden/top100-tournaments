-- List clubs represented in the archived match dataset for Manager Lab.
create or replace function public.manager_lab_clubs(target_setup_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_id text := nullif(trim(target_setup_id), '');
  v_world_id bigint;
  result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Global admin access required'; end if;
  if setup_id is null or setup_id !~ '^[0-9]+$' then raise exception 'Soccer Manager setup id must be numeric'; end if;

  select id into v_world_id from public.game_worlds
  where external_world_id = setup_id::bigint order by id limit 1;
  if v_world_id is null then raise exception 'No archived Soccer Manager world %', setup_id; end if;

  with latest as (
    select distinct on (s.source_fixture_id) s.*
    from public.soccer_manager_match_snapshots s
    where s.game_world_id = v_world_id
    order by s.source_fixture_id, s.source_version desc
  ), appearances as (
    select home_source_club_id source_club_id, home_name name, source_fixture_id from latest
    union all
    select away_source_club_id, away_name, source_fixture_id from latest
  ), clubs as (
    select source_club_id, max(name) name, count(distinct source_fixture_id)::integer match_count
    from appearances
    where nullif(trim(source_club_id), '') is not null
    group by source_club_id
  )
  select jsonb_build_object(
    'setupId', setup_id,
    'clubs', coalesce(jsonb_agg(jsonb_build_object(
      'sourceClubId', source_club_id,
      'name', coalesce(name, source_club_id),
      'matchCount', match_count
    ) order by lower(coalesce(name, source_club_id))), '[]'::jsonb)
  ) into result
  from clubs;

  return result;
end;
$$;

revoke all on function public.manager_lab_clubs(text) from public, anon;
grant execute on function public.manager_lab_clubs(text) to authenticated, service_role;
