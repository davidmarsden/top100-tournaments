create or replace function public.manager_lab_red_card_controls(target_setup_id text default '239138')
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
), eligible as (
 select s.*,
 (select count(*) from jsonb_array_elements(coalesce(s.source_data->'keyEvents','[]')) e where lower(e->>'type')='red') red_count,
 (select count(*) from jsonb_array_elements(coalesce(s.source_data->'keyEvents','[]')) e where lower(e->>'type')='goal') goals,
 (select count(*) from jsonb_array_elements(coalesce(s.source_data->'keyEvents','[]')) e where lower(e->>'type')='goal' and nullif(regexp_replace(coalesce(e->>'minute',e->>'time',''),'[^0-9]','','g'),'') is not null) timed_goals,
 (select count(*) from jsonb_array_elements(coalesce(s.source_data->'keyEvents','[]')) e where lower(e->>'type')='goal' and e->>'clubSide' in('h','a')) attributed_goals
 from latest s
), enriched as (
 select e.*,xi.home_xi,xi.away_xi,
 coalesce((select jsonb_agg(jsonb_build_object('side',g.event->>'clubSide','minute',nullif(regexp_replace(coalesce(g.event->>'minute',g.event->>'time',''),'[^0-9]','','g'),'')::int,'sequence',coalesce(nullif(g.event->>'sequence','')::int,g.n::int-1)) order by g.n)
 from jsonb_array_elements(coalesce(e.source_data->'keyEvents','[]')) with ordinality g(event,n) where lower(g.event->>'type')='goal'),'[]') goal_events
 from eligible e left join lateral(
 select
 (select case when count(*)=11 and count(nullif(player->>'overallRating',''))=11 then round(avg((player->>'overallRating')::numeric),2) end from(select player from jsonb_array_elements(e.source_data->'players') with ordinality p(player,n) where player->>'teamSide'='h' order by n limit 11)q) home_xi,
 (select case when count(*)=11 and count(nullif(player->>'overallRating',''))=11 then round(avg((player->>'overallRating')::numeric),2) end from(select player from jsonb_array_elements(e.source_data->'players') with ordinality p(player,n) where player->>'teamSide'='a' order by n limit 11)q) away_xi
 )xi on true
)
select jsonb_build_object('matches',coalesce(jsonb_agg(jsonb_build_object('fixtureId',source_fixture_id,'competition',competition_name,'homeScore',home_score,'awayScore',away_score,'homeXiRating',home_xi,'awayXiRating',away_xi,'goalEvents',goal_events)),'[]')) into result
from enriched where red_count=0 and goals=timed_goals and goals=attributed_goals and goals=coalesce(home_score,0)+coalesce(away_score,0) and home_xi is not null and away_xi is not null;
return result; end; $$;
revoke all on function public.manager_lab_red_card_controls(text) from public,anon;
grant execute on function public.manager_lab_red_card_controls(text) to authenticated,service_role;