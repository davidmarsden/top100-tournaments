-- Squads step: mark when it last applied each player (squad_applied_at).
--
-- Restored into the repository from the live database's migration history, where it was
-- applied on 11 Nov 2026 without being committed. The SQL below is exactly what ran.
--
-- Adds soccer_manager_players.squad_applied_at, set only by the squads step
-- (apply_soccer_manager_player_transfer_archive_step), and backfills it. The step used to skip
-- a player once last_seen_at reached the squad entity's approval time; it now skips one only
-- when squad_applied_at has reached it and the player's current team already matches the
-- club's team link. The function is patched in place, and the migration stops if any expected
-- fragment is missing.

alter table public.soccer_manager_players add column if not exists squad_applied_at timestamptz;

update public.soccer_manager_players player
set squad_applied_at = entity.last_approved_at
from public.soccer_manager_canonical_entities entity
join public.game_worlds world on world.external_world_id::text = entity.data->>'setupId'
where entity.entity_type = 'squad_player'
  and player.game_world_id = world.id
  and player.source_player_id = nullif(trim(coalesce(entity.data->>'playerDataId', entity.data->>'playerId')), '')
  and entity.last_approved_at <= player.last_seen_at
  and player.squad_applied_at is null;

do $patch$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='apply_soccer_manager_player_transfer_archive_step';
  if position($o$        and not exists (
          select 1 from public.soccer_manager_players applied
          where applied.game_world_id = v_world_id
            and applied.source_player_id = nullif(trim(coalesce(entity.data->>'playerDataId', entity.data->>'playerId')), '')
            and entity.last_approved_at is not null
            and applied.last_seen_at >= entity.last_approved_at
        )$o$ in v_def) = 0 then raise exception 'fragment 0 missing'; end if;
  v_def := replace(v_def, $o$        and not exists (
          select 1 from public.soccer_manager_players applied
          where applied.game_world_id = v_world_id
            and applied.source_player_id = nullif(trim(coalesce(entity.data->>'playerDataId', entity.data->>'playerId')), '')
            and entity.last_approved_at is not null
            and applied.last_seen_at >= entity.last_approved_at
        )$o$, $n$        and not exists (
          -- Already applied: this squad entity's approval (squad_applied_at, which only this step
          -- sets) and the club's current team link are both reflected in the player row.
          select 1 from public.soccer_manager_players applied
          where applied.game_world_id = v_world_id
            and applied.source_player_id = nullif(trim(coalesce(entity.data->>'playerDataId', entity.data->>'playerId')), '')
            and entity.last_approved_at is not null
            and applied.squad_applied_at >= entity.last_approved_at
            and applied.current_team_id is not distinct from (
              select link.target_id
              from public.soccer_manager_archive_links link
              join public.teams team on team.id = link.target_id
              where link.source_type = 'club'
                and link.source_key = setup_id || ':' || nullif(trim(entity.data->>'clubId'), '')
                and link.target_type = 'team')
        )$n$);
  if position($o$    -- Only players whose squad entity was approved after it was last applied (or who have no
    -- player row yet): applying sets last_seen_at to at least the entity's last_approved_at, so
    -- the rest would write nothing. Re-processing all of them (4,127 in Regen) took 2.5 s idle
    -- and over the 8-second limit during a sync.$o$ in v_def) = 0 then raise exception 'fragment 1 missing'; end if;
  v_def := replace(v_def, $o$    -- Only players whose squad entity was approved after it was last applied (or who have no
    -- player row yet): applying sets last_seen_at to at least the entity's last_approved_at, so
    -- the rest would write nothing. Re-processing all of them (4,127 in Regen) took 2.5 s idle
    -- and over the 8-second limit during a sync.$o$, $n$    -- Only players whose squad entity was approved after the squads step last applied it, whose
    -- club's team link differs from their current team (a link created later, or a membership
    -- cleared by a roster), or who have no player row yet; the rest would write nothing.
    -- Re-processing all of them (4,127 in Regen) took 2.5 s idle and over the 8-second limit
    -- during a sync.$n$);
  if position($o$        last_seen_at, updated_at
      )
      select
        v_world_id, row_data.source_player_id, row_data.source_squad_player_id,$o$ in v_def) = 0 then raise exception 'fragment 2 missing'; end if;
  v_def := replace(v_def, $o$        last_seen_at, updated_at
      )
      select
        v_world_id, row_data.source_player_id, row_data.source_squad_player_id,$o$, $n$        last_seen_at, squad_applied_at, updated_at
      )
      select
        v_world_id, row_data.source_player_id, row_data.source_squad_player_id,$n$);
  if position($o$        coalesce(row_data.last_approved_at, now()),
        now()
      from (
        select distinct on (squad.source_player_id)$o$ in v_def) = 0 then raise exception 'fragment 3 missing'; end if;
  v_def := replace(v_def, $o$        coalesce(row_data.last_approved_at, now()),
        now()
      from (
        select distinct on (squad.source_player_id)$o$, $n$        coalesce(row_data.last_approved_at, now()),
        row_data.last_approved_at,
        now()
      from (
        select distinct on (squad.source_player_id)$n$);
  if position($o$            last_seen_at = greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at),
            updated_at = now()
      where (
             public.soccer_manager_players.source_squad_player_id,$o$ in v_def) = 0 then raise exception 'fragment 4 missing'; end if;
  v_def := replace(v_def, $o$            last_seen_at = greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at),
            updated_at = now()
      where (
             public.soccer_manager_players.source_squad_player_id,$o$, $n$            last_seen_at = greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at),
            squad_applied_at = greatest(public.soccer_manager_players.squad_applied_at, excluded.squad_applied_at),
            updated_at = now()
      where (
             public.soccer_manager_players.source_squad_player_id,$n$);
  if position($o$             public.soccer_manager_players.last_seen_at
            ) is distinct from ($o$ in v_def) = 0 then raise exception 'fragment 5 missing'; end if;
  v_def := replace(v_def, $o$             public.soccer_manager_players.last_seen_at
            ) is distinct from ($o$, $n$             public.soccer_manager_players.last_seen_at,
             public.soccer_manager_players.squad_applied_at
            ) is distinct from ($n$);
  if position($o$             greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at)
            )
      returning 1$o$ in v_def) = 0 then raise exception 'fragment 6 missing'; end if;
  v_def := replace(v_def, $o$             greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at)
            )
      returning 1$o$, $n$             greatest(public.soccer_manager_players.last_seen_at, excluded.last_seen_at),
             greatest(public.soccer_manager_players.squad_applied_at, excluded.squad_applied_at)
            )
      returning 1$n$);
  execute v_def;
end
$patch$;
