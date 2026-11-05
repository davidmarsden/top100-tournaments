-- Waiting list (rulebook 3.3): Regen seasons for the admin view. Top 100 Regen's league history only
-- holds the current season, so the count of seasons in it was 0 or 1. Instead, time at Regen clubs
-- (from the recorded club spells) is divided by the average Regen season length so far.
-- SQL function bodies depend on Manager Lab objects, so they are not checked here.
set check_function_bodies = false;

create or replace function public.waiting_list_admin(p_world_slug text default 'top-100')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  -- The average length of a Top 100 Regen season so far, in days: the time since the world's first
  -- recorded club spell, over the seasons played (completed seasons plus the share of the current
  -- one). Regen's league history only holds the current season, so time at a club is the measure.
  v_regen_start timestamptz := (select min(stint.started_at) from public.soccer_manager_manager_stints stint where stint.game_world_id = 2);
  v_regen_played numeric := (select (max(regen.season) - 1) + least(1, avg(regen.played) / 38.0) from public.public_league_season_rows('regen') regen);
  v_regen_season_days numeric := case when v_regen_played > 0 then extract(epoch from now() - v_regen_start) / 86400 / v_regen_played end;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can see the waiting list.'; end if;
  return jsonb_build_object(
    'world', p_world_slug,
    'season', public.appointment_current_season(p_world_slug),
    'entries', coalesce((select jsonb_agg(row_json order by (row_json->>'sortStatus')::integer, (row_json->>'place')::integer nulls last, row_json->>'joinedAt')
      from (
        select jsonb_build_object(
          'id', entry.id, 'managerName', entry.sm_manager_name, 'email', entry.email, 'howFound', entry.how_found,
          'status', entry.status, 'joinedAt', entry.created_at, 'agreedAt', entry.agreed_at,
          'confirmedSeason', entry.confirmed_season, 'managerId', entry.manager_id, 'smManagerId', coalesce(entry.sm_manager_id, stints.sm_manager_id),
          'adminNotes', entry.admin_notes, 'offerClub', entry.offer_club, 'offerDeadline', entry.offer_deadline,
          'returning', entry.is_returning, 'score', entry.score, 'scoreParts', entry.score_parts, 'scoredAt', entry.scored_at,
          'place', position.place,
          'sortStatus', case entry.status when 'offered' then 0 when 'waiting' then 1 when 'appointed' then 2 else 3 end,
          -- Gold and game worlds: the administrators' entry wins, otherwise the latest records check.
          'gold', coalesce(entry.gold, signal.gold), 'goldFrom', case when entry.gold is not null then 'admin' when signal.gold is not null then 'records' end,
          'gameWorlds', coalesce(entry.game_worlds, signal.game_worlds), 'gameWorldsFrom', case when entry.game_worlds is not null then 'admin' when signal.game_worlds is not null then 'records' end,
          'stints', coalesce(stints.list, '[]'::jsonb),
          -- Seasons managed in Top 100 Regen: time at Regen clubs over the average season length, to the nearest season.
          'regenSeasons', coalesce(round(stints.regen_days / nullif(v_regen_season_days, 0)), 0),
          'endorsements', coalesce((select jsonb_agg(jsonb_build_object('kind', endorsement.kind, 'note', endorsement.note,
                              'by', coalesce(manager.display_name, manager.name), 'at', endorsement.updated_at) order by endorsement.updated_at)
                            from public.waiting_list_endorsements endorsement
                            left join public.managers manager on manager.id = endorsement.by_manager_id
                            where endorsement.entry_id = entry.id), '[]'::jsonb)
        ) as row_json
        from public.waiting_list_entries entry
        left join lateral public.waiting_list_positions(entry.game_world_id) position on position.entry_id = entry.id
        left join lateral (
          select max(stint.sm_manager_id) filter (where stint.sm_manager_id is not null) as sm_manager_id,
            sum(extract(epoch from coalesce(stint.ended_at, now()) - stint.started_at) / 86400) filter (where stint.game_world_id = 2) as regen_days,
            jsonb_agg(jsonb_build_object('world', stint.game_world_id, 'club', stint.club_name, 'from', stint.started_at, 'to', stint.ended_at, 'games', stint.games)
                      order by stint.started_at) as list
          from public.soccer_manager_manager_stints stint
          where lower(btrim(stint.manager_name)) = lower(btrim(entry.sm_manager_name))
             or (entry.sm_manager_id is not null and stint.sm_manager_id = entry.sm_manager_id)
        ) stints on true
        left join lateral (
          select snapshot.gold, snapshot.game_worlds
          from public.manager_signal_snapshots snapshot
          where snapshot.sm_manager_id = coalesce(entry.sm_manager_id, stints.sm_manager_id)
          order by snapshot.captured_at desc limit 1
        ) signal on true
        where entry.game_world_id = v_world
      ) sub), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.waiting_list_admin(text) from public, anon;
grant execute on function public.waiting_list_admin(text) to authenticated;
