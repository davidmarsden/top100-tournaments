alter table public.match_comments
  add column if not exists contribution_type text not null default 'statement';

alter table public.match_comments
  drop constraint if exists match_comments_contribution_type_check;

alter table public.match_comments
  add constraint match_comments_contribution_type_check
  check (contribution_type in ('statement', 'question', 'comment'));

update public.match_comments
set contribution_type = 'statement'
where contribution_type is null;

-- Recreate the public insert policy so only the three supported press-conference
-- contribution types can be submitted.
drop policy if exists "Public submit pending match comments" on public.match_comments;
create policy "Public submit pending match comments"
  on public.match_comments
  for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and coalesce(is_pinned, false) = false
    and coalesce(editor_pick, false) = false
    and comment_type in ('pre_match', 'post_match')
    and contribution_type in ('statement', 'question', 'comment')
    and length(trim(manager_name)) between 2 and 80
    and length(trim(comment)) between 3 and 500
  );
