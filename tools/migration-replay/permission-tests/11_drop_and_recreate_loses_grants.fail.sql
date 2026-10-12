-- expect: fail (DROP + CREATE of an existing RPC silently wipes its grants)
drop function public.submit_voting_ballot(bigint, jsonb);
create function public.submit_voting_ballot(target_event_id bigint, responses jsonb) returns bigint
language sql security definer set search_path to 'public' as $$ select 1::bigint $$;
