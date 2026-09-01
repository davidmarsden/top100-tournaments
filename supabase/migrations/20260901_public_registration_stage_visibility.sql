-- Public registration can open before the tournament format is final.
-- Keep ordinary drafts private, but allow an explicitly public draft to be
-- readable once a registration window has been configured. This keeps the
-- registration-stage public page visible before and after the window closes,
-- without treating the tournament itself as published.

create or replace function public.tournament_is_public(tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tournaments t
    where t.id = tournament_id
      and t.is_public = true
      and (
        t.status in ('groups_approved', 'published', 'completed', 'archived')
        or (
          t.status = 'draft'
          and t.registration_opens_at is not null
        )
      )
  );
$$;

revoke all on function public.tournament_is_public(bigint) from public;
grant execute on function public.tournament_is_public(bigint) to anon, authenticated;
