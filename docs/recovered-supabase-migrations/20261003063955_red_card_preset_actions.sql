-- Expose the archived action evidence separately from the red-card outcome RPC.
-- Substitutions are match events captured from SubsOn/SubsOff/subTime. Tactic
-- actions are the pre-programmed action payload captured with the match replay.
create or replace function public.manager_lab_preset_actions(target_setup_id text default '239138')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_world_id bigint; result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Global admin access required'; end if;
  select id into v_world_id from public.game_worlds where external_world_id::text=target_setup_id order by id limit 1;
  if v_world_id is null then raise exception 'No archived Soccer Manager world %',target_setup_id; end if;
  with latest as (
    select distinct on(source_fixture_id) *
    from public.soccer_manager_match_snapshots
    where game_world_id=v_world_id
      and competition_name in('Division 1','Division 2','Division 3','Division 4','Division 5')
    order by source_fixture_id,source_version desc
  )
  select jsonb_build_object('matches',coalesce(jsonb_agg(jsonb_build_object(
    'fixtureId',source_fixture_id,
    'substitutions',source_data->'substitutions',
    'homeActionTimeline',coalesce(nullif(source_data->'tactics'->'home'->'actionTimeline','null'::jsonb),nullif(source_data->'matchReport'->'fullFidelity'->'tacticActions'->'home','null'::jsonb)),
    'awayActionTimeline',coalesce(nullif(source_data->'tactics'->'away'->'actionTimeline','null'::jsonb),nullif(source_data->'matchReport'->'fullFidelity'->'tacticActions'->'away','null'::jsonb))
  ) order by source_fixture_id),'[]'::jsonb)) into result from latest;
  return result;
end; $$;
revoke all on function public.manager_lab_preset_actions(text) from public,anon;
grant execute on function public.manager_lab_preset_actions(text) to authenticated,service_role;