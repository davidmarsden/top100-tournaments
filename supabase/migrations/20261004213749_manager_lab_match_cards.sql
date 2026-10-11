create or replace function public.manager_lab_match_cards(target_setup_id text default '239138')
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
  select id into v_world_id from public.game_worlds where external_world_id::text=target_setup_id order by id limit 1;
  if v_world_id is null then raise exception 'No archived Soccer Manager world %', target_setup_id; end if;

  with latest as (
    select distinct on (source_fixture_id) * from public.soccer_manager_match_snapshots
    where game_world_id=v_world_id
    order by source_fixture_id,source_version desc
  ), enriched as (
    select s.*,coalesce((select jsonb_agg(jsonb_build_object('teamSide',p.player->>'teamSide'))
      from jsonb_array_elements(coalesce(s.source_data->'keyEvents','[]')) e(event)
      left join lateral (select player from jsonb_array_elements(coalesce(s.source_data->'players','[]')) player where player->>'playerId'=e.event->>'playerId' limit 1) p on true
      where lower(coalesce(e.event->>'type',''))='red'),'[]'::jsonb) red_cards from latest s
  ), team_matches as (
    select s.source_fixture_id fixture_id,coalesce(s.source_data->'fixture'->>'date',s.source_data->>'turnDate') match_date,s.competition_name competition,'h'::text side,
      s.home_source_club_id::text club_id,s.home_name club,s.away_source_club_id::text opponent_id,s.away_name opponent,coalesce(s.home_score,0) goals_for,coalesce(s.away_score,0) goals_against,
      (select count(*) from jsonb_array_elements(s.red_cards)c where c->>'teamSide'='h')::int red_cards,
      (select case when count(*)=11 and count(nullif(player->>'overallRating',''))=11 then round(avg((player->>'overallRating')::numeric),2) end from (select player from jsonb_array_elements(coalesce(s.source_data->'players','[]')) with ordinality p(player,n) where player->>'teamSide'='h' order by n limit 11)q) xi_rating,
      (select case when count(*)=11 and count(nullif(player->>'overallRating',''))=11 then round(avg((player->>'overallRating')::numeric),2) end from (select player from jsonb_array_elements(coalesce(s.source_data->'players','[]')) with ordinality p(player,n) where player->>'teamSide'='a' order by n limit 11)q) opponent_xi_rating,
      s.source_data->'tactics'->'home' tactics from enriched s
    union all
    select s.source_fixture_id,coalesce(s.source_data->'fixture'->>'date',s.source_data->>'turnDate'),s.competition_name,'a'::text,s.away_source_club_id::text,s.away_name,s.home_source_club_id::text,s.home_name,coalesce(s.away_score,0),coalesce(s.home_score,0),
      (select count(*) from jsonb_array_elements(s.red_cards)c where c->>'teamSide'='a')::int,
      (select case when count(*)=11 and count(nullif(player->>'overallRating',''))=11 then round(avg((player->>'overallRating')::numeric),2) end from (select player from jsonb_array_elements(coalesce(s.source_data->'players','[]')) with ordinality p(player,n) where player->>'teamSide'='a' order by n limit 11)q),
      (select case when count(*)=11 and count(nullif(player->>'overallRating',''))=11 then round(avg((player->>'overallRating')::numeric),2) end from (select player from jsonb_array_elements(coalesce(s.source_data->'players','[]')) with ordinality p(player,n) where player->>'teamSide'='h' order by n limit 11)q),
      s.source_data->'tactics'->'away' from enriched s
  ), normalized as (
    select t.*,
      coalesce(nullif(tactics->'instructions'->'aggression'->>0,''),nullif(tactics->>'aggression','')) tackling,
      coalesce(nullif(tactics->'instructions'->'pressing'->>0,''),nullif(tactics->>'pressing','')) pressing,
      coalesce(nullif(tactics->'formationNames'->>0,''),nullif(tactics->>'formation',''),nullif(tactics->'instructions'->'formation'->>0,'')) formation,
      coalesce(nullif(tactics->'instructions'->'mentality'->>0,''),nullif(tactics->>'mentality','')) mentality,
      coalesce(nullif(tactics->'instructions'->'passing'->>0,''),nullif(tactics->>'passing','')) passing,
      coalesce(nullif(tactics->'instructions'->'tempo'->>0,''),nullif(tactics->>'tempo','')) tempo,
      coalesce(nullif(tactics->'instructions'->'attackingStyle'->>0,''),nullif(tactics->>'attackingStyle',''),nullif(tactics->'instructions'->'style'->>0,''),nullif(tactics->>'style','')) attacking_style,
      coalesce(tactics->'instructions'->'counterAttack'->0,tactics->'counterAttack') counter_attack,
      coalesce(tactics->'instructions'->'menBehindBall'->0,tactics->'menBehindBall') men_behind_ball
    from team_matches t
  )
  select jsonb_build_object('matches',coalesce(jsonb_agg(jsonb_build_object(
    'fixtureId',fixture_id,'date',match_date,'competition',competition,'side',side,'clubId',club_id,'club',club,'opponentId',opponent_id,'opponent',opponent,
    'goalsFor',goals_for,'goalsAgainst',goals_against,'redCards',red_cards,'xiRating',xi_rating,'opponentXiRating',opponent_xi_rating,'tackling',tackling,'pressing',pressing,
    'formation',formation,'mentality',mentality,'passing',passing,'tempo',tempo,'attackingStyle',attacking_style,'counterAttack',counter_attack,'menBehindBall',men_behind_ball
  ) order by match_date,fixture_id,side) filter(where tackling is not null),'[]'::jsonb)) into result from normalized;
  return result;
end;$$;
revoke all on function public.manager_lab_match_cards(text) from public,anon;
grant execute on function public.manager_lab_match_cards(text) to authenticated,service_role;