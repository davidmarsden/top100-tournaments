-- SECURITY DEFINER functions are executable by PUBLIC unless explicitly revoked.
-- Keep manager submission available only to signed-in users; the admin amendment
-- RPC additionally enforces is_admin() internally.

revoke execute on function public.submit_manager_result_with_ruling(bigint, integer, integer, text, text)
  from public, anon;
grant execute on function public.submit_manager_result_with_ruling(bigint, integer, integer, text, text)
  to authenticated;

revoke execute on function public.admin_amend_match_result(bigint, integer, integer, text, text)
  from public, anon;
grant execute on function public.admin_amend_match_result(bigint, integer, integer, text, text)
  to authenticated;
