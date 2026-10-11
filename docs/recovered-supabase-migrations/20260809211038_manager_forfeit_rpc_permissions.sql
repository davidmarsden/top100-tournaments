revoke execute on function public.submit_manager_result_with_ruling(bigint, integer, integer, text, text) from public, anon;
grant execute on function public.submit_manager_result_with_ruling(bigint, integer, integer, text, text) to authenticated;
revoke execute on function public.admin_amend_match_result(bigint, integer, integer, text, text) from public, anon;
grant execute on function public.admin_amend_match_result(bigint, integer, integer, text, text) to authenticated;