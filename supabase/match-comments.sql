create table if not exists match_comments (
  id bigserial primary key,
  match_id bigint not null references matches(id) on delete cascade,
  tournament_id bigint references tournaments(id) on delete cascade,
  manager_name text not null,
  club_name text,
  comment text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id)
);

create index if not exists match_comments_match_id_idx on match_comments(match_id);
create index if not exists match_comments_tournament_status_idx on match_comments(tournament_id, status, created_at desc);

alter table match_comments enable row level security;

drop policy if exists "Public read approved match comments" on match_comments;
create policy "Public read approved match comments"
  on match_comments
  for select
  to anon, authenticated
  using (status = 'approved');

drop policy if exists "Public submit pending match comments" on match_comments;
create policy "Public submit pending match comments"
  on match_comments
  for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and length(trim(manager_name)) between 2 and 80
    and length(trim(comment)) between 3 and 500
  );

drop policy if exists "Admins manage match comments" on match_comments;
create policy "Admins manage match comments"
  on match_comments
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());
