-- Required sales naming several players: each must be sold, or selling any one is
-- enough. The form always recorded several players as an either-or ruling, so
-- Napoli (52 players: both signings that took them over 50 must go) was recorded
-- as "Gouweleeuw or Davies" (corrected by hand on 9 November 2026).
-- add_compliance_obligations() gains p_any_one: false (the default) records one
-- ruling per player; true links them as one either-or ruling (choice_group).

drop function if exists public.add_compliance_obligations(text, text[], text, boolean, text, bigint, text);

create or replace function public.add_compliance_obligations(
  p_source_club_id text, p_source_player_ids text[], p_requirement text, p_no_rebid boolean, p_reason text,
  p_breach_id bigint default null, p_world_slug text default 'top-100', p_any_one boolean default false
) returns setof public.compliance_obligations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world_id bigint;
  v_source_world bigint;
  v_ids text[];
  v_group uuid;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can add required sales.'; end if;
  select id, external_world_id into v_world_id, v_source_world from public.game_worlds where slug = p_world_slug;
  if v_world_id is null then raise exception 'Unknown game world %', p_world_slug; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Give a reason (the ruling).'; end if;

  select array_agg(distinct trim(value)) into v_ids from unnest(p_source_player_ids) value where nullif(trim(value), '') is not null;
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'Choose at least one player.'; end if;
  if array_length(v_ids, 1) > 10 then raise exception 'Name at most 10 players in one ruling.'; end if;
  if exists (select 1 from unnest(v_ids) value where value !~ '^[0-9]{1,20}$') then
    raise exception 'Soccer Manager player IDs are numbers.';
  end if;
  if exists (
    select 1 from public.compliance_obligations existing
    where existing.source_world_id = v_source_world and existing.source_club_id = p_source_club_id
      and existing.source_player_id = any(v_ids)
  ) then
    raise exception 'A required sale is already recorded for one of these players at this club.';
  end if;

  -- Several players: each must be sold (separate rulings) unless selling any one is enough.
  if array_length(v_ids, 1) > 1 and p_any_one then v_group := gen_random_uuid(); end if;

  return query
  insert into public.compliance_obligations
    (source_world_id, source_club_id, club_name, source_player_id, player_name, requirement, no_rebid, reason, breach_id, created_by, choice_group)
  select v_source_world, p_source_club_id,
    coalesce((select source_club_name from public.soccer_manager_club_crosswalk where source_world_id = v_source_world and source_club_id = p_source_club_id), 'Club ' || p_source_club_id),
    player_id, public.compliance_player_name(v_world_id, player_id),
    p_requirement, p_no_rebid, trim(p_reason), p_breach_id, auth.uid(), v_group
  from unnest(v_ids) player_id
  returning *;
end;
$$;

revoke all on function public.add_compliance_obligations(text, text[], text, boolean, text, bigint, text, boolean) from public, anon;
grant execute on function public.add_compliance_obligations(text, text[], text, boolean, text, bigint, text, boolean) to authenticated;
