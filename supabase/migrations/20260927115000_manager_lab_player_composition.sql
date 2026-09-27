-- Add archived match-day player composition to Formula Lab observations.
-- This deliberately reports the players present in the match report, not a
-- transfer-value or potential model. Preferred-role metadata is not archived.

create or replace function public.manager_lab_formula_matches(target_setup_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_id text := nullif(trim(target_setup_id), '');
  v_world_id bigint;
  result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Global admin access required'; end if;
  if setup_id is null or setup_id !~ '^[0-9]+$' then raise exception 'Soccer Manager setup id must be numeric'; end if;

  select id into v_world_id
  from public.game_worlds
  where external_world_id = setup_id::bigint
  order by id limit 1;
  if v_world_id is null then raise exception 'No archived Soccer Manager world %', setup_id; end if;

  with latest as (
    select distinct on (s.source_fixture_id) s.*
    from public.soccer_manager_match_snapshots s
    where s.game_world_id = v_world_id
      and s.competition_name in ('Division 1','Division 2','Division 3','Division 4','Division 5')
    order by s.source_fixture_id, s.source_version desc
  ), dated as (
    select s.*, coalesce(s.source_data->'fixture'->>'date', s.source_data->>'turnDate')::date match_date
    from latest s
  ), perspectives as (
    select s.*, side.side,
      case when side.side = 'h' then s.home_source_club_id else s.away_source_club_id end source_club_id,
      case when side.side = 'h' then s.home_name else s.away_name end club_name,
      case when side.side = 'h' then s.away_name else s.home_name end opponent_name,
      case when side.side = 'h' then s.home_score else s.away_score end goals_for,
      case when side.side = 'h' then s.away_score else s.home_score end goals_against,
      case when side.side = 'h' then s.source_data->'tactics'->'home' else s.source_data->'tactics'->'away' end tactics
    from dated s cross join (values ('h'),('a')) side(side)
  ), enriched as (
    select p.*,
      xi.our_xi, xi.opp_xi,
      case when xi.our_xi is not null and xi.opp_xi is not null then round(xi.our_xi-xi.opp_xi,2) end xi_diff,
      squad.player_count, squad.age_count, squad.rating_count, squad.avg_age, squad.avg_rating, squad.young_count, squad.veteran_count,
      opp_squad.player_count opp_player_count, opp_squad.age_count opp_age_count, opp_squad.rating_count opp_rating_count, opp_squad.avg_age opp_avg_age,
      opp_squad.avg_rating opp_avg_rating, opp_squad.young_count opp_young_count,
      opp_squad.veteran_count opp_veteran_count
    from perspectives p
    left join lateral (
      select
        (select round(avg((player->>'overallRating')::numeric),2)
         from (select player from jsonb_array_elements(p.source_data->'players') with ordinality e(player,n)
               where player->>'teamSide'=p.side and nullif(player->>'overallRating','') is not null order by n limit 11) q) our_xi,
        (select round(avg((player->>'overallRating')::numeric),2)
         from (select player from jsonb_array_elements(p.source_data->'players') with ordinality e(player,n)
               where player->>'teamSide'=case when p.side='h' then 'a' else 'h' end
                 and nullif(player->>'overallRating','') is not null order by n limit 11) q) opp_xi
    ) xi on true
    left join lateral (
      select count(*)::integer player_count,
        count(*) filter (where nullif(player->>'age','')::numeric between 15 and 50)::integer age_count,
        count(nullif(player->>'overallRating',''))::integer rating_count,
        round(avg(nullif(player->>'age','')::numeric) filter (where nullif(player->>'age','')::numeric between 15 and 50),2) avg_age,
        round(avg(nullif(player->>'overallRating','')::numeric),2) avg_rating,
        count(*) filter (where nullif(player->>'age','')::numeric between 15 and 21)::integer young_count,
        count(*) filter (where nullif(player->>'age','')::numeric between 30 and 50)::integer veteran_count
      from jsonb_array_elements(coalesce(p.source_data->'players','[]'::jsonb)) e(player)
      where player->>'teamSide'=p.side
    ) squad on true
    left join lateral (
      select count(*)::integer player_count,
        count(*) filter (where nullif(player->>'age','')::numeric between 15 and 50)::integer age_count,
        count(nullif(player->>'overallRating',''))::integer rating_count,
        round(avg(nullif(player->>'age','')::numeric) filter (where nullif(player->>'age','')::numeric between 15 and 50),2) avg_age,
        round(avg(nullif(player->>'overallRating','')::numeric),2) avg_rating,
        count(*) filter (where nullif(player->>'age','')::numeric between 15 and 21)::integer young_count,
        count(*) filter (where nullif(player->>'age','')::numeric between 30 and 50)::integer veteran_count
      from jsonb_array_elements(coalesce(p.source_data->'players','[]'::jsonb)) e(player)
      where player->>'teamSide'=case when p.side='h' then 'a' else 'h' end
    ) opp_squad on true
  ), rows as (
    select
      source_fixture_id as "fixtureId",
      match_date as date,
      competition_name as competition,
      source_club_id as "sourceClubId",
      club_name as club,
      opponent_name as opponent,
      case when side='h' then 'H' else 'A' end venue,
      case when goals_for > goals_against then 'W' when goals_for = goals_against then 'D' else 'L' end result,
      goals_for as "goalsFor", goals_against as "goalsAgainst",
      our_xi as "ourXiRating", opp_xi as "opponentXiRating", xi_diff as "xiRatingDifference",
      player_count as "reportedPlayerCount", age_count as "reportedAgeCount",
      rating_count as "reportedRatingCount", avg_age as "reportedAvgAge",
      avg_rating as "reportedAvgRating", young_count as "reportedYoungCount",
      veteran_count as "reportedVeteranCount",
      opp_player_count as "opponentReportedPlayerCount", opp_age_count as "opponentReportedAgeCount",
      opp_rating_count as "opponentReportedRatingCount", opp_avg_age as "opponentReportedAvgAge",
      opp_avg_rating as "opponentReportedAvgRating", opp_young_count as "opponentReportedYoungCount",
      opp_veteran_count as "opponentReportedVeteranCount",
      tactics
    from enriched
  )
  select jsonb_build_object(
    'setupId', setup_id,
    'matches', coalesce(jsonb_agg(to_jsonb(rows) order by club, "fixtureId"), '[]'::jsonb)
  ) into result from rows;

  return result;
end;
$$;

revoke all on function public.manager_lab_formula_matches(text) from public, anon;
grant execute on function public.manager_lab_formula_matches(text) to authenticated, service_role;
