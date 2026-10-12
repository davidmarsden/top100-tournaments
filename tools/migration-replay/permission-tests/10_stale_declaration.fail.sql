-- expect: fail (declaration names an object the migration does not create)
-- @permissions private public.zz_typo_name: misspelt
create table public.zz_scores (id bigint primary key);
alter table public.zz_scores enable row level security;
grant select on public.zz_scores to anon;
