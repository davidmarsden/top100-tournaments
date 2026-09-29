create or replace function public.get_voting_participants(target_event_id bigint)
returns table(manager_id bigint, manager_name text, submitted_at timestamptz)
language plpgsql security definer set search_path='public' as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required'; end if;
  return query select b.manager_id, coalesce(m.display_name,m.name), b.submitted_at
  from public.voting_ballots b join public.managers m on m.id=b.manager_id
  where b.event_id=target_event_id order by b.submitted_at asc,b.id asc;
end $$;
revoke all on function public.get_voting_participants(bigint) from public, anon;
grant execute on function public.get_voting_participants(bigint) to authenticated;

create or replace function public.get_voting_results(target_event_id bigint)
returns table(question_id bigint, question_title text, option_id bigint, option_label text, votes bigint)
language plpgsql security definer set search_path='public' as $$
declare v_event public.voting_events%rowtype; v_account public.manager_portal_accounts%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into v_event from public.voting_events where id=target_event_id;
 if not found then raise exception 'Voting event not found'; end if;
 if public.is_admin() then
   if v_event.status='open' and (v_event.closes_at is null or now()<v_event.closes_at) then raise exception 'Vote totals stay hidden from administrators until voting closes'; end if;
 else
   select * into v_account from public.manager_portal_accounts where auth_user_id=auth.uid() and active=true limit 1;
   if not found then raise exception 'Active manager account required'; end if;
   if not exists(select 1 from public.voting_electorate where event_id=target_event_id and manager_id=v_account.manager_id) then raise exception 'Manager is not in this vote''s electorate'; end if;
   if v_event.results_visibility='hidden' then raise exception 'Results are hidden'; end if;
   if v_event.results_visibility='manual_release' and v_event.results_released_at is null then raise exception 'Results have not been released'; end if;
   if v_event.results_visibility='after_close' and not (v_event.status='closed' or (v_event.closes_at is not null and now()>=v_event.closes_at)) then raise exception 'Results are not available until voting closes'; end if;
 end if;
 return query select q.id,q.title,o.id,o.label,count(r.ballot_id)::bigint from public.voting_questions q join public.voting_options o on o.question_id=q.id left join public.voting_responses r on r.question_id=q.id and r.option_id=o.id where q.event_id=target_event_id group by q.id,q.title,q.sort_order,o.id,o.label,o.sort_order order by q.sort_order,q.id,o.sort_order,o.id;
end $$;