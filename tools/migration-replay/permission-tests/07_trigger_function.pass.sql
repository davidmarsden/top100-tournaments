-- expect: pass (trigger functions need no grants)
create function public.zz_touch() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
