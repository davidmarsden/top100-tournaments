-- Harden helper search paths and remove accidental public RPC execution.
-- Intentionally public read helpers and public match reactions are left unchanged.

alter function public.team_directory_key(text) set search_path = '';
alter function public.knockout_roster_lock_key(bigint) set search_path = '';
alter function public.knockout_seed_order(integer) set search_path = '';

-- Admin / organiser / signed-in RPCs: deny anonymous/public execution,
-- preserve authenticated and service-role access.
revoke execute on function public.add_voting_electorate_member(bigint, bigint, text) from public, anon;
grant execute on function public.add_voting_electorate_member(bigint, bigint, text) to authenticated, service_role;

revoke execute on function public.admin_create_manager(text, text) from public, anon;
grant execute on function public.admin_create_manager(text, text) to authenticated, service_role;

revoke execute on function public.admin_list_manager_lifecycle() from public, anon;
grant execute on function public.admin_list_manager_lifecycle() to authenticated, service_role;

revoke execute on function public.admin_set_manager_active(bigint, boolean, text) from public, anon;
grant execute on function public.admin_set_manager_active(bigint, boolean, text) to authenticated, service_role;

revoke execute on function public.create_voting_event_from_json(text, text, text, timestamptz, text, jsonb) from public, anon;
grant execute on function public.create_voting_event_from_json(text, text, text, timestamptz, text, jsonb) to authenticated, service_role;

revoke execute on function public.finalise_awards_event(bigint) from public, anon;
grant execute on function public.finalise_awards_event(bigint) to authenticated, service_role;

revoke execute on function public.generate_knockout_opening_round_atomic(bigint) from public, anon;
grant execute on function public.generate_knockout_opening_round_atomic(bigint) to authenticated, service_role;

revoke execute on function public.generate_knockout_successor_round_atomic(bigint) from public, anon;
grant execute on function public.generate_knockout_successor_round_atomic(bigint) to authenticated, service_role;

revoke execute on function public.get_my_voting_ballot(bigint) from public, anon;
grant execute on function public.get_my_voting_ballot(bigint) to authenticated, service_role;

revoke execute on function public.get_released_voting_archive(bigint) from public, anon;
grant execute on function public.get_released_voting_archive(bigint) to authenticated, service_role;

revoke execute on function public.knockout_only_roster_is_locked(bigint) from public, anon;
grant execute on function public.knockout_only_roster_is_locked(bigint) to authenticated, service_role;

revoke execute on function public.mark_voting_archive_exported(bigint, text) from public, anon;
grant execute on function public.mark_voting_archive_exported(bigint, text) to authenticated, service_role;

revoke execute on function public.publishing_manager_identity() from public, anon;
grant execute on function public.publishing_manager_identity() to authenticated, service_role;

revoke execute on function public.release_voting_results(bigint) from public, anon;
grant execute on function public.release_voting_results(bigint) to authenticated, service_role;

-- Trigger functions should not be callable over PostgREST.
revoke execute on function public.guard_knockout_match_mutation_lock() from public, anon, authenticated;
revoke execute on function public.guard_knockout_only_entry_roster() from public, anon, authenticated;
revoke execute on function public.sync_game_world_club_to_teams() from public, anon, authenticated;

grant execute on function public.guard_knockout_match_mutation_lock() to service_role;
grant execute on function public.guard_knockout_only_entry_roster() to service_role;
grant execute on function public.sync_game_world_club_to_teams() to service_role;
