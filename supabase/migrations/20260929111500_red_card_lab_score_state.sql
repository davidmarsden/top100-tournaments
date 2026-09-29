create or replace function public.manager_lab_red_cards(target_setup_id text default '239138')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_world_id bigint; result jsonb;
begin
if auth.uid() is null or not public.is_admin() then raise exception 'Global admin access required'; end if;
select id into v_world_id from public.game_worlds where external_world_id::text=target_setup_id order by id limit 1;
if v_world_id is null then raise exception 'No archived Soccer Manager world %',target_setup_id; end if;
with latest as (
 select distinct on(source_fixture_id) * from public.soccer_manager_match_snapshots
 where game_world_id=v_world_id and competition_name in('Division 1','Division 2','Division 3','Division 4','Division 5')
 order by source_fixture_id,source_version desc
), base as (
 select s.*,
 coalesce((select jsonb_agg(jsonb_build_object('teamSide',p.player->>'teamSide','playerId',e.event->>'playerId','playerName',p.player->>'name','minute',nullif(regexp_replace(coalesce(e.event->>'minute',e.event->>'time',''),'[^0-9]','','g'),'')::int,'sequence',coalesce(nullif(e.event->>'sequence','')::int,e.n::int-1)) order by coalesce(nullif(e.event->>'sequence','')::int,e.n::int-1))
 from jsonb_array_elements(coalesce(s.source_data->'keyEvents','[]')) with ordinality e(event,n)
 left join lateral(select player from jsonb_array_elements(coalesce(s.source_data->'players','[]')) player where player->>'playerId'=e.event->>'playerId' limit 1)p on true
 where lower(coalesce(e.event->>'type',''))='red'),'[]') red_cards,
 (select count(*) from jsonb_array_elements(coalesce(s.source_data->'keyEvents','[]')) e where lower(e->>'type')='goal') goals,
 (select count(*) from jsonb_array_elements(coalesce(s.source_data->'keyEvents','[]')) e where lower(e->>'type')='goal' and nullif(regexp_replace(coalesce(e->>'minute',e->>'time',''),'[^0-9]','','g'),'') is not null) timed_goals
 from latest s
), facts as (
 select b.*,jsonb_array_length(red_cards) red_count,
 (select count(*) from jsonb_array_elements(red_cards)c where c->>'teamSide'='h') home_reds,
 (select count(*) from jsonb_array_elements(red_cards)c where c->>'teamSide'='a') away_reds,
 (select (c->>'minute')::int from jsonb_array_elements(red_cards)c where c->>'minute' is not null order by (c->>'minute')::int,coalesce((c->>'sequence')::int,0) limit 1) first_red_minute,
 (select c->>'teamSide' from jsonb_array_elements(red_cards)c where c->>'minute' is not null order by (c->>'minute')::int,coalesce((c->>'sequence')::int,0) limit 1) first_red_side
 from base b
), enriched as (
 select f.*,xi.home_xi,xi.away_xi,
 case when goals=timed_goals and first_red_minute is not null then
 (select count(*) from jsonb_array_elements(coalesce(f.source_data->'keyEvents','[]'))g where lower(g->>'type')='goal' and g->>'clubSide'='h' and nullif(regexp_replace(coalesce(g->>'minute',g->>'time',''),'[^0-9]','','g'),'')::int<first_red_minute) end home_at_red,
 case when goals=timed_goals and first_red_minute is not null then
 (select count(*) from jsonb_array_elements(coalesce(f.source_data->'keyEvents','[]'))g where lower(g->>'type')='goal' and g->>'clubSide'='a' and nullif(regexp_replace(coalesce(g->>'minute',g->>'time',''),'[^0-9]','','g'),'')::int<first_red_minute) end away_at_red
 from facts f left join lateral(
 select
 (select round(avg((player->>'overallRating')::numeric),2) from(select player from jsonb_array_elements(f.source_data->'players') with ordinality p(player,n) where player->>'teamSide'='h' and nullif(player->>'overallRating','') is not null order by n limit 11)q)home_xi,
 (select round(avg((player->>'overallRating')::numeric),2) from(select player from jsonb_array_elements(f.source_data->'players') with ordinality p(player,n) where player->>'teamSide'='a' and nullif(player->>'overallRating','') is not null order by n limit 11)q)away_xi
 )xi on true
)
select jsonb_build_object('matches',coalesce(jsonb_agg(jsonb_build_object(
'fixtureId',source_fixture_id,'date',coalesce(source_data->'fixture'->>'date',source_data->>'turnDate'),'competition',competition_name,
'homeClubId',home_source_club_id,'awayClubId',away_source_club_id,'home',home_name,'away',away_name,'homeScore',home_score,'awayScore',away_score,
'homeReds',home_reds,'awayReds',away_reds,'redCards',red_cards,'firstRedMinute',first_red_minute,'firstRedSide',first_red_side,
'homeScoreAtFirstRed',home_at_red,'awayScoreAtFirstRed',away_at_red,'scoreAtFirstRedReliable',(goals=timed_goals and first_red_minute is not null),
'homeXiRating',home_xi,'awayXiRating',away_xi,'dismissedXiGap',case when home_xi is null or away_xi is null then null when first_red_side='h' then round(home_xi-away_xi,2) when first_red_side='a' then round(away_xi-home_xi,2) end,
'homeTactics',source_data->'tactics'->'home','awayTactics',source_data->'tactics'->'away'
) order by coalesce(source_data->'fixture'->>'date',source_data->>'turnDate'),source_fixture_id),'[]')) into result from enriched where red_count>0;
return result; end; $$;
revoke all on function public.manager_lab_red_cards(text) from public,anon;
grant execute on function public.manager_lab_red_cards(text) to authenticated,service_role;