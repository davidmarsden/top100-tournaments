-- Align the legacy teams directory with the same accent/punctuation-insensitive
-- identity rules used by EntrantsManager bulk import. This is a follow-up to
-- 20260914215000_sync_game_world_clubs_to_teams.sql, which has already been
-- applied in production and therefore remains immutable.

create or replace function public.team_directory_key(value text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
    lower(
      translate(
        coalesce(value, ''),
        'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖØóòôõöøÚÙÛÜúùûüÇçÑñÝŸýÿŽžŠšČčĆćĐđŁłŘřŚśŹźŻż',
        'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuCcNnYYyyZzSsCcCcDdLlRrSsZzZz'
      )
    ),
    '[^[:alnum:]]+',
    '',
    'g'
  );
$$;

-- Consolidate existing logical duplicates. Prefer the ID with the most existing
-- production references so historical rows move as little as possible; ties use
-- the oldest/smallest ID. Build this mapping once so every FK table uses the same
-- keeper even after references start moving.
create temporary table team_duplicate_map on commit drop as
with ranked as (
  select
    t.id,
    row_number() over (
      partition by public.team_directory_key(t.name)
      order by (
        (select count(*) from public.tournament_entries te where te.team_id = t.id) +
        (select count(*) from public.tournament_registrations tr where tr.team_id = t.id) +
        (select count(*) from public.achievements a where a.team_id = t.id) +
        (select count(*) from public.manager_clubs mc where mc.team_id = t.id) +
        (select count(*) from public.manager_team_aliases mta where mta.team_id = t.id) +
        (select count(*) from public.team_aliases ta where ta.team_id = t.id)
      ) desc,
      t.id asc
    ) as rn,
    first_value(t.id) over (
      partition by public.team_directory_key(t.name)
      order by (
        (select count(*) from public.tournament_entries te where te.team_id = t.id) +
        (select count(*) from public.tournament_registrations tr where tr.team_id = t.id) +
        (select count(*) from public.achievements a where a.team_id = t.id) +
        (select count(*) from public.manager_clubs mc where mc.team_id = t.id) +
        (select count(*) from public.manager_team_aliases mta where mta.team_id = t.id) +
        (select count(*) from public.team_aliases ta where ta.team_id = t.id)
      ) desc,
      t.id asc
    ) as keeper_id
  from public.teams t
  where public.team_directory_key(t.name) <> ''
)
select id as duplicate_id, keeper_id
from ranked
where rn > 1;

update public.tournament_entries te
set team_id = d.keeper_id
from team_duplicate_map d
where te.team_id = d.duplicate_id;

update public.tournament_registrations tr
set team_id = d.keeper_id
from team_duplicate_map d
where tr.team_id = d.duplicate_id;

update public.achievements a
set team_id = d.keeper_id
from team_duplicate_map d
where a.team_id = d.duplicate_id;

update public.manager_clubs mc
set team_id = d.keeper_id
from team_duplicate_map d
where mc.team_id = d.duplicate_id;

update public.manager_team_aliases mta
set team_id = d.keeper_id
from team_duplicate_map d
where mta.team_id = d.duplicate_id;

update public.team_aliases ta
set team_id = d.keeper_id
from team_duplicate_map d
where ta.team_id = d.duplicate_id;

-- Remove duplicate team rows once every known reference has been repointed.
delete from public.teams t
using team_duplicate_map d
where t.id = d.duplicate_id;

-- Backfill canonical active clubs using the normalized key, not lower(name).
insert into public.teams (name, active)
select source.club_name, true
from (
  select distinct on (public.team_directory_key(g.club_name)) g.club_name
  from public.game_world_clubs g
  where g.active = true
    and nullif(trim(g.club_name), '') is not null
  order by public.team_directory_key(g.club_name), g.club_name
) source
where not exists (
  select 1 from public.teams t
  where public.team_directory_key(t.name) = public.team_directory_key(source.club_name)
)
on conflict (name) do update set active = true;

create or replace function public.sync_game_world_club_to_teams()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.active = true and nullif(trim(new.club_name), '') is not null then
    update public.teams
    set active = true
    where public.team_directory_key(name) = public.team_directory_key(new.club_name);

    if not found then
      insert into public.teams (name, active)
      values (new.club_name, true)
      on conflict (name) do update set active = true;
    end if;
  end if;

  return new;
end;
$$;
