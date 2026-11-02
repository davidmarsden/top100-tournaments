-- Market rates for the Manager Portal, from the completed transfers Sync captures
-- (soccer_manager_transfers, status 9).
--   * Each deal is grouped by position (from Soccer Manager's position string), age band and
--     rating band, and compared with the player's value at the time (fee / value).
--   * Multi-part deals are flagged and left out of the rates: part exchanges (players offered as
--     part of the deal) and deals linked to another one between the same two clubs in the same
--     turn and day (swaps, or a fee split across two transfers). Free and unvalued transfers are
--     left out too.
--   * get_market_rates(): median fee and fee/value per position and rating band, and per age band.
--   * market_price_check(): an estimated fee range for a player type (optionally from its value),
--     with the most similar recent clean deals and the matching players on the transfer list.
-- Both are for managers with a Portal account in that game world (and admins).

-- @permissions private public.sm_position_group(text): used only inside the market functions below.
create or replace function public.sm_position_group(p_position text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Roles before a bracket share it: "D,DM,M(L)" is D(L), DM(L), M(L). The first role and the
  -- first bracket name the player's main position.
  with parts as (
    select upper(coalesce(substring(trim(p_position) from '^([A-Za-z]+)'), '')) as role,
           upper(coalesce(substring(p_position from '\(([RLCrlc]+)\)'), '')) as sides,
           position(',' in coalesce(p_position, '')) > 0 as more_roles
  )
  select case
    when role = 'GK' then 'GK'
    when role = 'D' and sides like '%C%' and (sides = 'C' or not more_roles) then 'CB'
    when role = 'D' then 'FB'
    when role = 'DM' then 'DM'
    when role = 'M' and sides like '%C%' then 'CM'
    when role = 'M' then 'W'
    when role = 'AM' and sides like '%C%' then 'AM'
    when role = 'AM' then 'W'
    when role = 'F' and sides like '%C%' then 'ST'
    when role = 'F' then 'W'
  end
  from parts;
$$;

revoke all on function public.sm_position_group(text) from public, anon, authenticated;

-- @permissions private public.sm_market_deals(bigint, integer): used only inside the market functions below.
create or replace function public.sm_market_deals(p_world bigint, p_days integer default 120)
returns table (
  id bigint,
  player_name text,
  position_label text,
  position_group text,
  age integer,
  rating integer,
  player_value bigint,
  fee bigint,
  ratio numeric,
  from_club text,
  to_club text,
  seller_is_manager boolean,
  part_exchange boolean,
  linked boolean,
  clean boolean,
  seen_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with deals as (
    select t.*,
      (jsonb_typeof(t.player_offers) = 'array' and jsonb_array_length(t.player_offers) > 0) as px,
      exists (
        select 1 from public.soccer_manager_transfers o
        where o.game_world_id = t.game_world_id and o.status = 9 and o.id <> t.id
          and o.source_turn is not distinct from t.source_turn and o.accepted_date is not distinct from t.accepted_date
          -- Turn numbers and dates repeat each season: only deals seen within a few days of each other.
          and o.first_seen_at between t.first_seen_at - interval '3 days' and t.first_seen_at + interval '3 days'
          and ((o.from_source_club_id = t.to_source_club_id and o.to_source_club_id = t.from_source_club_id)
            or (o.from_source_club_id = t.from_source_club_id and o.to_source_club_id = t.to_source_club_id))
      ) as is_linked
    from public.soccer_manager_transfers t
    where t.game_world_id = p_world and t.status = 9
      and t.first_seen_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 120), 3650)))
  )
  select d.id, d.player_name, d.position, public.sm_position_group(d.position), d.age, d.rating, d.player_value, d.amount,
    case when d.player_value > 0 then round(d.amount::numeric / d.player_value, 3) end,
    d.from_club_name, d.to_club_name, d.from_manager_id is not null, d.px, d.is_linked,
    not d.px and not d.is_linked and coalesce(d.amount, 0) > 0 and coalesce(d.player_value, 0) > 0
      and d.age is not null and d.rating is not null and public.sm_position_group(d.position) is not null,
    d.first_seen_at
  from deals d;
$$;

revoke all on function public.sm_market_deals(bigint, integer) from public, anon, authenticated;

