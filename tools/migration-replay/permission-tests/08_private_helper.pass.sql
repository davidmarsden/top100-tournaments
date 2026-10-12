-- expect: pass (internal helper, declared by name and signature)
-- @permissions private public.zz_internal_rank(bigint): only called from other security definer functions
create function public.zz_internal_rank(target bigint) returns int language sql stable as $$ select 1 $$;
