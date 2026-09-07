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
    a.game_world_id,
    coalesce(nullif(m.display_name, ''), m.name) as manager_name,
    gwc.club_name
  from public.manager_portal_accounts a
  join public.managers m on m.id = a.manager_id
  left join public.game_world_clubs gwc
    on gwc.game_world_id = a.game_world_id
   and gwc.active = true
   and gwc.occupied = true
   and gwc.manager_key = regexp_replace(lower(coalesce(nullif(m.display_name, ''), m.name)), '[^a-z0-9]+', '', 'g')
  where a.auth_user_id = auth.uid()
    and a.active = true
    and a.game_world_id = 1
  order by gwc.updated_at desc nulls last
  limit 1;
$$;

revoke all on function public.publishing_manager_identity() from public;
grant execute on function public.publishing_manager_identity() to authenticated;

comment on function public.publishing_manager_identity() is
  'Returns the authenticated active Top 100 manager identity used by the Publishing Desk.';
