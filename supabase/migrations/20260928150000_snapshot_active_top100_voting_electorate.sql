-- Freeze the electorate from active Top 100 membership, not from website-account adoption.
-- manager_account_id is intentionally nullable so managers can activate/link their
-- website account after a poll opens without changing who was eligible at opening.
create or replace function public.open_voting_event(target_event_id bigint)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare electorate_count integer; v_event public.voting_events%rowtype; top100_world_id bigint;
begin
 if not public.is_admin() then raise exception 'Admin access required'; end if;
 select * into v_event from public.voting_events where id=target_event_id for update;
 if not found then raise exception 'Voting event not found'; end if;
 if v_event.status<>'draft' then raise exception 'Only draft voting events can be opened'; end if;
 if v_event.closes_at is null or v_event.closes_at<=now() then raise exception 'Set a future closing time before opening the vote'; end if;
 select id into top100_world_id from public.game_worlds where slug='top-100';
 if top100_world_id is null then raise exception 'Top 100 game world not found'; end if;
 delete from public.voting_electorate where event_id=target_event_id;
 insert into public.voting_electorate(event_id,manager_id,manager_account_id,manager_name)
 select target_event_id,gm.manager_id,a.id,coalesce(nullif(m.display_name,''),m.name)
 from public.manager_game_world_memberships gm
 join public.managers m on m.id=gm.manager_id
 left join public.manager_portal_accounts a on a.manager_id=gm.manager_id and a.game_world_id=top100_world_id and a.active=true
 where gm.game_world_id=top100_world_id and gm.active=true;
 get diagnostics electorate_count=row_count;
 if electorate_count=0 then raise exception 'No active Top 100 managers are available for the electorate'; end if;
 update public.voting_events set status='open',opens_at=coalesce(opens_at,now()),updated_at=now() where id=target_event_id;
 insert into public.voting_audit_log(event_id,actor_user_id,action,details)
 values(target_event_id,auth.uid(),'event_opened',jsonb_build_object('electorate_count',electorate_count,'game_world','top-100'));
 return electorate_count;
end $function$;
