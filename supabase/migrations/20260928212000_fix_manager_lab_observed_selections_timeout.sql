create or replace function public.manager_lab_observed_selections(target_setup_id text default '239138')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_world_id bigint; result jsonb;
begin
if auth.uid() is null or not public.is_admin() then raise exception 'Global admin access required'; end if;
if target_setup_id is null or target_setup_id !~ '^[0-9]+$' then raise exception 'Soccer Manager setup id must be numeric'; end if;
select id into v_world_id from public.game_worlds where external_world_id::text=target_setup_id order by id limit 1;
if v_world_id is null then raise exception 'No archived Soccer Manager world %',target_setup_id; end if;
with latest as (
 select distinct on(s.source_fixture_id) s.* from public.soccer_manager_match_snapshots s where s.game_world_id=v_world_id and s.competition_name in ('Division 1','Division 2','Division 3','Division 4','Division 5') order by s.source_fixture_id,s.source_version desc
), observed as (
 select s.source_fixture_id fixture_id,coalesce(s.source_data->'fixture'->>'date',s.source_data->>'turnDate') match_date,s.competition_name competition,
 case when e.player->>'teamSide'='h' then s.home_source_club_id else s.away_source_club_id end source_club_id,
 case when e.player->>'teamSide'='h' then s.home_name else s.away_name end club_name,e.n::integer side_order,true is_starter,
 e.player->>'playerDataId' source_player_id,e.player->>'playerId' match_player_id,e.player->>'name' observed_name,
 nullif(e.player->>'overallRating','')::numeric observed_rating,nullif(e.player->>'matchRating','')::numeric match_rating,e.player->>'positionDescription' position_description
 from latest s cross join lateral (
  select q.player,q.n from (
   select x.player,x.n,row_number() over(partition by x.player->>'teamSide' order by x.n) side_n
   from jsonb_array_elements(coalesce(s.source_data->'players','[]'::jsonb)) with ordinality x(player,n)
  ) q where q.side_n<=11
 ) e
), joined as (
 select o.*,p.name current_name,p.rating current_rating,p.main_position,p.age,p.average_performance,p.career_appearances,p.career_average_performance,p.rating_change
 from observed o left join public.soccer_manager_players p on p.game_world_id=v_world_id and p.source_player_id=o.source_player_id
)
select jsonb_build_object('selections',coalesce(jsonb_agg(jsonb_build_object(
 'fixtureId',fixture_id,'date',match_date,'competition',competition,'sourceClubId',source_club_id,'club',club_name,'starter',is_starter,
 'sourcePlayerId',source_player_id,'matchPlayerId',match_player_id,'observedName',observed_name,'observedRating',observed_rating,'matchRating',match_rating,
 'positionDescription',position_description,'currentName',current_name,'currentRating',current_rating,'mainPosition',main_position,'age',age,
 'averagePerformance',average_performance,'careerAppearances',career_appearances,'careerAveragePerformance',career_average_performance,'ratingChange',rating_change
) order by match_date,fixture_id,source_club_id,side_order),'[]'::jsonb)) into result from joined;
return result; end; $$;
revoke all on function public.manager_lab_observed_selections(text) from public,anon;
grant execute on function public.manager_lab_observed_selections(text) to authenticated,service_role;