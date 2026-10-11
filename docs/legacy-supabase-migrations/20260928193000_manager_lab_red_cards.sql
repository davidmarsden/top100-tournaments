create or replace function public.manager_lab_red_cards(target_setup_id text default '239138')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world_id bigint;
  result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Global admin access required'; end if;
  if target_setup_id is null or target_setup_id !~ '^[0-9]+$' then raise exception 'Soccer Manager setup id must be numeric'; end if;
  select id into v_world_id from public.game_worlds where external_world_id::text=target_setup_id order by id limit 1;
  if v_world_id is null then raise exception 'No archived Soccer Manager world %', target_setup_id; end if;

  with latest as (
    select distinct on (s.source_fixture_id) s.*
    from public.soccer_manager_match_snapshots s
    where s.game_world_id=v_world_id
      and s.competition_name in ('Division 1','Division 2','Division 3','Division 4','Division 5')
    order by s.source_fixture_id,s.source_version desc
  ), cards as (
    select s.*,
      coalesce((select jsonb_agg(jsonb_build_object(
        'teamSide', p.player->>'teamSide',
        'playerId', e.event->>'playerId',
        'playerName', p.player->>'name',
        'minute', nullif(regexp_replace(coalesce(e.event->>'minute',e.event->>'time',''),'[^0-9]','','g'),'')::integer
      ))
      from jsonb_array_elements(coalesce(s.source_data->'keyEvents','[]'::jsonb)) e(event)
      left join lateral (
        select player from jsonb_array_elements(coalesce(s.source_data->'players','[]'::jsonb)) player
        where player->>'playerId'=e.event->>'playerId' limit 1
      ) p on true
      where lower(coalesce(e.event->>'type',''))='red'),'[]'::jsonb) red_cards
    from latest s
  ), rows as (
    select *, jsonb_array_length(red_cards) red_count,
      (select count(*) from jsonb_array_elements(red_cards) c where c->>'teamSide'='h') home_reds,
      (select count(*) from jsonb_array_elements(red_cards) c where c->>'teamSide'='a') away_reds
    from cards
  )
  select jsonb_build_object(
    'matches', coalesce(jsonb_agg(jsonb_build_object(
      'fixtureId',source_fixture_id,
      'date',coalesce(source_data->'fixture'->>'date',source_data->>'turnDate'),
      'competition',competition_name,
      'homeClubId',home_source_club_id,'awayClubId',away_source_club_id,
      'home',home_name,'away',away_name,'homeScore',home_score,'awayScore',away_score,
      'homeReds',home_reds,'awayReds',away_reds,'redCards',red_cards,
      'homeXiRating',nullif(source_data->'stats'->>'homeXiRating','')::numeric,
      'awayXiRating',nullif(source_data->'stats'->>'awayXiRating','')::numeric
    ) order by coalesce(source_data->'fixture'->>'date',source_data->>'turnDate'),source_fixture_id),'[]'::jsonb)
  ) into result
  from rows where red_count>0;
  return result;
end;
$$;
revoke all on function public.manager_lab_red_cards(text) from public,anon;
grant execute on function public.manager_lab_red_cards(text) to authenticated,service_role;