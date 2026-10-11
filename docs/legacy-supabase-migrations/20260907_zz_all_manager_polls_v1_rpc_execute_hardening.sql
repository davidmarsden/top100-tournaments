-- Explicitly restrict All-Manager Poll SECURITY DEFINER RPCs to authenticated users.

revoke execute on function public.create_manager_poll(text,text,text,text[],timestamptz,text,text,numeric,text,numeric,text) from anon;
revoke execute on function public.finalise_voting_event(bigint) from anon;
revoke execute on function public.create_manager_poll(text,text,text,text[],timestamptz,text,text,numeric,text,numeric,text) from public;
revoke execute on function public.finalise_voting_event(bigint) from public;

grant execute on function public.create_manager_poll(text,text,text,text[],timestamptz,text,text,numeric,text,numeric,text) to authenticated;
grant execute on function public.finalise_voting_event(bigint) to authenticated;