-- The game world a market request is for: the one asked for if the caller has an active Portal
-- account there (or is an admin), otherwise their own account's world.
-- @permissions private public.sm_market_world(bigint): used only inside the market functions below.
create or replace function public.sm_market_world(p_game_world_id bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint;
begin
  if auth.uid() is null then return null; end if;
  if p_game_world_id is not null then
    if public.is_admin() or exists (
      select 1 from public.manager_portal_accounts a
      where a.auth_user_id = auth.uid() and a.active and a.game_world_id = p_game_world_id
    ) then
      return p_game_world_id;
    end if;
    return null;
  end if;
  select a.game_world_id into v_world from public.manager_portal_accounts a
  where a.auth_user_id = auth.uid() and a.active order by a.id limit 1;
  return v_world;
end;
$$;

revoke all on function public.sm_market_world(bigint) from public, anon, authenticated;

-- @permissions private public.sm_rating_band(integer): used only inside the market functions below.
create or replace function public.sm_rating_band(p_rating integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_rating is null then null when p_rating >= 90 then '90+' when p_rating >= 85 then '85-89'
    when p_rating >= 80 then '80-84' when p_rating >= 75 then '75-79' else 'under 75' end;
$$;

revoke all on function public.sm_rating_band(integer) from public, anon, authenticated;

-- @permissions private public.sm_age_band(integer): used only inside the market functions below.
create or replace function public.sm_age_band(p_age integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_age is null then null when p_age <= 21 then '21 and under' when p_age <= 25 then '22-25'
    when p_age <= 29 then '26-29' else '30+' end;
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
    c as (select * from d where clean),
    by_cell as (
      select position_group, public.sm_rating_band(rating) as band, count(*) as n,
        percentile_cont(0.5) within group (order by fee) as median_fee,
        percentile_cont(0.25) within group (order by fee) as p25_fee,
        percentile_cont(0.75) within group (order by fee) as p75_fee,
        percentile_cont(0.5) within group (order by ratio) as median_ratio
      from c group by 1, 2
    ),
    by_group as (
      select position_group, count(*) as n,
        percentile_cont(0.5) within group (order by fee) as median_fee,
        percentile_cont(0.5) within group (order by ratio) as median_ratio
      from c group by 1
    )
    select jsonb_build_object(
      'worldId', v_world,
      'world', (select w.name from public.game_worlds w where w.id = v_world),
      'days', greatest(1, least(coalesce(p_days, 120), 3650)),
      'firstDeal', (select min(seen_at) from d),
      'lastDeal', (select max(seen_at) from d),
      'deals', (select count(*) from d),
      'clean', (select count(*) from c),
      'excluded', jsonb_build_object(
        'partExchange', (select count(*) from d where part_exchange),
        'linked', (select count(*) from d where linked and not part_exchange),
        'noFeeOrValue', (select count(*) from d where not part_exchange and not linked and not clean)
      ),
      'ratio', jsonb_build_object(
        'all', (select round(percentile_cont(0.5) within group (order by ratio)::numeric, 2) from c),
        'fromAiClubs', (select round(percentile_cont(0.5) within group (order by ratio)::numeric, 2) from c where not seller_is_manager),
        'fromManagers', (select round(percentile_cont(0.5) within group (order by ratio)::numeric, 2) from c where seller_is_manager)
      ),
      'groups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'group', g.position_group, 'n', g.n, 'medianFee', round(g.median_fee), 'medianRatio', round(g.median_ratio::numeric, 2),
          'bands', coalesce((
            select jsonb_agg(jsonb_build_object(
              'band', b.band, 'n', b.n, 'medianFee', round(b.median_fee), 'p25Fee', round(b.p25_fee), 'p75Fee', round(b.p75_fee),
              'medianRatio', round(b.median_ratio::numeric, 2)
            ) order by b.band)
            from by_cell b where b.position_group = g.position_group
          ), '[]'::jsonb)
        ) order by array_position(array['GK','CB','FB','DM','CM','W','AM','ST'], g.position_group))
        from by_group g
      ), '[]'::jsonb),
      'ages', coalesce((
        select jsonb_agg(jsonb_build_object('band', a.band, 'n', a.n, 'medianFee', round(a.median_fee), 'medianRatio', round(a.median_ratio::numeric, 2))
          order by array_position(array['21 and under','22-25','26-29','30+'], a.band))
        from (
          select public.sm_age_band(age) as band, count(*) as n,
            percentile_cont(0.5) within group (order by fee) as median_fee,
            percentile_cont(0.5) within group (order by ratio) as median_ratio
          from c group by 1
        ) a
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_market_rates(bigint, integer) from public, anon;
grant execute on function public.get_market_rates(bigint, integer) to authenticated;

-- An estimated fee range for a player type. Comparables are clean deals in the same position
-- group within 2 rating points and 2 years of age, widened to 3 and 3, then to the same rating
-- band in any position, until there are at least 5. With a value, the range is the value times
-- the comparables' fee/value quartiles; without one, the comparables' fee quartiles.
create or replace function public.market_price_check(
  p_game_world_id bigint,
  p_position_group text,
  p_age integer,
  p_rating integer,
  p_value bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.sm_market_world(p_game_world_id);
  v_group text := upper(nullif(trim(p_position_group), ''));
  v_value bigint := case when p_value > 0 and p_value <= 10000000000 then p_value end;
  v_basis text;
  v_ids bigint[];
begin
  if v_world is null then return null; end if;
  if v_group is not null and v_group not in ('GK','CB','FB','DM','CM','W','AM','ST') then
    raise exception 'Unknown position group %', p_position_group;
  end if;
  if p_age is null or p_age not between 14 and 45 or p_rating is null or p_rating not between 40 and 99 then
    raise exception 'Give an age (14-45) and a rating (40-99)';
  end if;

  select array_agg(d.id) into v_ids from public.sm_market_deals(v_world, 365) d
  where d.clean and (v_group is null or d.position_group = v_group) and abs(d.rating - p_rating) <= 2 and abs(d.age - p_age) <= 2;
  v_basis := 'same position, rating ±2, age ±2';
  if coalesce(array_length(v_ids, 1), 0) < 5 then
    select array_agg(d.id) into v_ids from public.sm_market_deals(v_world, 365) d
    where d.clean and (v_group is null or d.position_group = v_group) and abs(d.rating - p_rating) <= 3 and abs(d.age - p_age) <= 3;
    v_basis := 'same position, rating ±3, age ±3';
  end if;
  if coalesce(array_length(v_ids, 1), 0) < 5 then
    select array_agg(d.id) into v_ids from public.sm_market_deals(v_world, 365) d
    where d.clean and public.sm_rating_band(d.rating) = public.sm_rating_band(p_rating) and abs(d.age - p_age) <= 3;
    v_basis := 'any position, same rating band, age ±3';
  end if;

  return (
    with c as (select * from public.sm_market_deals(v_world, 365) d where d.id = any(coalesce(v_ids, '{}'))),
    q as (
      select count(*) as n,
        percentile_cont(0.25) within group (order by fee) as f25, percentile_cont(0.5) within group (order by fee) as f50,
        percentile_cont(0.75) within group (order by fee) as f75,
        percentile_cont(0.25) within group (order by ratio) as r25, percentile_cont(0.5) within group (order by ratio) as r50,
        percentile_cont(0.75) within group (order by ratio) as r75
      from c
    )
    select jsonb_build_object(
      'worldId', v_world,
      'basis', v_basis,
      'n', q.n,
      'fromValue', v_value is not null,
      'low', case when q.n = 0 then null when v_value is not null then round(v_value * q.r25) else round(q.f25) end,
      'mid', case when q.n = 0 then null when v_value is not null then round(v_value * q.r50) else round(q.f50) end,
      'high', case when q.n = 0 then null when v_value is not null then round(v_value * q.r75) else round(q.f75) end,
      'medianRatio', round(q.r50::numeric, 2),
      'comparables', coalesce((
        select jsonb_agg(row order by row->>'seenAt' desc) from (
          select jsonb_build_object('player', c.player_name, 'position', c.position_label, 'age', c.age, 'rating', c.rating,
            'value', c.player_value, 'fee', c.fee, 'ratio', c.ratio, 'from', c.from_club, 'to', c.to_club, 'seenAt', c.seen_at) as row
          from c order by abs(c.rating - p_rating) + abs(c.age - p_age), c.seen_at desc limit 8
        ) r
      ), '[]'::jsonb),
      'listed', coalesce((
        select jsonb_agg(row order by (row->>'rating')::int desc) from (
          select jsonb_build_object('player', l.player_name, 'club', l.club_name, 'position', l.position_label, 'age', l.age,
            'rating', l.rating, 'value', l.value, 'askingPrice', l.asking_price, 'askingLabel', l.asking_label,
            'concern', l.concern_text, 'listedSince', l.first_seen_at) as row
          from public.soccer_manager_market_listings l
          where l.game_world_id = v_world and l.list_type = 'transfer'
            and (v_group is null or public.sm_position_group(l.position_label) = v_group)
            and abs(l.rating - p_rating) <= 3 and abs(l.age - p_age) <= 3
          order by abs(l.rating - p_rating) + abs(l.age - p_age), l.rating desc limit 6
        ) r
      ), '[]'::jsonb)
    )
    from q
  );
end;
$$;

revoke all on function public.market_price_check(bigint, text, integer, integer, bigint) from public, anon;
grant execute on function public.market_price_check(bigint, text, integer, integer, bigint) to authenticated;
