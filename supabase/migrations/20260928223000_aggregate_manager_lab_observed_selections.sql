create or replace function public.manager_lab_observed_selections(target_setup_id text default '239138')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_world_id bigint; result jsonb;
begin
if auth.uid() is null or not public.is_admin() then raise exception 'Global admin access required'; end if;
if target_setup_id is null or target_setup_id !~ '^[0-9]+$' then raise exception 'Soccer Manager setup id must be numeric'; end if;
select id into v_world_id from public.game_worlds where external_world_id::text=target_setup_id order by id limit 1;
if v_world_id is null then raise exception 'No archived Soccer Manager world %',target_setup_id; end if;
with latest as (
 select distinct on(s.source_fixture_id) s.* from public.soccer_manager_match_snapshots s where s.game_world_id=v_world_id and s.competition_name='Division 1' order by s.source_fixture_id,s.source_version desc
), appearances as (
 select s.source_fixture_id fixture_id,coalesce(s.source_data->'fixture'->>'date',s.source_data->>'turnDate') match_date,
 case when e.player->>'teamSide'='h' then s.home_source_club_id else s.away_source_club_id end source_club_id,
 case when e.player->>'teamSide'='h' then s.home_name else s.away_name end club_name,
 e.player->>'playerDataId' source_player_id,e.player->>'playerId' match_player_id,e.player->>'name' observed_name,
 nullif(e.player->>'overallRating','')::numeric observed_rating,nullif(e.player->>'matchRating','')::numeric match_rating,e.player->>'positionDescription' position_description,
 row_number() over(partition by s.source_fixture_id,e.player->>'teamSide' order by e.n)<=11 is_starter
 from latest s cross join lateral jsonb_array_elements(coalesce(s.source_data->'players','[]'::jsonb)) with ordinality e(player,n)
 where nullif(e.player->>'playerDataId','') is not null
), usage as (
 select source_club_id,source_player_id,count(*)::integer squad_selections,count(*) filter(where is_starter)::integer starts,max(match_date) last_date
 from appearances group by 1,2
), recent as (
 select distinct on(source_club_id,source_player_id) * from appearances
 order by source_club_id,source_player_id,match_date desc nulls last,fixture_id desc
), club_matches as (
 select source_club_id,count(distinct fixture_id)::integer observed_matches from appearances group by 1
), observed as (
 select r.fixture_id,r.match_date,'Division 1'::text competition,r.source_club_id,r.club_name,0 side_order,r.is_starter,
 r.source_player_id,r.match_player_id,r.observed_name,r.observed_rating,r.match_rating,r.position_description,
 u.starts,u.squad_selections,u.last_date
 from usage u join recent r using(source_club_id,source_player_id)
), joined as (
 select o.*,p.name current_name,p.rating current_rating,p.main_position,p.age,p.average_performance,p.career_appearances,p.career_average_performance,p.rating_change
 from observed o left join public.soccer_manager_players p on p.game_world_id=v_world_id and p.source_player_id=o.source_player_id
), club_counts as (
 select source_club_id,observed_matches from club_matches
)
select jsonb_build_object(
 'usage',coalesce(jsonb_agg(jsonb_build_object(
  'fixtureId',fixture_id,'date',match_date,'competition',competition,'sourceClubId',source_club_id,'club',club_name,'starter',is_starter,
  'sourcePlayerId',source_player_id,'matchPlayerId',match_player_id,'observedName',observed_name,'observedRating',observed_rating,'matchRating',match_rating,
  'positionDescription',position_description,'currentName',current_name,'currentRating',current_rating,'mainPosition',main_position,'age',age,
  'averagePerformance',average_performance,'careerAppearances',career_appearances,'careerAveragePerformance',career_average_performance,'ratingChange',rating_change,
  'starts',starts,'squadSelections',squad_selections,'lastDate',last_date
 ) order by source_club_id,starts desc,last_date desc),'[]'::jsonb),
 'clubMatchCounts',coalesce((select jsonb_agg(jsonb_build_object('sourceClubId',source_club_id,'observedMatches',observed_matches) order by source_club_id) from club_counts),'[]'::jsonb)
) into result from joined;
return result; end; $$;
revoke all on function public.manager_lab_observed_selections(text) from public,anon;
grant execute on function public.manager_lab_observed_selections(text) to authenticated,service_role;