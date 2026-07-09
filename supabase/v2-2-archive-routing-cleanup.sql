-- Phase V2.2 archive routing cleanup
-- Hide empty archive placeholder tournaments from public routes.
-- Keep real live tournaments and imported Challonge archives public.
-- Safe to run repeatedly.

alter table tournaments add column if not exists archive_quality text not null default 'unknown'
  check (archive_quality in ('unknown', 'placeholder', 'partial', 'complete'));

-- Backfill V2 route metadata for existing Challonge imports.
-- These are the real archive records and should take precedence over empty honour placeholders.
update tournaments t
set
  game_world_id = coalesce(t.game_world_id, (select id from game_worlds where slug = 'top-100')),
  competition_type_id = coalesce(t.competition_type_id, (select id from competition_types where slug = 'youth-cup')),
  season_number = coalesce(
    t.season_number,
    nullif(regexp_replace(coalesce(t.name, ''), '^.*?S\s*([0-9]+).*$', '\1'), coalesce(t.name, ''))::integer
  ),
  public_slug = coalesce(
    t.public_slug,
    case
      when coalesce(t.name, '') ~* 'S\s*[0-9]+' then 's' || nullif(regexp_replace(coalesce(t.name, ''), '^.*?S\s*([0-9]+).*$', '\1'), coalesce(t.name, ''))
      else null
    end
  ),
  slug = coalesce(t.slug, lower(regexp_replace(coalesce(t.name, 'challonge-' || t.id), '[^a-zA-Z0-9]+', '-', 'g'))),
  is_public = true,
  archive_quality = 'complete'
where coalesce(t.source, '') = 'challonge'
  and coalesce(t.name, '') ~* 'S\s*[0-9]+';

-- Keep the latest/live tournament public even if its route is not a historic archive yet.
update tournaments
set is_public = true,
    archive_quality = case when archive_quality = 'placeholder' then 'unknown' else archive_quality end
where status in ('draft', 'groups_approved', 'published');

with tournament_counts as (
  select
    t.id,
    count(distinct te.id) as entry_count,
    count(distinct m.id) as match_count
  from tournaments t
  left join tournament_entries te on te.tournament_id = t.id
  left join matches m on m.tournament_id = t.id
  group by t.id
)
update tournaments t
set
  archive_quality = case
    when t.status in ('archived', 'completed') and coalesce(t.source, '') = 'challonge' and c.match_count > 0 then 'complete'
    when t.status in ('archived', 'completed') and c.match_count > 0 then 'partial'
    when t.status in ('archived', 'completed') and c.entry_count = 0 and c.match_count = 0 then 'placeholder'
    else archive_quality
  end,
  is_public = case
    when t.status in ('archived', 'completed') and c.entry_count = 0 and c.match_count = 0 then false
    else t.is_public
  end
from tournament_counts c
where c.id = t.id;

-- If a real Challonge archive and an empty placeholder share a route, keep the Challonge archive public.
with route_rows as (
  select
    t.*,
    count(*) over (partition by game_world_id, competition_type_id, public_slug) as route_count,
    max(case when source = 'challonge' then 1 else 0 end) over (partition by game_world_id, competition_type_id, public_slug) as has_challonge
  from tournaments t
  where game_world_id is not null
    and competition_type_id is not null
    and public_slug is not null
)
update tournaments t
set is_public = false,
    archive_quality = case when t.archive_quality = 'unknown' then 'placeholder' else t.archive_quality end
from route_rows r
where r.id = t.id
  and r.route_count > 1
  and r.has_challonge = 1
  and coalesce(t.source, '') <> 'challonge'
  and t.status in ('archived', 'completed');

-- If two real imports share a route, keep the first one at /sNN and suffix later imports.
-- This prevents /top-100/youth-cup/s27 from resolving to an arbitrary duplicate.
with duplicate_real_routes as (
  select
    id,
    public_slug,
    row_number() over (
      partition by game_world_id, competition_type_id, public_slug
      order by case when source = 'challonge' then 0 else 1 end, created_at nulls last, id
    ) as route_number
  from tournaments
  where is_public = true
    and public_slug is not null
    and game_world_id is not null
    and competition_type_id is not null
)
update tournaments t
set public_slug = d.public_slug || '-' || d.route_number
from duplicate_real_routes d
where t.id = d.id
  and d.route_number > 1;

create or replace view tournament_public_routes as
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
  '/' || gw.slug || '/' || ct.slug || case when t.public_slug is not null then '/' || t.public_slug else '' end as archive_path,
  '/' || gw.slug || '/' || ct.slug as live_path
from tournaments t
join game_worlds gw on gw.id = t.game_world_id
join competition_types ct on ct.id = t.competition_type_id
where t.is_public = true
  and (
    t.status not in ('archived', 'completed')
    or t.archive_quality in ('partial', 'complete')
    or coalesce(t.source, '') = 'challonge'
  );
