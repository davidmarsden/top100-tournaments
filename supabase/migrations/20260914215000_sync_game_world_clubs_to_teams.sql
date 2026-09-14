-- Keep the legacy teams directory used by tournament_entries in sync with
-- the canonical game-world club directory used by registration and manager identity.

-- Remove old automated test clubs, but only when nothing in production refers to them.
delete from public.teams t
where t.name ilike 'Test Club %'
  and not exists (select 1 from public.achievements a where a.team_id = t.id)
  and not exists (select 1 from public.manager_clubs mc where mc.team_id = t.id)
  and not exists (select 1 from public.manager_team_aliases mta where mta.team_id = t.id)
  and not exists (select 1 from public.team_aliases ta where ta.team_id = t.id)
  and not exists (select 1 from public.tournament_entries te where te.team_id = t.id)
  and not exists (select 1 from public.tournament_registrations tr where tr.team_id = t.id);

-- Backfill every active canonical game-world club that is missing from teams.
insert into public.teams (name, active)
select source.club_name, true
from (
  select distinct on (lower(g.club_name)) g.club_name
  from public.game_world_clubs g
  where g.active = true
    and nullif(trim(g.club_name), '') is not null
  order by lower(g.club_name), g.club_name
) source
where not exists (
  select 1
  from public.teams t
  where lower(t.name) = lower(source.club_name)
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
    where lower(name) = lower(new.club_name);

    if not found then
      insert into public.teams (name, active)
      values (new.club_name, true)
      on conflict (name) do update set active = true;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_game_world_club_to_teams on public.game_world_clubs;
create trigger sync_game_world_club_to_teams
after insert or update of club_name, active on public.game_world_clubs
for each row execute function public.sync_game_world_club_to_teams();