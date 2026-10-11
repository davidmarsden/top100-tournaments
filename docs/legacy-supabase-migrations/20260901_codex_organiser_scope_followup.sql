-- Post-merge review follow-up for delegated tournament organisers.
-- Allow organisers to read forfeits belonging to tournaments they manage while
-- preserving the existing public visibility rule for ordinary signed-in users.

alter table public.forfeits enable row level security;

drop policy if exists "Authenticated read public forfeits and admins read all" on public.forfeits;
create policy "Authenticated read public forfeits and tournament managers"
  on public.forfeits for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.matches m
      where m.id = forfeits.match_id
        and (
          public.tournament_is_public(m.tournament_id)
          or public.can_manage_tournament(m.tournament_id)
        )
    )
  );
