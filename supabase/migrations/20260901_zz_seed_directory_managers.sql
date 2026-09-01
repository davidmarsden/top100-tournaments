-- Ensure every occupied game-world directory manager has a canonical managers row.
-- This file sorts after 20260901_seed_game_world_clubs.sql so the directory exists
-- and is populated before manager identities are derived from it.
-- Existing managers are reused by normalized name so the same person can appear in
-- more than one game world without creating duplicate manager identities.
insert into public.managers(name, display_name, canonical_name, active)
select distinct on (c.manager_key)
  c.current_manager_name,
  c.current_manager_name,
  lower(c.current_manager_name),
  true
from public.game_world_clubs c
where c.active = true
  and c.occupied = true
  and c.current_manager_name is not null
  and c.manager_key is not null
  and not exists (
    select 1
    from public.managers m
    where public.normal_registration_key(coalesce(m.display_name, m.name)) = c.manager_key
  )
order by c.manager_key, c.current_manager_name;

-- Now that missing identities exist, refresh pending directory-backed claims with
-- a canonical manager suggestion. The claim guard will verify the club/world pair.
update public.manager_portal_claims c
set suggested_manager_id = m.id,
    updated_at = now()
from public.game_world_clubs gwc
join public.managers m
  on public.normal_registration_key(coalesce(m.display_name, m.name)) = gwc.manager_key
where c.status = 'pending'
  and c.game_world_id = gwc.game_world_id
  and public.normal_registration_key(c.claimed_club_name) = gwc.club_key
  and public.normal_registration_key(c.claimed_manager_name) = gwc.manager_key;
