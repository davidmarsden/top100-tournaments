-- Market rates: finer rating bands near the top (90+, 89, 88, 87, 85-86, 80-84, 75-79, under 75) and
-- age bands that match how managers think about players (15-18, 19-21, 22-25, 26-30, 31+). The
-- rates table is now rating by age (price depends on both far more than on position); position
-- stays in the price check.

create or replace function public.sm_rating_band(p_rating integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_rating is null then null when p_rating >= 90 then '90+' when p_rating = 89 then '89'
    when p_rating = 88 then '88' when p_rating = 87 then '87' when p_rating >= 85 then '85-86'
    when p_rating >= 80 then '80-84' when p_rating >= 75 then '75-79' else 'under 75' end;
$$;

revoke all on function public.sm_rating_band(integer) from public, anon, authenticated;

create or replace function public.sm_age_band(p_age integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_age is null then null when p_age <= 18 then '15-18' when p_age <= 21 then '19-21'
    when p_age <= 25 then '22-25' when p_age <= 30 then '26-30' else '31+' end;
$$;

revoke all on function public.sm_age_band(integer) from public, anon, authenticated;

create or replace function public.get_market_rates(p_game_world_id bigint default null, p_days integer default 120)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.sm_market_world(p_game_world_id);
begin
  if v_world is null then return null; end if;

  return (
    with d as (select * from public.sm_market_deals(v_world, p_days)),
    managers as (select * from d where valued and seller_is_manager),
    computer as (select * from d where clean and not seller_is_manager),
    bands as (select band, ord from unnest(array['90+','89','88','87','85-86','80-84','75-79','under 75']) with ordinality b(band, ord))
    select jsonb_build_object(
      'worldId', v_world,
      'world', (select w.name from public.game_worlds w where w.id = v_world),
      'days', greatest(1, least(coalesce(p_days, 120), 3650)),
      'firstDeal', (select min(seen_at) from d),
      'lastDeal', (select max(seen_at) from d),
      'deals', (select count(*) from d),
      'excluded', jsonb_build_object(
        'linked', (select count(*) from d where linked),
        'unvalued', (select count(*) from d where not linked and not valued)
      ),
      -- Between managers: full value (cash + players back), and the usual package, by rating band.
      'managers', jsonb_build_object(
        'deals', (select count(*) from managers),
        'partExchangeShare', (select round(avg(part_exchange::int)::numeric, 2) from managers),
        'medianRatio', (select round(percentile_cont(0.5) within group (order by total_ratio)::numeric, 2) from managers),
        'bands', coalesce((
          select jsonb_agg(row order by ord) from (
            select b.ord, jsonb_build_object(
              'band', b.band,
              'n', count(m.*),
              'medianTotal', round(percentile_cont(0.5) within group (order by m.total_value)),
              'p25Total', round(percentile_cont(0.25) within group (order by m.total_value)),
              'p75Total', round(percentile_cont(0.75) within group (order by m.total_value)),
              'medianRatio', round((percentile_cont(0.5) within group (order by m.total_ratio))::numeric, 2),
              'partExchangeShare', round(avg(m.part_exchange::int)::numeric, 2),
              'playersBack', round(avg(m.players_back_count) filter (where m.part_exchange)::numeric, 1),
              'bestBackRating', round(percentile_cont(0.5) within group (order by m.best_back_rating) filter (where m.part_exchange)),
              'cashShare', round(avg((m.fee > 0)::int) filter (where m.part_exchange)::numeric, 2),
              'medianCash', round(percentile_cont(0.5) within group (order by m.fee) filter (where m.part_exchange))
            ) as row
            from bands b left join managers m on public.sm_rating_band(m.rating) = b.band
            group by b.ord, b.band
            having count(m.*) > 0
          ) x
        ), '[]'::jsonb),
        -- Rating by age: the median full value of each cell.
        'grid', coalesce((
          select jsonb_agg(jsonb_build_object('band', r.band, 'n', r.n, 'ages', r.ages) order by r.ord)
          from (
            select b.ord, b.band, count(*) as n, jsonb_agg(jsonb_build_object('band', cell.age_band, 'n', cell.n,
              'medianTotal', cell.median_total, 'medianRatio', cell.median_ratio)) as ages
            from bands b
            join (
              select public.sm_rating_band(rating) as band, public.sm_age_band(age) as age_band, count(*) as n,
                round(percentile_cont(0.5) within group (order by total_value)) as median_total,
                round((percentile_cont(0.5) within group (order by total_ratio))::numeric, 2) as median_ratio
              from managers group by 1, 2
            ) cell on cell.band = b.band
            group by b.ord, b.band
          ) r
        ), '[]'::jsonb)
      ),
      -- From computer clubs: cash, by rating and age.
      'computer', jsonb_build_object(
        'deals', (select count(*) from computer),
        'medianRatio', (select round(percentile_cont(0.5) within group (order by ratio)::numeric, 2) from computer),
        'grid', coalesce((
          select jsonb_agg(jsonb_build_object('band', r.band, 'n', r.n, 'ages', r.ages) order by r.ord)
          from (
            select b.ord, b.band, count(*) as n, jsonb_agg(jsonb_build_object('band', cell.age_band, 'n', cell.n,
              'medianFee', cell.median_fee, 'medianRatio', cell.median_ratio)) as ages
            from bands b
            join (
              select public.sm_rating_band(rating) as band, public.sm_age_band(age) as age_band, count(*) as n,
                round(percentile_cont(0.5) within group (order by fee)) as median_fee,
                round((percentile_cont(0.5) within group (order by ratio))::numeric, 2) as median_ratio
              from computer group by 1, 2
            ) cell on cell.band = b.band
            group by b.ord, b.band
          ) r
        ), '[]'::jsonb)
      ),
      'ages', coalesce((
        select jsonb_agg(jsonb_build_object('band', a.band, 'n', a.n, 'medianRatio', a.median_ratio)
          order by array_position(array['15-18','19-21','22-25','26-30','31+'], a.band))
        from (
          select public.sm_age_band(age) as band, count(*) as n,
            round((percentile_cont(0.5) within group (order by total_ratio))::numeric, 2) as median_ratio
          from managers group by 1
        ) a
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_market_rates(bigint, integer) from public, anon;
grant execute on function public.get_market_rates(bigint, integer) to authenticated;
