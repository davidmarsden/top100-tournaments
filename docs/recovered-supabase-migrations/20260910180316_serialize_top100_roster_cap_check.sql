create or replace function public.enforce_top100_active_manager_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  world_slug text;
  active_count integer;
begin
  if not coalesce(new.active, false) then
    return new;
  end if;

  select gw.slug into world_slug
  from public.game_worlds gw
  where gw.id = new.game_world_id
  for update;

  if world_slug is distinct from 'top-100' then
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