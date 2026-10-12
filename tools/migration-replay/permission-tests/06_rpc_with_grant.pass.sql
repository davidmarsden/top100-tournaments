-- expect: pass (RPC granted to signed-in users)
create function public.zz_get_points(target bigint) returns int
language sql stable security definer set search_path to 'public' as $$ select 1 $$;
grant execute on function public.zz_get_points(bigint) to authenticated;
