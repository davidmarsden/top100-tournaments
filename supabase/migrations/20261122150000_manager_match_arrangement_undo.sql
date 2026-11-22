-- My Matches: undo a fixture update recorded by mistake.
--
-- A manager who clicks the wrong button ("Request received" instead of
-- "Request sent", or on the wrong fixture) can now undo it. The arrangement is
-- set to 'cleared', which the portal shows as nothing recorded, and a 'cleared'
-- event is appended so the history (used when a fixture is disputed) still
-- shows both the mistaken update and its undoing. The opponent, who was told
-- about the mistaken update, is told that it has been undone.

alter table public.manager_match_arrangements drop constraint if exists manager_match_arrangements_status_check;
alter table public.manager_match_arrangements add constraint manager_match_arrangements_status_check
  check (status in ('sent','received','chased','arranged','problem','cleared'));

alter table public.manager_match_arrangement_events drop constraint if exists manager_match_arrangement_events_action_check;
alter table public.manager_match_arrangement_events add constraint manager_match_arrangement_events_action_check
  check (action in ('sent','received','chased','arranged','problem','cleared'));

-- Opponent notification for an undo; patched in place, the anchor must match exactly once.
do $$
declare
  v_ddl text;
  v_anchor constant text := $a$when 'problem' then v_actor || ' has reported a problem arranging the fixture.'$a$;
  v_patch constant text := $p$when 'problem' then v_actor || ' has reported a problem arranging the fixture.'
      when 'cleared' then v_actor || ' has undone their last update for this fixture: it was recorded by mistake.'$p$;
begin
  v_ddl := pg_get_functiondef('public.notify_opponent_of_arrangement_action()'::regprocedure);
  if position($c$when 'cleared'$c$ in v_ddl) > 0 then return; end if;
  if (length(v_ddl) - length(replace(v_ddl, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'notify_opponent_of_arrangement_action anchor was not found exactly once; refusing an unsafe migration';
  end if;
  execute replace(v_ddl, v_anchor, v_patch);
end;
$$;

create or replace function public.undo_manager_match_arrangement_action(p_match_id bigint, p_tournament_entry_id bigint)
returns public.manager_match_arrangements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_arr public.manager_match_arrangements;
  v_home_entry_id bigint;
  v_away_entry_id bigint;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select home_entry_id, away_entry_id into v_home_entry_id, v_away_entry_id
  from public.matches
  where id = p_match_id
    and coalesce(lower(status), 'scheduled') not in ('played','forfeit','voided','cancelled')
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
      on a.manager_id = e.manager_id and a.auth_user_id = v_user and a.active = true
    where e.id = p_tournament_entry_id
  ) then raise exception 'You do not manage this tournament entry'; end if;

  update public.manager_match_arrangements
     set status = 'cleared', tournament_entry_id = p_tournament_entry_id, updated_at = now()
   where match_id = p_match_id and auth_user_id = v_user and status <> 'cleared'
  returning * into v_arr;
  if v_arr.id is null then raise exception 'There is nothing to undo for this fixture'; end if;

  insert into public.manager_match_arrangement_events(arrangement_id, match_id, auth_user_id, tournament_entry_id, action, created_at)
  values (v_arr.id, v_arr.match_id, v_arr.auth_user_id, v_arr.tournament_entry_id, 'cleared', now());

  return v_arr;
end;
$$;

revoke all on function public.undo_manager_match_arrangement_action(bigint, bigint) from public;
grant execute on function public.undo_manager_match_arrangement_action(bigint, bigint) to authenticated;
