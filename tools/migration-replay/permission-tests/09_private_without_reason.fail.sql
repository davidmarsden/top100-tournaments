-- expect: fail (private declaration with no reason)
-- @permissions private public.zz_staging
create table public.zz_staging (id bigint primary key);
alter table public.zz_staging enable row level security;
