-- expect: fail (new RPC nobody can call)
create function public.zz_get_points(target bigint) returns int
language sql stable security definer set search_path to 'public' as $$ select 1 $$;
