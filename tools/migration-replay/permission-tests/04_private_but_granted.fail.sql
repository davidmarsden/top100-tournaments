-- expect: fail (declared private yet granted)
-- @permissions private public.zz_staging: should be internal
create table public.zz_staging (id bigint primary key);
alter table public.zz_staging enable row level security;
grant select on public.zz_staging to authenticated;
