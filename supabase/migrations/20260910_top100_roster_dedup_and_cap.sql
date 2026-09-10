-- Repair duplicate Top 100 identities discovered after introducing game-world-scoped
-- manager lifecycle, and enforce the game's hard cap of 100 active managers.

-- 1) James McKenzie: retain the established identity that already owns historical
-- tournament activity; retire the duplicate spelling-only identity.
do $$
declare
  top100_world_id bigint;
  canonical_id bigint;
  duplicate_id bigint;
begin
  select id into top100_world_id from public.game_worlds where slug = 'top-100';

  select m.id into canonical_id
  from public.managers m
  where public.normal_registration_key(coalesce(m.display_name, m.name)) = public.normal_registration_key('James McKenzie')
  order by (select count(*) from public.tournament_entries te where te.manager_id = m.id) desc,
           m.id
  limit 1;

  for duplicate_id in
    select m.id from public.managers m
    where public.normal_registration_key(coalesce(m.display_name, m.name)) = public.normal_registration_key('James McKenzie')
      and m.id <> canonical_id
  loop
    update public.tournament_entries set manager_id = canonical_id where manager_id = duplicate_id;
    update public.tournament_registrations set manager_id = canonical_id where manager_id = duplicate_id;
    update public.manager_game_world_memberships
      set active = false, updated_at = now()
      where manager_id = duplicate_id and game_world_id = top100_world_id;
    if not exists (select 1 from public.manager_game_world_memberships where manager_id = duplicate_id and active = true) then
      update public.managers set active = false where id = duplicate_id;
    end if;
  end loop;
end $$;

-- 2) Stephen Beddows / Sir Stephen Beddows (God): retain the identity linked to
-- the real Manager Portal account and make its display name match the current
-- Top 100 directory label. Historical name remains in managers.name.
do $$
declare
  top100_world_id bigint;
  canonical_id bigint;
  duplicate_id bigint;
  current_label text;
begin
  select id into top100_world_id from public.game_worlds where slug = 'top-100';

  select m.id into canonical_id
  from public.managers m
  join public.manager_portal_accounts a on a.manager_id = m.id
  where a.game_world_id = top100_world_id
    and lower(coalesce(m.name,'')) like '%beddows%'
  order by a.active desc, m.id
  limit 1;

  select c.current_manager_name into current_label
  from public.game_world_clubs c
  where c.game_world_id = top100_world_id
    and c.active = true and c.occupied = true
    and lower(coalesce(c.current_manager_name,'')) like '%beddows%'
  order by c.id
  limit 1;

  if canonical_id is not null then
    if current_label is not null then
      update public.managers
      set display_name = current_label,
          canonical_name = public.normal_registration_key(current_label)
      where id = canonical_id;
    end if;

    for duplicate_id in
      select m.id from public.managers m
      where lower(coalesce(m.name,'')) like '%beddows%'
        and m.id <> canonical_id
        and exists (
          select 1 from public.manager_game_world_memberships gm
          where gm.manager_id = m.id and gm.game_world_id = top100_world_id
        )
    loop
      update public.tournament_entries set manager_id = canonical_id where manager_id = duplicate_id;
      update public.tournament_registrations set manager_id = canonical_id where manager_id = duplicate_id;
      update public.manager_game_world_memberships
        set active = false, updated_at = now()
        where manager_id = duplicate_id and game_world_id = top100_world_id;
      if not exists (select 1 from public.manager_game_world_memberships where manager_id = duplicate_id and active = true) then
        update public.managers set active = false where id = duplicate_id;
      end if;
    end loop;
  end if;
end $$;

-- 3) Steve/Steven/Stephen Allington: retain the identity linked to the real
-- Manager Portal account, move any newer tournament references onto it, and use
-- the current directory spelling as the display label.
do $$
declare
  top100_world_id bigint;
  canonical_id bigint;
  duplicate_id bigint;
  current_label text;
begin
  select id into top100_world_id from public.game_worlds where slug = 'top-100';

  select m.id into canonical_id
  from public.managers m
  join public.manager_portal_accounts a on a.manager_id = m.id
  where a.game_world_id = top100_world_id
    and lower(coalesce(m.name,'')) like '%allington%'
  order by a.active desc, m.id
  limit 1;

  select c.current_manager_name into current_label
  from public.game_world_clubs c
  where c.game_world_id = top100_world_id
    and c.active = true and c.occupied = true
    and lower(coalesce(c.current_manager_name,'')) like '%allington%'
  order by c.id
  limit 1;

  if canonical_id is not null then
    if current_label is not null then
      update public.managers
      set display_name = current_label,
          canonical_name = public.normal_registration_key(current_label)
      where id = canonical_id;
    end if;

    for duplicate_id in
      select m.id from public.managers m
      where lower(coalesce(m.name,'')) like '%allington%'
        and m.id <> canonical_id
        and exists (
          select 1 from public.manager_game_world_memberships gm
          where gm.manager_id = m.id and gm.game_world_id = top100_world_id
        )
    loop
      update public.tournament_entries set manager_id = canonical_id where manager_id = duplicate_id;
      update public.tournament_registrations set manager_id = canonical_id where manager_id = duplicate_id;
      update public.manager_game_world_memberships
        set active = false, updated_at = now()
        where manager_id = duplicate_id and game_world_id = top100_world_id;
      if not exists (select 1 from public.manager_game_world_memberships where manager_id = duplicate_id and active = true) then
        update public.managers set active = false where id = duplicate_id;
      end if;
    end loop;
  end if;
end $$;

-- Enforce the hard Top 100 roster cap at the database boundary so imports,
-- admin tools and future code paths cannot silently create manager 101.
create or replace function public.enforce_top100_active_manager_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_top100 boolean;
  active_count integer;
begin
  if not coalesce(new.active, false) then
    return new;
  end if;

  select exists(
    select 1 from public.game_worlds gw
    where gw.id = new.game_world_id and gw.slug = 'top-100'
  ) into is_top100;

  if not is_top100 then
    return new;
  end if;

  select count(*) into active_count
  from public.manager_game_world_memberships gm
  where gm.game_world_id = new.game_world_id
    and gm.active = true
    and gm.manager_id <> new.manager_id;

  if active_count >= 100 then
    raise exception 'Top 100 already has 100 active managers. Mark a departing manager inactive before adding or reactivating another.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_top100_active_manager_cap() from public, anon, authenticated;

drop trigger if exists top100_active_manager_cap on public.manager_game_world_memberships;
create trigger top100_active_manager_cap
before insert or update of game_world_id, manager_id, active
on public.manager_game_world_memberships
for each row execute function public.enforce_top100_active_manager_cap();
