-- One manager account covers both game worlds, whichever club it was claimed with.
-- The Publishing Desk only accepted accounts claimed with a Top 100 club, so a manager
-- who linked through Regen was refused even while running a Top 100 club.
-- Accept any active account whose manager is linked to Top 100 by the account itself
-- or by a current Top 100 club.
create or replace function public.publishing_manager_identity()
returns table (
  auth_user_id uuid,
  manager_id bigint,
  game_world_id bigint,
  manager_name text,
  club_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.auth_user_id,
    a.manager_id,
    1::bigint as game_world_id,
    coalesce(nullif(m.display_name, ''), m.name) as manager_name,
    gwc.club_name
  from public.manager_portal_accounts a
  join public.managers m on m.id = a.manager_id
  left join public.game_world_clubs gwc
    on gwc.game_world_id = 1
   and gwc.active = true
   and gwc.occupied = true
   and gwc.manager_key = regexp_replace(lower(coalesce(nullif(m.display_name, ''), m.name)), '[^a-z0-9]+', '', 'g')
  where a.auth_user_id = auth.uid()
    and a.active = true
    and (a.game_world_id = 1 or gwc.club_name is not null)
  order by (a.game_world_id = 1) desc, gwc.updated_at desc nulls last
  limit 1;
$$;

revoke execute on function public.publishing_manager_identity() from public, anon;
grant execute on function public.publishing_manager_identity() to authenticated, service_role;

comment on function public.publishing_manager_identity() is
  'Returns the authenticated active Top 100 manager identity used by the Publishing Desk, whichever game world the account was claimed with.';
