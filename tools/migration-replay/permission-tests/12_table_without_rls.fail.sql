-- expect: fail (RLS switched off on a granted table)
create table public.zz_open (id bigint primary key);
alter table public.zz_open disable row level security;
grant select on public.zz_open to anon;
