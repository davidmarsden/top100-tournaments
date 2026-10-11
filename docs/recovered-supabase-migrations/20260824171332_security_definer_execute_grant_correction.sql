-- Historical migrations granted some SECURITY DEFINER functions directly to anon/authenticated.
-- Remove all direct client grants first, then explicitly restore only intended API entry points.
revoke execute on function public.admin_amend_match_result(bigint,integer,integer,text,text) from anon, authenticated;
revoke execute on function public.admin_record_double_forfeit(bigint,text) from anon, authenticated;
revoke execute on function public.approve_manager_portal_claim(bigint,bigint) from anon, authenticated;
revoke execute on function public.approve_manager_portal_claim_with_alias(bigint,bigint,bigint,boolean) from anon, authenticated;
revoke execute on function public.create_seeded_test_tournament(bigint,integer) from anon, authenticated;
revoke execute on function public.find_manager_portal_claim_match(text,text) from anon, authenticated;
revoke execute on function public.get_public_youth_winners() from anon, authenticated;
revoke execute on function public.is_admin() from anon, authenticated;
revoke execute on function public.manager_portal_claim_candidates(text,text) from anon, authenticated;
revoke execute on function public.manager_portal_claim_suggestions(bigint) from anon, authenticated;
revoke execute on function public.moderate_match_comment(bigint,text,text) from anon, authenticated;
revoke execute on function public.notify_admin_of_pending_manager_claim() from anon, authenticated;
revoke execute on function public.populate_manager_portal_claim_suggestion() from anon, authenticated;
revoke execute on function public.promote_registration_to_entrant(bigint) from anon, authenticated;
revoke execute on function public.protect_final_manager_result() from anon, authenticated;
revoke execute on function public.react_to_match_comment(bigint,text) from anon, authenticated;
revoke execute on function public.reject_manager_portal_claim(bigint,text) from anon, authenticated;
revoke execute on function public.reject_manager_result(bigint,text) from anon, authenticated;
revoke execute on function public.report_match_comment(bigint,text) from anon, authenticated;
revoke execute on function public.resolve_manager_result(bigint,integer,integer,text) from anon, authenticated;
revoke execute on function public.respond_to_manager_result(bigint,text,text) from anon, authenticated;
revoke execute on function public.rls_auto_enable() from anon, authenticated;
revoke execute on function public.set_tournament_registration_window(bigint,text,timestamptz,timestamptz) from anon, authenticated;
revoke execute on function public.submit_manager_result(bigint,integer,integer) from anon, authenticated;
revoke execute on function public.submit_manager_result_with_ruling(bigint,integer,integer,text,text) from anon, authenticated;
revoke execute on function public.sync_match_forfeit_record() from anon, authenticated;
revoke execute on function public.tournament_is_public(bigint) from anon, authenticated;

-- Admin and authenticated manager endpoints.
grant execute on function public.admin_amend_match_result(bigint,integer,integer,text,text) to authenticated;
grant execute on function public.admin_record_double_forfeit(bigint,text) to authenticated;
grant execute on function public.approve_manager_portal_claim(bigint,bigint) to authenticated;
grant execute on function public.approve_manager_portal_claim_with_alias(bigint,bigint,bigint,boolean) to authenticated;
grant execute on function public.create_seeded_test_tournament(bigint,integer) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.manager_portal_claim_suggestions(bigint) to authenticated;
grant execute on function public.moderate_match_comment(bigint,text,text) to authenticated;
grant execute on function public.promote_registration_to_entrant(bigint) to authenticated;
grant execute on function public.reject_manager_portal_claim(bigint,text) to authenticated;
grant execute on function public.reject_manager_result(bigint,text) to authenticated;
grant execute on function public.report_match_comment(bigint,text) to authenticated;
grant execute on function public.resolve_manager_result(bigint,integer,integer,text) to authenticated;
grant execute on function public.respond_to_manager_result(bigint,text,text) to authenticated;
grant execute on function public.set_tournament_registration_window(bigint,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.submit_manager_result(bigint,integer,integer) to authenticated;
grant execute on function public.submit_manager_result_with_ruling(bigint,integer,integer,text,text) to authenticated;

-- Deliberately public functionality.
grant execute on function public.get_public_youth_winners() to anon, authenticated;
grant execute on function public.react_to_match_comment(bigint,text) to anon, authenticated;
grant execute on function public.tournament_is_public(bigint) to anon, authenticated;