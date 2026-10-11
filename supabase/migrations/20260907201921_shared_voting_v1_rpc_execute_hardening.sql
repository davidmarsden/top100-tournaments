-- Restrict voting SECURITY DEFINER RPCs to signed-in users only.
revoke all on function public.open_voting_event(bigint) from public, anon;
revoke all on function public.close_voting_event(bigint) from public, anon;
revoke all on function public.submit_voting_ballot(bigint, jsonb) from public, anon;
revoke all on function public.get_voting_results(bigint) from public, anon;
grant execute on function public.open_voting_event(bigint) to authenticated;
grant execute on function public.close_voting_event(bigint) to authenticated;
grant execute on function public.submit_voting_ballot(bigint, jsonb) to authenticated;
grant execute on function public.get_voting_results(bigint) to authenticated;