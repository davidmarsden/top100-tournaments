-- Allow trusted service/database maintenance execution of the manager-assignment
-- refresh while preserving the canonical assignment source and reconciliation rules.

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
  if v_role <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin')
     and not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select id into v_world_id
  from public.game_worlds
  where external_world_id::text = trim(target_setup_id)
  order by id limit 1;
  if v_world_id is null then raise exception 'No archived Soccer Manager world %', target_setup_id; end if;

  -- normalizeCompetitionSnapshot persists the authoritative current assignment
  -- observations here from customerFileNames: clubId -> customerID/displayName.
  select count(*)::integer into v_seen
  from public.soccer_manager_canonical_entities e
  where e.entity_type='manager_assignment'
    and e.data->>'setupId'=trim(target_setup_id)
    and nullif(trim(e.data->>'managerId'),'') is not null
    and nullif(trim(e.data->>'clubId'),'') is not null;

  with observations as (
    select distinct on (e.data->>'clubId')
      nullif(trim(e.data->>'clubId'),'') source_club_id,
      nullif(trim(e.data->>'managerId'),'') source_manager_id,
      nullif(trim(e.data->>'displayName'),'') source_manager_name,
      e.last_approved_at observed_at
    from public.soccer_manager_canonical_entities e
    where e.entity_type='manager_assignment'
      and e.data->>'setupId'=trim(target_setup_id)
      and nullif(trim(e.data->>'managerId'),'') is not null
      and nullif(trim(e.data->>'clubId'),'') is not null
    order by e.data->>'clubId',e.last_approved_at desc,e.version desc,e.entity_key desc
  ), mapped as (
    select o.*,
      cl.target_id team_id,
      identity.manager_id
    from observations o
    left join public.soccer_manager_archive_links cl
      on cl.source_type='club'
     and cl.target_type='team'
     and cl.source_key=trim(target_setup_id)||':'||o.source_club_id
    left join lateral (
      -- A bare SM customer ID is cross-world identity evidence only when every
      -- existing world-qualified link agrees on one canonical human. Conflicts stay
      -- unresolved for admin reconciliation rather than picking an arbitrary link.
      select case when count(distinct al.target_id)=1 then min(al.target_id) else null end manager_id
      from public.soccer_manager_archive_links al
      where al.source_type='manager'
        and al.target_type='manager'
        and split_part(al.source_key,':',2)=o.source_manager_id
    ) identity on true
  )
  insert into public.soccer_manager_world_manager_assignments(
    game_world_id,team_id,manager_id,source_manager_key,source_manager_name,assigned_at,updated_at
  )
  select v_world_id,m.team_id,m.manager_id,
    trim(target_setup_id)||':'||m.source_manager_id,m.source_manager_name,
    coalesce(m.observed_at,now()),coalesce(m.observed_at,now())
  from mapped m
  where m.manager_id is not null
    and m.team_id is not null
  on conflict (game_world_id,team_id) do update set
    assigned_at=case
      when public.soccer_manager_world_manager_assignments.manager_id is distinct from excluded.manager_id
        or public.soccer_manager_world_manager_assignments.source_manager_key is distinct from excluded.source_manager_key
      then excluded.assigned_at
      else public.soccer_manager_world_manager_assignments.assigned_at
    end,
    manager_id=excluded.manager_id,
    source_manager_key=excluded.source_manager_key,
    source_manager_name=coalesce(excluded.source_manager_name,public.soccer_manager_world_manager_assignments.source_manager_name),
    updated_at=greatest(public.soccer_manager_world_manager_assignments.updated_at,excluded.updated_at);

  get diagnostics v_linked = row_count;
  return query select v_seen,v_linked;
end;
$$;

comment on function public.refresh_soccer_manager_world_manager_assignments_from_matches(text) is
  'Compatibility-named admin/service refresh: rebuilds current SM world assignments from canonical manager_assignment entities (customerFileNames), not replay DOM data.';

revoke all on function public.refresh_soccer_manager_world_manager_assignments_from_matches(text) from public,anon;
grant execute on function public.refresh_soccer_manager_world_manager_assignments_from_matches(text) to authenticated,service_role;
