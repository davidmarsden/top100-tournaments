create table if not exists match_comments (
  id bigserial primary key,
  match_id bigint not null references matches(id) on delete cascade,
  tournament_id bigint references tournaments(id) on delete cascade,
  manager_name text not null,
  club_name text,
  comment text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  comment_type text not null default 'pre_match' check (comment_type in ('pre_match', 'post_match', 'admin_preview', 'admin_report')),
  prediction_score text,
  player_to_watch text,
  first_goalscorer text,
  is_pinned boolean not null default false,
  editor_pick boolean not null default false,
  badge_label text,
  reactions jsonb not null default '{"like":0,"laugh":0,"eyes":0,"fire":0}'::jsonb,
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id)
);

alter table match_comments add column if not exists comment_type text not null default 'pre_match' check (comment_type in ('pre_match', 'post_match', 'admin_preview', 'admin_report'));
alter table match_comments add column if not exists prediction_score text;
alter table match_comments add column if not exists player_to_watch text;
alter table match_comments add column if not exists first_goalscorer text;
alter table match_comments add column if not exists is_pinned boolean not null default false;
alter table match_comments add column if not exists editor_pick boolean not null default false;
alter table match_comments add column if not exists badge_label text;
alter table match_comments add column if not exists reactions jsonb not null default '{"like":0,"laugh":0,"eyes":0,"fire":0}'::jsonb;

create index if not exists match_comments_match_id_idx on match_comments(match_id);
create index if not exists match_comments_tournament_status_idx on match_comments(tournament_id, status, created_at desc);
create index if not exists match_comments_match_pinned_idx on match_comments(match_id, is_pinned desc, editor_pick desc, created_at asc);

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
    and coalesce(is_pinned, false) = false
    and coalesce(editor_pick, false) = false
    and comment_type in ('pre_match', 'post_match')
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

-- Lightweight public reaction RPC. This only increments allowed counters on approved comments.
create or replace function react_to_match_comment(comment_id bigint, reaction_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if reaction_key not in ('like', 'laugh', 'eyes', 'fire') then
    raise exception 'Invalid reaction';
  end if;

  update match_comments
  set reactions = jsonb_set(
    coalesce(reactions, '{}'::jsonb),
    array[reaction_key],
    to_jsonb(coalesce((reactions ->> reaction_key)::int, 0) + 1),
    true
  )
  where id = comment_id
    and status = 'approved';
end;
$$;

grant execute on function react_to_match_comment(bigint, text) to anon, authenticated;
