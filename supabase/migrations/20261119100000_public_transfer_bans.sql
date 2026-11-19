-- Transfer bans every signed-in manager can see (Manager Portal home, Squad & Transfers, the
-- transfer board), so nobody deals with a banned club by mistake.
--
-- public_transfer_bans(world): the bans in force today or starting later: club, its current
-- manager and division, start and end dates and what the club may still do. The administrators'
-- reason text stays private.

-- The Sync tables come from Manager Lab's migrations, so SQL function bodies are not checked here.
set check_function_bodies = false;

create or replace function public.public_transfer_bans(p_world_slug text default 'top-100')
returns table (
  source_club_id text,
  club_name text,
  manager_name text,
  division integer,
  starts_on date,
  ends_on date,
  terms text
)
language sql
stable
security definer
set search_path = ''
as $$
  with world as (
    select id, external_world_id from public.game_worlds where slug = coalesce(nullif(trim(p_world_slug), ''), 'top-100')
  )
  select ban.source_club_id,
    coalesce(crosswalk.source_club_name, ban.club_name),
    coalesce(manager.display_name, manager.name, assignment.source_manager_name),
    club.division,
    ban.starts_on, ban.ends_on, ban.terms
  from public.club_transfer_bans ban
  join world on world.external_world_id = ban.source_world_id
  left join public.soccer_manager_club_crosswalk crosswalk
    on crosswalk.source_world_id = ban.source_world_id and crosswalk.source_club_id = ban.source_club_id
  left join public.game_world_clubs club on club.id = crosswalk.game_world_club_id
  left join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = world.id and assignment.team_id = crosswalk.team_id
  left join public.managers manager on manager.id = assignment.manager_id
  where ban.ends_on >= current_date
  order by ban.ends_on desc, 2;
$$;

revoke all on function public.public_transfer_bans(text) from public, anon;
grant execute on function public.public_transfer_bans(text) to authenticated;
