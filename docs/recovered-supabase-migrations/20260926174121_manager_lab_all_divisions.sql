-- World-wide league evidence for Manager Lab Formula Lab.
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
  ), perspectives as (
    select s.*, side.side,
      case when side.side = 'h' then s.home_source_club_id else s.away_source_club_id end source_club_id,
      case when side.side = 'h' then s.home_name else s.away_name end club_name,
      case when side.side = 'h' then s.away_name else s.home_name end opponent_name,
      case when side.side = 'h' then s.home_score else s.away_score end goals_for,
      case when side.side = 'h' then s.away_score else s.home_score end goals_against,
      case when side.side = 'h' then s.source_data->'tactics'->'home' else s.source_data->'tactics'->'away' end tactics
    from latest s cross join (values ('h'),('a')) side(side)
  ), enriched as (
    select p.*,
      xi.our_xi, xi.opp_xi,
      case when xi.our_xi is not null and xi.opp_xi is not null then round(xi.our_xi-xi.opp_xi,2) end xi_diff
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
  ), rows as (
    select
      source_fixture_id as "fixtureId",
      competition_name as competition,
      source_club_id as "sourceClubId",
      club_name as club,
      opponent_name as opponent,
      case when side='h' then 'H' else 'A' end venue,
      case when goals_for > goals_against then 'W' when goals_for = goals_against then 'D' else 'L' end result,
      goals_for as "goalsFor", goals_against as "goalsAgainst",
      our_xi as "ourXiRating", opp_xi as "opponentXiRating", xi_diff as "xiRatingDifference",
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
