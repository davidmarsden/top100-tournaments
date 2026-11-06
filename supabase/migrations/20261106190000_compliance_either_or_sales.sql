-- Required sales can name alternatives: "sell either Forsberg or Alberto" (the
-- Sassuolo ruling, where either signing took the squad over 50). The form only
-- took one Soccer Manager player ID, so an either-or ruling could not be recorded.
--
-- 1. compliance_obligations.choice_group links the rows of one either-or ruling
--    (one row per named player, so sale, breach and re-bid checks stay per player).
--    Status 'released': another player in the group was sold, so this one no longer
--    has to go (and is not covered by the no re-bid rule).
-- 2. add_compliance_obligations(): records one ruling for one or more players.
-- 3. enqueue_compliance_events(): when one player in a group is sold, the others
--    are released (patched in place; the anchor must match exactly once).
-- 4. set_compliance_obligation_status(): waiving or reopening applies to the whole
--    group.
-- 5. compliance_obligation_overview() returns choice_group; compliance_club_squad()
--    lists a club's latest synced squad for the form's player picker.

alter table public.compliance_obligations add column if not exists choice_group uuid;
create index if not exists compliance_obligations_choice_group_idx
  on public.compliance_obligations (choice_group) where choice_group is not null;

alter table public.compliance_obligations drop constraint if exists compliance_obligations_status_check;
alter table public.compliance_obligations add constraint compliance_obligations_status_check
  check (status in ('open', 'met', 'breached', 'waived', 'released'));

comment on column public.compliance_obligations.choice_group is
  'Rows sharing a value are one either-or ruling: selling any one of the players meets it.';

