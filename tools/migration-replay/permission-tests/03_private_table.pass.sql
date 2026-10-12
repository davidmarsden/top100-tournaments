-- expect: pass (deliberately private, with reason)
-- @permissions private public.zz_staging: written only by security definer sync RPCs
create table public.zz_staging (id bigint primary key, payload jsonb);
alter table public.zz_staging enable row level security;
