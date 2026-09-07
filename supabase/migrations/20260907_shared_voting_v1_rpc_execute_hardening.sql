-- Mirror the production hardening applied after the V1 voting deployment.
-- SECURITY DEFINER functions are executable by PUBLIC unless explicitly revoked.

revoke all on function public.open_voting_event(bigint) from public;
revoke all on function public.close_voting_event(bigint) from public;
revoke all on function public.submit_voting_ballot(bigint, jsonb) from public;
revoke all on function public.get_voting_results(bigint) from public;

grant execute on function public.open_voting_event(bigint) to authenticated;
grant execute on function public.close_voting_event(bigint) to authenticated;
grant execute on function public.submit_voting_ballot(bigint, jsonb) to authenticated;
grant execute on function public.get_voting_results(bigint) to authenticated;