-- The display name of a synced player: "E.FORSBERG", without repeating the surname.
create or replace function public.compliance_player_name(p_game_world_id bigint, p_source_player_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when player.surname is null or player.name ilike '%' || player.surname || '%' then coalesce(player.name, player.surname)
           else player.name || ' ' || player.surname
         end
  from public.soccer_manager_players player
  where player.game_world_id = p_game_world_id and player.source_player_id = p_source_player_id
  limit 1;
$$;

revoke all on function public.compliance_player_name(bigint, text) from public, anon, authenticated;
grant execute on function public.compliance_player_name(bigint, text) to service_role;

create or replace function public.add_compliance_obligations(
  p_source_club_id text, p_source_player_ids text[], p_requirement text, p_no_rebid boolean, p_reason text,
  p_breach_id bigint default null, p_world_slug text default 'top-100'
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

  if array_length(v_ids, 1) > 1 then v_group := gen_random_uuid(); end if;

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

revoke all on function public.add_compliance_obligations(text, text[], text, boolean, text, bigint, text) from public, anon;
grant execute on function public.add_compliance_obligations(text, text[], text, boolean, text, bigint, text) to authenticated;

create or replace function public.set_compliance_obligation_status(p_obligation_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can change required sales.'; end if;
  if p_status not in ('open', 'waived', 'met', 'breached') then raise exception 'Unknown status %', p_status; end if;
  update public.compliance_obligations set status = p_status, resolved_at = case when p_status = 'open' then null else now() end
  where id = p_obligation_id
  returning choice_group into v_group;
  -- An either-or ruling is waived or reopened as a whole.
  if v_group is not null and p_status in ('waived', 'open') then
    update public.compliance_obligations
    set status = p_status, resolved_at = case when p_status = 'open' then null else now() end
    where choice_group = v_group and id <> p_obligation_id
      and status in (case when p_status = 'open' then 'released' else 'open' end, case when p_status = 'open' then 'waived' else 'open' end);
  end if;
end;
$$;

revoke all on function public.set_compliance_obligation_status(bigint, text) from public, anon;
grant execute on function public.set_compliance_obligation_status(bigint, text) to authenticated;

-- The club's squad from the latest sync, for choosing the players in a ruling.
create or replace function public.compliance_club_squad(p_source_club_id text, p_world_slug text default 'top-100')
returns table (source_player_id text, player_name text, player_position text, rating integer, age integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can view squads here.'; end if;
  return query
  select player.source_player_id, public.compliance_player_name(player.game_world_id, player.source_player_id),
    player.position, player.rating, player.age
  from public.soccer_manager_players player
  join public.game_worlds world on world.id = player.game_world_id and world.slug = p_world_slug
  where player.current_source_club_id = p_source_club_id
  order by player.position_id nulls last, player.rating desc nulls last, player.name;
end;
$$;

revoke all on function public.compliance_club_squad(text, text) from public, anon;
grant execute on function public.compliance_club_squad(text, text) to authenticated;

drop function if exists public.compliance_obligation_overview(text);
create function public.compliance_obligation_overview(p_world_slug text default 'top-100')
returns table (
  id bigint,
  club_name text,
  source_club_id text,
  player_name text,
  source_player_id text,
  requirement text,
  no_rebid boolean,
  reason text,
  status text,
  resolved_transfer jsonb,
  sellable_from timestamptz,
  player_banned boolean,
  checked_at timestamptz,
  choice_group uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can view required sales.'; end if;
  return query
  select obligation.id, obligation.club_name, obligation.source_club_id, obligation.player_name, obligation.source_player_id,
    obligation.requirement, obligation.no_rebid, obligation.reason, obligation.status, obligation.resolved_transfer,
    case when latest.fields->>'tbraw' ~ '^[0-9]+$' then to_timestamp((latest.fields->>'tbraw')::bigint) end,
    coalesce((latest.fields->>'tban')::boolean, false),
    latest.captured_at,
    obligation.choice_group
  from public.compliance_obligations obligation
  cross join (select game_world.id, game_world.external_world_id from public.game_worlds game_world where game_world.slug = p_world_slug) world
  left join lateral (
    select snapshot.source_data->'sourceFields' as fields, snapshot.captured_at
    from public.soccer_manager_player_snapshots snapshot
    where snapshot.game_world_id = world.id and snapshot.source_data->>'playerDataId' = obligation.source_player_id
    order by snapshot.captured_at desc limit 1
  ) latest on true
  where obligation.source_world_id = world.external_world_id
  order by obligation.status = 'open' desc, 11 nulls last, obligation.club_name, obligation.choice_group nulls first, obligation.player_name;
end;
$$;

revoke all on function public.compliance_obligation_overview(text) from public, anon;
grant execute on function public.compliance_obligation_overview(text) to authenticated;

do $migration$
declare
  v_anchor text := E'  loop\n    if v_row.requirement = ''sell'' or (v_row.to_manager = ''0'' and coalesce(v_row.amount, 0) > 0) then\n';
  v_patch text := E'  loop\n'
    || E'    -- Either-or ruling: selling this player means the others no longer have to go.\n'
    || E'    if v_row.choice_group is not null then\n'
    || E'      update public.compliance_obligations\n'
    || E'      set status = ''released'', resolved_at = now(),\n'
    || E'          resolved_transfer = jsonb_build_object(''released_by'', v_row.id, ''player'', v_row.player_name, ''date'', v_row.d)\n'
    || E'      where choice_group = v_row.choice_group and id <> v_row.id and status = ''open'';\n'
    || E'    end if;\n\n'
    || E'    if v_row.requirement = ''sell'' or (v_row.to_manager = ''0'' and coalesce(v_row.amount, 0) > 0) then\n';
  v_ddl text;
begin
  v_ddl := pg_get_functiondef('public.enqueue_compliance_events(text)'::regprocedure);
  if (length(v_ddl) - length(replace(v_ddl, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'enqueue_compliance_events anchor was not found exactly once; refusing an unsafe migration';
  end if;
  execute replace(v_ddl, v_anchor, v_patch);
end;
$migration$;

revoke all on function public.enqueue_compliance_events(text) from public, anon, authenticated;
grant execute on function public.enqueue_compliance_events(text) to service_role;
