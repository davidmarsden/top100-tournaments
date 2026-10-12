-- expect: pass (public read table)
create table public.zz_scores (id bigint primary key, points int);
alter table public.zz_scores enable row level security;
create policy "Anyone reads scores" on public.zz_scores for select to anon, authenticated using (true);
grant select on public.zz_scores to anon, authenticated;
