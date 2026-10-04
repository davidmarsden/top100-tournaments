-- Allow trusted service/database maintenance execution of the manager-assignment
-- refresh while retaining the existing Top 100 admin requirement for user sessions.

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
  v_role text := coalesce(auth.role(), '');
begin
  if v_role <> 'service_role' and session_user not in ('postgres', 'supabase_admin') and not public.is_admin() then
    raise exception 'Admin access required';
  end if;

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

  insert into _sm_manager_observations
  select
    nullif(trim(e.payload->>'clubId'), ''),
    nullif(e.payload->>'teamId', '')::bigint,
    nullif(trim(coalesce(e.payload->>'customerID', e.payload->>'customerId', e.payload->>'managerId')), ''),
    nullif(trim(coalesce(e.payload->>'managerName', e.payload->>'name')), ''),
    e.observed_at
  from public.soccer_manager_archive_events e
  where e.game_world_id = v_world_id
    and e.event_type = 'manager_assignment'
    and nullif(trim(coalesce(e.payload->>'customerID', e.payload->>'customerId', e.payload->>'managerId')), '') is not null;

  select count(*) into v_seen from _sm_manager_observations;

  with latest as (
    select distinct on(source_club_id)
      source_club_id, team_id, source_manager_id, source_manager_name, observed_at
    from _sm_manager_observations
    where source_club_id is not null and source_manager_id is not null
    order by source_club_id, observed_at desc
  ), resolved as (
    select l.*,
      (select al.target_id
       from public.soccer_manager_archive_links al
       where al.source_type = 'manager'
         and al.target_type = 'manager'
         and split_part(al.source_key, ':', 2) = l.source_manager_id
       group by al.target_id
       having count(distinct al.target_id) = 1
       order by max(al.updated_at) desc
       limit 1) manager_id,
      coalesce(l.team_id,
        (select al.target_id
         from public.soccer_manager_archive_links al
         where al.source_type = 'club'
           and al.target_type = 'team'
           and al.source_key = trim(target_setup_id) || ':' || l.source_club_id
         order by al.updated_at desc limit 1)) resolved_team_id
    from latest l
  )
  insert into public.soccer_manager_world_manager_assignments(
    game_world_id, manager_id, team_id, source_manager_key, source_manager_name, updated_at
  )
  select v_world_id, r.manager_id, r.resolved_team_id,
    trim(target_setup_id) || ':' || r.source_manager_id, r.source_manager_name, r.observed_at
  from resolved r
  where r.manager_id is not null and r.resolved_team_id is not null
  on conflict (game_world_id, manager_id) do update set
    team_id = excluded.team_id,
    source_manager_key = excluded.source_manager_key,
    source_manager_name = coalesce(excluded.source_manager_name, public.soccer_manager_world_manager_assignments.source_manager_name),
    updated_at = greatest(public.soccer_manager_world_manager_assignments.updated_at, excluded.updated_at);

  get diagnostics v_linked = row_count;
  return query select v_seen, v_linked;
end;
$$;

revoke all on function public.refresh_soccer_manager_world_manager_assignments_from_matches(text) from public, anon;
grant execute on function public.refresh_soccer_manager_world_manager_assignments_from_matches(text) to authenticated, service_role;
