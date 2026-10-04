-- Derive current world manager assignments from the manager IDs already present in
-- approved Match Report / Results / Schedule source payloads. This avoids scraping
-- the Manager List DOM and treats match-level evidence as an observed assignment.

create or replace function public.refresh_soccer_manager_world_manager_assignments_from_matches(
  target_setup_id text
)
returns table(assignments_seen integer, assignments_linked integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world_id bigint;
  v_seen integer := 0;
  v_linked integer := 0;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select id into v_world_id
  from public.game_worlds
  where external_world_id::text = trim(target_setup_id)
  order by id limit 1;
  if v_world_id is null then raise exception 'No archived Soccer Manager world %', target_setup_id; end if;

  create temporary table if not exists _sm_manager_observations(
    source_club_id text,
    team_id bigint,
    source_manager_id text,
    source_manager_name text,
    observed_at timestamptz
  ) on commit drop;
  truncate _sm_manager_observations;

  -- Source payload field names vary between Schedule/Results/Match Report captures,
  -- so accept the verified spellings documented by the collectors/IMC comparison.
  insert into _sm_manager_observations
  select s.home_source_club_id, s.home_team_id,
    coalesce(s.source_data->>'homeManagerSmId',s.source_data->>'home_sm_manager_id',s.source_data->>'homeManagerId'),
    coalesce(s.source_data->>'homeManager',s.source_data->>'home_manager_name'),
    s.captured_at
  from public.soccer_manager_match_snapshots s
  where s.game_world_id=v_world_id
    and coalesce(s.source_data->>'homeManagerSmId',s.source_data->>'home_sm_manager_id',s.source_data->>'homeManagerId') is not null
  union all
  select s.away_source_club_id, s.away_team_id,
    coalesce(s.source_data->>'awayManagerSmId',s.source_data->>'away_sm_manager_id',s.source_data->>'awayManagerId'),
    coalesce(s.source_data->>'awayManager',s.source_data->>'away_manager_name'),
    s.captured_at
  from public.soccer_manager_match_snapshots s
  where s.game_world_id=v_world_id
    and coalesce(s.source_data->>'awayManagerSmId',s.source_data->>'away_sm_manager_id',s.source_data->>'awayManagerId') is not null;

  select count(*) into v_seen from _sm_manager_observations;

  -- Map stable SM manager IDs to an existing canonical human when we already know
  -- that identity. Never invent a human from a display name.
  with latest as (
    select distinct on(source_club_id)
      source_club_id,team_id,source_manager_id,source_manager_name,observed_at
    from _sm_manager_observations
    where nullif(trim(source_manager_id),'') is not null
    order by source_club_id,observed_at desc
  ), resolved as (
    select l.*,
      (select al.target_id
       from public.soccer_manager_archive_links al
       where al.source_type='manager' and al.target_type='manager'
         and split_part(al.source_key,':',2)=l.source_manager_id
       order by al.updated_at desc limit 1) manager_id
    from latest l
  )
  insert into public.soccer_manager_world_manager_assignments(
    game_world_id,manager_id,team_id,source_manager_key,source_manager_name,updated_at
  )
  select v_world_id,r.manager_id,r.team_id,
    trim(target_setup_id)||':'||r.source_manager_id,r.source_manager_name,r.observed_at
  from resolved r
  where r.manager_id is not null
  on conflict (game_world_id,manager_id) do update set
    team_id=excluded.team_id,
    source_manager_key=excluded.source_manager_key,
    source_manager_name=coalesce(excluded.source_manager_name,public.soccer_manager_world_manager_assignments.source_manager_name),
    updated_at=greatest(public.soccer_manager_world_manager_assignments.updated_at,excluded.updated_at);

  get diagnostics v_linked = row_count;
  return query select v_seen,v_linked;
end;
$$;

revoke all on function public.refresh_soccer_manager_world_manager_assignments_from_matches(text) from public,anon;
grant execute on function public.refresh_soccer_manager_world_manager_assignments_from_matches(text) to authenticated;
