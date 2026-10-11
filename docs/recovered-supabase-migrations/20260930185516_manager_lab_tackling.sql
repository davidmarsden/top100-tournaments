create or replace function public.manager_lab_tackling(target_setup_id text default '239138')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world_id bigint;
  result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;

  select id into v_world_id
  from public.game_worlds
  where external_world_id::text = target_setup_id
  order by id
  limit 1;

  if v_world_id is null then
    raise exception 'No archived Soccer Manager world %', target_setup_id;
  end if;

  with latest as (
    select distinct on (source_fixture_id) *
    from public.soccer_manager_match_snapshots
    where game_world_id = v_world_id
      and competition_name in ('Division 1','Division 2','Division 3','Division 4','Division 5')
    order by source_fixture_id, source_version desc
  ), enriched as (
    select s.*,
      coalesce((
        select jsonb_agg(jsonb_build_object('teamSide', p.player->>'teamSide'))
        from jsonb_array_elements(coalesce(s.source_data->'keyEvents','[]')) e(event)
        left join lateral (
          select player
          from jsonb_array_elements(coalesce(s.source_data->'players','[]')) player
          where player->>'playerId' = e.event->>'playerId'
          limit 1
        ) p on true
        where lower(coalesce(e.event->>'type','')) = 'red'
      ), '[]'::jsonb) as red_cards
    from latest s
  ), team_matches as (
    select
      s.source_fixture_id as fixture_id,
      coalesce(s.source_data->'fixture'->>'date', s.source_data->>'turnDate') as match_date,
      s.competition_name as competition,
      'h'::text as side,
      s.home_source_club_id::text as club_id,
      s.home_name as club,
      s.away_source_club_id::text as opponent_id,
      s.away_name as opponent,
      coalesce(s.home_score,0) as goals_for,
      coalesce(s.away_score,0) as goals_against,
      (select count(*) from jsonb_array_elements(s.red_cards) c where c->>'teamSide'='h')::int as red_cards,
      (select case when count(*)=11 and count(nullif(player->>'overallRating',''))=11 then round(avg((player->>'overallRating')::numeric),2) end
       from (select player from jsonb_array_elements(coalesce(s.source_data->'players','[]')) with ordinality p(player,n) where player->>'teamSide'='h' order by n limit 11) q) as xi_rating,
      (select case when count(*)=11 and count(nullif(player->>'overallRating',''))=11 then round(avg((player->>'overallRating')::numeric),2) end
       from (select player from jsonb_array_elements(coalesce(s.source_data->'players','[]')) with ordinality p(player,n) where player->>'teamSide'='a' order by n limit 11) q) as opponent_xi_rating,
      s.source_data->'tactics'->'home' as tactics
    from enriched s
    union all
    select
      s.source_fixture_id,
      coalesce(s.source_data->'fixture'->>'date', s.source_data->>'turnDate'),
      s.competition_name,
      'a'::text,
      s.away_source_club_id::text,
      s.away_name,
      s.home_source_club_id::text,
      s.home_name,
      coalesce(s.away_score,0),
      coalesce(s.home_score,0),
      (select count(*) from jsonb_array_elements(s.red_cards) c where c->>'teamSide'='a')::int,
      (select case when count(*)=11 and count(nullif(player->>'overallRating',''))=11 then round(avg((player->>'overallRating')::numeric),2) end
       from (select player from jsonb_array_elements(coalesce(s.source_data->'players','[]')) with ordinality p(player,n) where player->>'teamSide'='a' order by n limit 11) q),
      (select case when count(*)=11 and count(nullif(player->>'overallRating',''))=11 then round(avg((player->>'overallRating')::numeric),2) end
       from (select player from jsonb_array_elements(coalesce(s.source_data->'players','[]')) with ordinality p(player,n) where player->>'teamSide'='h' order by n limit 11) q),
      s.source_data->'tactics'->'away'
    from enriched s
  ), normalized as (
    select
      t.*,
      coalesce(nullif(t.tactics->'instructions'->'aggression'->>0,''), nullif(t.tactics->>'aggression','')) as tackling,
      coalesce(nullif(t.tactics->'instructions'->'pressing'->>0,''), nullif(t.tactics->>'pressing','')) as pressing
    from team_matches t
  )
  select jsonb_build_object(
    'matches', coalesce(jsonb_agg(jsonb_build_object(
      'fixtureId', fixture_id,
      'date', match_date,
      'competition', competition,
      'side', side,
      'clubId', club_id,
      'club', club,
      'opponentId', opponent_id,
      'opponent', opponent,
      'goalsFor', goals_for,
      'goalsAgainst', goals_against,
      'redCards', red_cards,
      'xiRating', xi_rating,
      'opponentXiRating', opponent_xi_rating,
      'tackling', tackling,
      'pressing', pressing
    ) order by match_date, fixture_id, side) filter (where tackling is not null), '[]'::jsonb)
  ) into result
  from normalized;

  return result;
end;
$$;

revoke all on function public.manager_lab_tackling(text) from public, anon;
grant execute on function public.manager_lab_tackling(text) to authenticated, service_role;