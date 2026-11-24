-- Waiting list: the administrators can remove someone from a game world's list for good. Leaving
-- the list yourself (withdrawn) or lapsing still lets you rejoin; a removed entry does not, and nor
-- does a new account under the same Soccer Manager name in that game world.
--
-- removed_at marks the removal (the status stays 'withdrawn', so places and offers ignore it).
-- update_waiting_list_entry(): officials set {"removed": true|false}.
-- join_waiting_list(): refuses a removed person, by account or by SM manager name.
-- waiting_list_admin(): returns removedAt (patched in place; the anchor must match exactly once).

alter table public.waiting_list_entries add column if not exists removed_at timestamptz;

create or replace function public.update_waiting_list_entry(p_id bigint, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can update the waiting list.'; end if;
  if p_fields ? 'status' and p_fields->>'status' not in ('waiting', 'offered', 'appointed', 'withdrawn', 'lapsed') then
    raise exception 'Unknown status.';
  end if;
  update public.waiting_list_entries entry set
    status = case
      when p_fields ? 'removed' and (p_fields->>'removed')::boolean then 'withdrawn'
      when p_fields ? 'status' then p_fields->>'status'
      else entry.status end,
    removed_at = case
      when p_fields ? 'removed' and (p_fields->>'removed')::boolean then coalesce(entry.removed_at, now())
      when p_fields ? 'removed' then null
      else entry.removed_at end,
    preferred_club_ids = case when p_fields ? 'removed' and (p_fields->>'removed')::boolean then '{}' else entry.preferred_club_ids end,
    manager_id = case when p_fields ? 'managerId' then (p_fields->>'managerId')::bigint else entry.manager_id end,
    sm_manager_id = case when p_fields ? 'smManagerId' then nullif(btrim(p_fields->>'smManagerId'), '') else entry.sm_manager_id end,
    gold = case when p_fields ? 'gold' then (p_fields->>'gold')::boolean else entry.gold end,
    game_worlds = case when p_fields ? 'gameWorlds' then (p_fields->>'gameWorlds')::integer else entry.game_worlds end,
    admin_notes = case when p_fields ? 'adminNotes' then nullif(btrim(p_fields->>'adminNotes'), '') else entry.admin_notes end,
    offer_club = case when p_fields ? 'offerClub' then nullif(btrim(p_fields->>'offerClub'), '') else entry.offer_club end,
    offer_deadline = case when p_fields ? 'offerDeadline' then (p_fields->>'offerDeadline')::timestamptz else entry.offer_deadline end,
    updated_at = now()
  where entry.id = p_id;
  if not found then raise exception 'No such waiting list entry.'; end if;
end;
$$;

create or replace function public.join_waiting_list(p_world_slugs text[], p_sm_manager_name text, p_how_found text default null, p_agree boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_name text := btrim(coalesce(p_sm_manager_name, ''));
  v_slug text;
  v_world bigint;
  v_my_manager bigint := public.appointment_my_manager_id();
begin
  if v_user is null then raise exception 'Sign in to join the waiting list.'; end if;
  if not coalesce(p_agree, false) then raise exception 'Please accept the rules agreement to join the waiting list.'; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'Enter your Soccer Manager manager name.'; end if;
  if coalesce(array_length(p_world_slugs, 1), 0) = 0 then raise exception 'Choose at least one game world.'; end if;
  select email into v_email from auth.users where id = v_user;

  foreach v_slug in array p_world_slugs loop
    v_world := public.appointment_world_id(v_slug);
    if v_world is null or v_slug not in ('top-100', 'regen') then raise exception 'Unknown game world: %', v_slug; end if;
    if v_my_manager is not null and exists (
      select 1 from public.manager_game_world_memberships membership
      where membership.manager_id = v_my_manager and membership.game_world_id = v_world and membership.active
    ) then
      raise exception 'You already manage a club in %.', (select name from public.game_worlds where id = v_world);
    end if;
    -- Removed by the administrators: not by rejoining, nor under another account with the same SM name.
    if exists (
      select 1 from public.waiting_list_entries removed
      where removed.game_world_id = v_world and removed.removed_at is not null
        and (removed.auth_user_id = v_user
             or public.normal_registration_key(removed.sm_manager_name) = public.normal_registration_key(v_name))
    ) then
      raise exception 'The % waiting list is not open to you. Please contact the administrators.', (select name from public.game_worlds where id = v_world);
    end if;
    insert into public.waiting_list_entries as entry (game_world_id, auth_user_id, email, sm_manager_name, how_found, agreed_at, status, confirmed_season, manager_id)
    values (v_world, v_user, v_email, v_name, nullif(btrim(coalesce(p_how_found, '')), ''), now(), 'waiting',
            public.appointment_current_season(v_slug), v_my_manager)
    on conflict (game_world_id, auth_user_id) do update set
      email = excluded.email,
      sm_manager_name = excluded.sm_manager_name,
      how_found = coalesce(excluded.how_found, entry.how_found),
      agreed_at = excluded.agreed_at,
      confirmed_season = excluded.confirmed_season,
      manager_id = coalesce(entry.manager_id, excluded.manager_id),
      -- Rejoining after leaving or lapsing starts a new place; an offer or appointment stands.
      status = case when entry.status in ('withdrawn', 'lapsed') then 'waiting' else entry.status end,
      created_at = case when entry.status in ('withdrawn', 'lapsed') then now() else entry.created_at end,
      updated_at = now();
  end loop;
  return public.my_waiting_list();
end;
$$;

do $$
declare
  v_ddl text;
  v_anchor constant text := '''adminNotes'', entry.admin_notes,';
  v_patch constant text := '''adminNotes'', entry.admin_notes, ''removedAt'', entry.removed_at,';
begin
  v_ddl := pg_get_functiondef('public.waiting_list_admin(text)'::regprocedure);
  if (length(v_ddl) - length(replace(v_ddl, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'waiting_list_admin anchor was not found exactly once; refusing an unsafe migration';
  end if;
  execute replace(v_ddl, v_anchor, v_patch);
end;
$$;
