-- Clubs for the waiting list: managers waiting for a club can see which clubs are free in each
-- game world and choose up to three, in order of preference. Clubs are still offered in waiting-
-- list order (rule 3.3: returning Top 100 managers first, then by score); the administrators use
-- the choices when they make each offer.
--
-- waiting_list_open_clubs(): signed-in users. Each game world's free clubs (game_world_clubs not
-- occupied), with division; clubs in an undecided vacancy round are marked (current managers apply
-- first) and clubs already offered to someone on the list are left out.
-- my_waiting_list_choices(): the caller's choices per game world.
-- set_waiting_list_choices(world, club ids): the caller's waiting entry in that world; up to three
-- free clubs of that world, in order.
-- waiting_list_choices_admin(world): officials only; each entry's choices by name.

alter table public.waiting_list_entries add column if not exists preferred_club_ids bigint[] not null default '{}';

create or replace function public.waiting_list_open_clubs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'world', world.slug, 'worldName', world.name,
      'clubs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', club.id, 'name', club.club_name, 'division', club.division,
          'inVacancyRound', exists (
            select 1 from public.appointment_vacancies vacancy
            where vacancy.game_world_id = world.id and lower(vacancy.club_name) = lower(club.club_name)
              and vacancy.status in ('open', 'closed') and vacancy.archived_at is null))
          order by club.division nulls last, club.club_name)
        from public.game_world_clubs club
        where club.game_world_id = world.id and club.active and not club.occupied
          and not exists (
            select 1 from public.waiting_list_entries offered
            where offered.game_world_id = world.id and offered.status = 'offered'
              and lower(offered.offer_club) = lower(club.club_name))), '[]'::jsonb))
      order by world.display_order, world.id)
    from public.game_worlds world
    where world.slug in ('top-100', 'regen')), '[]'::jsonb) end;
$$;

revoke all on function public.waiting_list_open_clubs() from public, anon;
grant execute on function public.waiting_list_open_clubs() to authenticated;

create or replace function public.my_waiting_list_choices()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(world.slug, to_jsonb(entry.preferred_club_ids)), '{}'::jsonb)
  from public.waiting_list_entries entry
  join public.game_worlds world on world.id = entry.game_world_id
  where entry.auth_user_id = auth.uid();
$$;

revoke all on function public.my_waiting_list_choices() from public, anon;
grant execute on function public.my_waiting_list_choices() to authenticated;

create or replace function public.set_waiting_list_choices(p_world_slug text, p_club_ids bigint[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_world public.game_worlds;
  v_entry public.waiting_list_entries;
  v_ids bigint[];
  v_free integer;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into v_world from public.game_worlds where slug = p_world_slug;
  if not found then raise exception 'Unknown game world.'; end if;
  select * into v_entry from public.waiting_list_entries
  where auth_user_id = auth.uid() and game_world_id = v_world.id and status = 'waiting';
  if not found then raise exception 'You are not waiting for a club in %.', v_world.name; end if;

  -- Keep the order given, drop blanks and repeats.
  select coalesce(array_agg(id order by first_pos), '{}') into v_ids
  from (select id, min(pos) as first_pos from unnest(coalesce(p_club_ids, '{}')) with ordinality as chosen(id, pos)
        where id is not null group by id) chosen;
  if cardinality(v_ids) > 3 then raise exception 'Choose up to three clubs.'; end if;

  select count(*) into v_free from public.game_world_clubs club
  where club.id = any(v_ids) and club.game_world_id = v_world.id and club.active and not club.occupied;
  if v_free <> cardinality(v_ids) then raise exception 'One of those clubs is no longer free. Reload the page and choose again.'; end if;

  update public.waiting_list_entries set preferred_club_ids = v_ids, updated_at = now() where id = v_entry.id;
  return to_jsonb(v_ids);
end;
$$;

revoke all on function public.set_waiting_list_choices(text, bigint[]) from public, anon;
grant execute on function public.set_waiting_list_choices(text, bigint[]) to authenticated;

create or replace function public.waiting_list_choices_admin(p_world_slug text default 'top-100')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_top100_official() then null else coalesce((
    select jsonb_object_agg(entry.id::text, (
      select coalesce(jsonb_agg(jsonb_build_object('name', club.club_name, 'division', club.division, 'free', club.active and not club.occupied)
        order by chosen.pos), '[]'::jsonb)
      from unnest(entry.preferred_club_ids) with ordinality as chosen(id, pos)
      join public.game_world_clubs club on club.id = chosen.id))
    from public.waiting_list_entries entry
    join public.game_worlds world on world.id = entry.game_world_id
    where world.slug = p_world_slug and cardinality(entry.preferred_club_ids) > 0), '{}'::jsonb) end;
$$;

revoke all on function public.waiting_list_choices_admin(text) from public, anon;
grant execute on function public.waiting_list_choices_admin(text) to authenticated;
