alter table public.tournament_registrations
  drop constraint if exists tournament_registrations_rating_range;

alter table public.tournament_registrations
  alter column rating drop not null,
  add constraint tournament_registrations_rating_range
    check (rating is null or (rating between 65 and 95 and rating = trunc(rating)));

create or replace function public.validate_tournament_registration_directory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_game_world_id bigint;
  club_row public.game_world_clubs%rowtype;
begin
  if new.rating is null or new.rating < 65 or new.rating > 95 or new.rating <> trunc(new.rating) then
    raise exception 'Choose an average team rating from 65 to 95';
  end if;

  select t.game_world_id into target_game_world_id
  from public.tournaments t
  where t.id = new.tournament_id;

  if target_game_world_id is null then
    raise exception 'Tournament has no game world';
  end if;

  select * into club_row
  from public.game_world_clubs c
  where c.game_world_id = target_game_world_id
    and c.club_key = public.normal_registration_key(new.club_name)
    and c.active = true
    and c.occupied = true
  limit 1;

  if not found then
    raise exception 'Choose a currently managed club from this game world';
  end if;

  if club_row.manager_key is null
     or club_row.manager_key <> public.normal_registration_key(new.manager_name) then
    raise exception '% is currently listed as managed by %', club_row.club_name, club_row.current_manager_name;
  end if;

  new.club_name := club_row.club_name;
  new.club_key := club_row.club_key;
  new.manager_name := club_row.current_manager_name;
  new.manager_key := club_row.manager_key;
  return new;
end;
$$;

revoke all on function public.validate_tournament_registration_directory() from public, anon, authenticated;