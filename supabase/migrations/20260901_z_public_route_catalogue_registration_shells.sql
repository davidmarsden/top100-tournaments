-- Keep registration-stage tournament shells discoverable through the public
-- route catalogue without widening publication of child tournament data.

create or replace view public.tournament_public_routes
with (security_invoker = true)
as
select
  t.id,
  t.name,
  t.status,
  t.season_number,
  t.slug,
  t.public_slug,
  t.is_public,
  t.registration_status,
  t.archive_quality,
  gw.name as game_world_name,
  gw.slug as game_world_slug,
  ct.name as competition_name,
  ct.slug as competition_slug,
  '/' || gw.slug || '/' || ct.slug ||
    case when t.public_slug is not null then '/' || t.public_slug else '' end as archive_path,
  '/' || gw.slug || '/' || ct.slug as live_path
from public.tournaments t
join public.game_worlds gw on gw.id = t.game_world_id
join public.competition_types ct on ct.id = t.competition_type_id
where public.tournament_shell_is_public(t.id)
  and (
    t.status not in ('archived', 'completed')
    or t.archive_quality in ('partial', 'complete')
    or coalesce(t.source, '') = 'challonge'
  );

grant select on public.tournament_public_routes to anon, authenticated, service_role;
