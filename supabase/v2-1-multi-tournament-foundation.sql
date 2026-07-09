-- Phase V2.1: multi-tournament foundation
-- Adds game worlds, competition types, public/archive routing metadata, and registration status hooks.
-- Safe to run repeatedly.

create table if not exists game_worlds (
  id bigserial primary key,
  name text not null unique,
  slug text not null unique,
  description text,
  display_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists competition_types (
  id bigserial primary key,
  name text not null unique,
  slug text not null unique,
  description text,
  default_max_entries integer,
  default_group_count integer,
  default_teams_per_group integer,
  default_knockout_teams integer,
  default_secondary_bracket_name text,
  display_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into game_worlds (name, slug, description, display_order)
values
  ('Top 100', 'top-100', 'Original Top 100 game world', 1),
  ('Top 100 Regen', 'regen', 'Top 100 Regen game world', 2)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  display_order = excluded.display_order,
  is_active = true;

insert into competition_types (name, slug, description, default_max_entries, default_group_count, default_teams_per_group, default_knockout_teams, default_secondary_bracket_name, display_order)
values
  ('Youth Cup', 'youth-cup', 'Youth Cup tournament format', 64, 16, 4, 32, 'Shield', 1),
  ('World Club Cup', 'world-club-cup', 'World Club Cup tournament format', 64, 16, 4, 32, null, 2)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  default_max_entries = excluded.default_max_entries,
  default_group_count = excluded.default_group_count,
  default_teams_per_group = excluded.default_teams_per_group,
  default_knockout_teams = excluded.default_knockout_teams,
  default_secondary_bracket_name = excluded.default_secondary_bracket_name,
  display_order = excluded.display_order,
  is_active = true;

alter table tournaments add column if not exists game_world_id bigint references game_worlds(id);
alter table tournaments add column if not exists competition_type_id bigint references competition_types(id);
alter table tournaments add column if not exists season_number integer;
alter table tournaments add column if not exists slug text;
alter table tournaments add column if not exists public_slug text;
alter table tournaments add column if not exists is_public boolean not null default true;
alter table tournaments add column if not exists registration_status text not null default 'closed' check (registration_status in ('closed', 'open', 'paused', 'full'));
alter table tournaments add column if not exists registration_opens_at timestamptz;
alter table tournaments add column if not exists registration_closes_at timestamptz;
alter table tournaments add column if not exists archived_at timestamptz;

update tournaments
set game_world_id = (select id from game_worlds where slug = 'top-100')
where game_world_id is null;

update tournaments
set competition_type_id = (select id from competition_types where slug = 'youth-cup')
where competition_type_id is null;

update tournaments
set season_number = coalesce(
  season_number,
  nullif(regexp_replace(coalesce(name, ''), '^.*?S\s*([0-9]+).*$', '\1'), coalesce(name, ''))::integer
)
where season_number is null
  and coalesce(name, '') ~* 'S\s*[0-9]+';

update tournaments
set slug = lower(regexp_replace(coalesce(name, 'tournament-' || id), '[^a-zA-Z0-9]+', '-', 'g'))
where slug is null;

update tournaments
set public_slug = 's' || season_number
where public_slug is null
  and season_number is not null;


create index if not exists tournaments_world_comp_status_idx
  on tournaments(game_world_id, competition_type_id, status, season_number desc);

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
  gw.name as game_world_name,
  gw.slug as game_world_slug,
  ct.name as competition_name,
  ct.slug as competition_slug,
  '/' || gw.slug || '/' || ct.slug || case when t.public_slug is not null then '/' || t.public_slug else '' end as archive_path,
  '/' || gw.slug || '/' || ct.slug as live_path
from tournaments t
join game_worlds gw on gw.id = t.game_world_id
join competition_types ct on ct.id = t.competition_type_id;

alter table game_worlds enable row level security;
alter table competition_types enable row level security;

drop policy if exists "Public read game worlds" on game_worlds;
create policy "Public read game worlds"
  on game_worlds for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "Public read competition types" on competition_types;
create policy "Public read competition types"
  on competition_types for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "Admins manage game worlds" on game_worlds;
create policy "Admins manage game worlds"
  on game_worlds for all
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "Admins manage competition types" on competition_types;
create policy "Admins manage competition types"
  on competition_types for all
  to authenticated
  using (is_admin())
  with check (is_admin());
