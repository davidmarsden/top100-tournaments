-- My Matches: after an agreed home and away swap the away club hosts the friendly
-- in Soccer Manager, so it sends the invite ("sent") and the home club receives it
-- ("received", "chased"). The role checks follow the club hosting in Soccer Manager.

create or replace function public.record_manager_match_arrangement_action(p_match_id bigint, p_tournament_entry_id bigint, p_status text)
returns public.manager_match_arrangements
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_arr public.manager_match_arrangements;
  v_home_entry_id bigint;
  v_away_entry_id bigint;
  v_swapped_at timestamptz;
  v_host_entry_id bigint;
  v_guest_entry_id bigint;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_status not in ('sent','received','chased','arranged','problem') then raise exception 'Invalid arrangement status'; end if;
  -- Lock first, then validate ownership/participation against that same fixture state.
  select home_entry_id, away_entry_id, home_away_swapped_at into v_home_entry_id, v_away_entry_id, v_swapped_at
  from public.matches
  where id=p_match_id
    and coalesce(lower(status),'scheduled') not in ('played','forfeit','voided','cancelled')
  for update;
  if not found then raise exception 'This fixture is no longer active'; end if;

  if p_tournament_entry_id is distinct from v_home_entry_id
     and p_tournament_entry_id is distinct from v_away_entry_id then
    raise exception 'You no longer participate in this fixture';
  end if;
  if not exists (
    select 1
    from public.tournament_entries e
    join public.manager_portal_accounts a
      on a.manager_id=e.manager_id and a.auth_user_id=v_user and a.active=true
    where e.id=p_tournament_entry_id
  ) then raise exception 'You do not manage this tournament entry'; end if;

  -- The club hosting in Soccer Manager sends the invite: the away club after an agreed swap.
  v_host_entry_id := case when v_swapped_at is not null then v_away_entry_id else v_home_entry_id end;
  v_guest_entry_id := case when v_swapped_at is not null then v_home_entry_id else v_away_entry_id end;
  if p_status in ('sent') and p_tournament_entry_id is distinct from v_host_entry_id then
    raise exception 'Only the club hosting in Soccer Manager can record a sent request';
  end if;
  if p_status in ('received','chased') and p_tournament_entry_id is distinct from v_guest_entry_id then
    raise exception 'Only the visiting club in Soccer Manager can record a received request or chase';
  end if;
  if p_status not in ('sent','received','chased','problem') then
    raise exception 'This action is not available to managers';
  end if;

  insert into public.manager_match_arrangements(match_id,auth_user_id,tournament_entry_id,status,reported_at,updated_at)
  values(p_match_id,v_user,p_tournament_entry_id,p_status,now(),now())
  on conflict(match_id,auth_user_id) do update
    set status=excluded.status,
        tournament_entry_id=excluded.tournament_entry_id,
        updated_at=now()
  returning * into v_arr;

  insert into public.manager_match_arrangement_events(arrangement_id,match_id,auth_user_id,tournament_entry_id,action,created_at)
  values(v_arr.id,v_arr.match_id,v_arr.auth_user_id,v_arr.tournament_entry_id,p_status,now());

  return v_arr;
end;
$function$;
