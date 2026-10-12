-- expect: fail (new table, no grants, not declared private)
create table public.zz_scores (id bigint primary key, points int);
alter table public.zz_scores enable row level security;
