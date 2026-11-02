-- Market rates v2: count the players in part exchanges.
-- Most deals between managers are part exchanges, so cash alone understates the price. A deal's
-- full value is now its cash plus the value of the players going the other way:
--   * each player in player_offers is valued as of the deal (the value on his own transfer record
--     when Sync saw him move within three days), otherwise at his current value;
--   * a deal is "valued" when every player going back could be valued;
--   * deals linked to another one between the same two clubs on the same day (swaps split across
--     two transfers) are still left out.
-- Rates are now shown two ways: deals between managers (full value, with the typical package by
-- rating) and buys from computer clubs (cash, which is what counts there). The price check and
-- the Chat digest use full values too.

drop function if exists public.sm_market_deals(bigint, integer);

-- @permissions private public.sm_market_deals(bigint, integer): used only inside the market functions.
create function public.sm_market_deals(p_world bigint, p_days integer default 120)
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
  seen_at timestamptz,
  players_back jsonb,
  players_back_count integer,
  players_back_valued integer,
  players_back_value bigint,
  best_back_rating integer,
  total_value bigint,
  total_ratio numeric,
  valued boolean
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
          and o.first_seen_at between t.first_seen_at - interval '3 days' and t.first_seen_at + interval '3 days'
          and ((o.from_source_club_id = t.to_source_club_id and o.to_source_club_id = t.from_source_club_id)
            or (o.from_source_club_id = t.from_source_club_id and o.to_source_club_id = t.to_source_club_id))
      ) as is_linked
    from public.soccer_manager_transfers t
    where t.game_world_id = p_world and t.status = 9
      and t.first_seen_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 120), 3650)))
  ),
  back as (
    select d.id,
      count(*)::integer as n,
      count(v.value)::integer as n_valued,
      coalesce(sum(v.value), 0)::bigint as value,
      max(v.rating) as best,
      jsonb_agg(jsonb_build_object('name', coalesce(v.name, o->>'name'), 'rating', v.rating, 'age', v.age,
        'position', v.position, 'value', v.value) order by v.rating desc nulls last) as players
    from deals d
    cross join lateral jsonb_array_elements(d.player_offers) o
    left join lateral (
      select p.name, p.rating, p.age, coalesce(p.main_position, p.position) as position,
        coalesce((
          select t2.player_value from public.soccer_manager_transfers t2
          where t2.game_world_id = p.game_world_id and t2.player_id = p.id and t2.status = 9 and t2.player_value > 0
            and t2.first_seen_at between d.first_seen_at - interval '3 days' and d.first_seen_at + interval '3 days'
          order by abs(extract(epoch from t2.first_seen_at - d.first_seen_at)) limit 1
        ), nullif(p.value, 0)) as value
      from public.soccer_manager_players p
      where p.game_world_id = d.game_world_id and p.source_player_id = o->>'playerId'
      limit 1
    ) v on true
    where d.px
    group by d.id
  )
  select d.id, d.player_name, d.position, public.sm_position_group(d.position), d.age, d.rating, d.player_value, d.amount,
    case when d.player_value > 0 then round(d.amount::numeric / d.player_value, 3) end,
    d.from_club_name, d.to_club_name,
    d.from_manager_id is not null or coalesce(nullif(trim(d.source_data->>'fromManagerId'), ''), '0') <> '0',
    d.px, d.is_linked,
    -- Cash-only deals, as before (used for buys from computer clubs).
    not d.px and not d.is_linked and coalesce(d.amount, 0) > 0 and coalesce(d.player_value, 0) > 0
      and d.age is not null and d.rating is not null and public.sm_position_group(d.position) is not null,
    d.first_seen_at,
    coalesce(b.players, '[]'::jsonb), coalesce(b.n, 0), coalesce(b.n_valued, 0), coalesce(b.value, 0), b.best,
    coalesce(d.amount, 0) + coalesce(b.value, 0),
    case when d.player_value > 0 then round((coalesce(d.amount, 0) + coalesce(b.value, 0))::numeric / d.player_value, 3) end,
    -- Valued: not linked, every player going back valued, something of value changed hands.
    not d.is_linked and coalesce(d.player_value, 0) > 0 and d.age is not null and d.rating is not null
      and public.sm_position_group(d.position) is not null
      and coalesce(b.n, 0) = coalesce(b.n_valued, 0)
      and coalesce(d.amount, 0) + coalesce(b.value, 0) > 0
  from deals d
  left join back b on b.id = d.id;
$$;

revoke all on function public.sm_market_deals(bigint, integer) from public, anon, authenticated;

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
    bands as (select unnest(array['under 75','75-79','80-84','85-89','90+']) as band, generate_series(1, 5) as ord)
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
        'groups', coalesce((
          select jsonb_agg(jsonb_build_object('group', g.position_group, 'n', g.n, 'bands', g.bands)
            order by array_position(array['GK','CB','FB','DM','CM','W','AM','ST'], g.position_group))
          from (
            select position_group, count(*) as n, jsonb_agg(jsonb_build_object('band', band, 'n', n, 'medianTotal', median_total,
              'medianRatio', median_ratio) order by band) as bands
            from (
              select position_group, public.sm_rating_band(rating) as band, count(*) as n,
                round(percentile_cont(0.5) within group (order by total_value)) as median_total,
                round((percentile_cont(0.5) within group (order by total_ratio))::numeric, 2) as median_ratio
              from managers group by 1, 2
            ) cell
            group by position_group
          ) g
        ), '[]'::jsonb)
      ),
      -- From computer clubs: cash, by position and rating.
      'computer', jsonb_build_object(
        'deals', (select count(*) from computer),
        'medianRatio', (select round(percentile_cont(0.5) within group (order by ratio)::numeric, 2) from computer),
        'groups', coalesce((
          select jsonb_agg(jsonb_build_object('group', g.position_group, 'n', g.n, 'bands', g.bands)
            order by array_position(array['GK','CB','FB','DM','CM','W','AM','ST'], g.position_group))
          from (
            select position_group, count(*) as n, jsonb_agg(jsonb_build_object('band', band, 'n', n, 'medianFee', median_fee,
              'medianRatio', median_ratio) order by band) as bands
            from (
              select position_group, public.sm_rating_band(rating) as band, count(*) as n,
                round(percentile_cont(0.5) within group (order by fee)) as median_fee,
                round((percentile_cont(0.5) within group (order by ratio))::numeric, 2) as median_ratio
              from computer group by 1, 2
            ) cell
            group by position_group
          ) g
        ), '[]'::jsonb)
      ),
      'ages', coalesce((
        select jsonb_agg(jsonb_build_object('band', a.band, 'n', a.n, 'medianRatio', a.median_ratio)
          order by array_position(array['21 and under','22-25','26-29','30+'], a.band))
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

-- A player type's likely price, both ways it can be paid: between managers (cash + players back,
-- from comparable valued deals, with the usual package) and from computer clubs (cash). Comparables
-- are the same position within 2 rating points and 2 years, widened to 3 and 3, then to the same
-- rating band in any position, until there are 5. With a value, ranges scale the comparables'
-- value ratios; without one, their totals.
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
  v_result jsonb := '{}'::jsonb;
  v_side text;
  v_ids bigint[];
  v_basis text;
begin
  if v_world is null then return null; end if;
  if v_group is not null and v_group not in ('GK','CB','FB','DM','CM','W','AM','ST') then
    raise exception 'Unknown position group %', p_position_group;
  end if;
  if p_age is null or p_age not between 14 and 45 or p_rating is null or p_rating not between 40 and 99 then
    raise exception 'Give an age (14-45) and a rating (40-99)';
  end if;

  foreach v_side in array array['managers', 'computer'] loop
    v_ids := null;
    select array_agg(d.id) into v_ids from public.sm_market_deals(v_world, 365) d
    where (case v_side when 'managers' then d.valued and d.seller_is_manager else d.clean and not d.seller_is_manager end)
      and (v_group is null or d.position_group = v_group) and abs(d.rating - p_rating) <= 2 and abs(d.age - p_age) <= 2;
    v_basis := 'same position, rating ±2, age ±2';
    if coalesce(array_length(v_ids, 1), 0) < 5 then
      select array_agg(d.id) into v_ids from public.sm_market_deals(v_world, 365) d
      where (case v_side when 'managers' then d.valued and d.seller_is_manager else d.clean and not d.seller_is_manager end)
        and (v_group is null or d.position_group = v_group) and abs(d.rating - p_rating) <= 3 and abs(d.age - p_age) <= 3;
      v_basis := 'same position, rating ±3, age ±3';
    end if;
    if coalesce(array_length(v_ids, 1), 0) < 5 then
      select array_agg(d.id) into v_ids from public.sm_market_deals(v_world, 365) d
      where (case v_side when 'managers' then d.valued and d.seller_is_manager else d.clean and not d.seller_is_manager end)
        and public.sm_rating_band(d.rating) = public.sm_rating_band(p_rating) and abs(d.age - p_age) <= 3;
      v_basis := 'any position, same rating band, age ±3';
    end if;

    v_result := v_result || jsonb_build_object(v_side, (
      with c as (
        select d.*, case v_side when 'managers' then d.total_value else d.fee end as price,
          case v_side when 'managers' then d.total_ratio else d.ratio end as price_ratio
        from public.sm_market_deals(v_world, 365) d where d.id = any(coalesce(v_ids, '{}'))
      ),
      q as (
        select count(*) as n,
          percentile_cont(0.25) within group (order by price) as f25, percentile_cont(0.5) within group (order by price) as f50,
          percentile_cont(0.75) within group (order by price) as f75,
          percentile_cont(0.25) within group (order by price_ratio) as r25, percentile_cont(0.5) within group (order by price_ratio) as r50,
          percentile_cont(0.75) within group (order by price_ratio) as r75,
          avg(part_exchange::int) as px_share,
          avg(players_back_count) filter (where part_exchange) as back_n,
          percentile_cont(0.5) within group (order by best_back_rating) filter (where part_exchange) as back_best,
          percentile_cont(0.5) within group (order by fee) filter (where part_exchange) as back_cash
        from c
      )
      select jsonb_build_object(
        'basis', v_basis, 'n', q.n, 'fromValue', v_value is not null,
        'low', case when q.n = 0 then null when v_value is not null then round(v_value * q.r25) else round(q.f25) end,
        'mid', case when q.n = 0 then null when v_value is not null then round(v_value * q.r50) else round(q.f50) end,
        'high', case when q.n = 0 then null when v_value is not null then round(v_value * q.r75) else round(q.f75) end,
        'medianRatio', round(q.r50::numeric, 2),
        'partExchangeShare', round(q.px_share::numeric, 2),
        'playersBack', round(q.back_n::numeric, 1),
        'bestBackRating', round(q.back_best),
        'medianCashWithPlayers', round(q.back_cash),
        'comparables', coalesce((
          select jsonb_agg(row order by row->>'seenAt' desc) from (
            select jsonb_build_object('player', c.player_name, 'position', c.position_label, 'age', c.age, 'rating', c.rating,
              'value', c.player_value, 'fee', c.fee, 'playersBack', c.players_back, 'total', c.price, 'ratio', c.price_ratio,
              'from', c.from_club, 'to', c.to_club, 'seenAt', c.seen_at) as row
            from c order by abs(c.rating - p_rating) + abs(c.age - p_age), c.seen_at desc limit 6
          ) r
        ), '[]'::jsonb)
      )
      from q
    ));
  end loop;

  return v_result || jsonb_build_object(
    'worldId', v_world,
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
  );
end;
$$;

revoke all on function public.market_price_check(bigint, text, integer, integer, bigint) from public, anon;
grant execute on function public.market_price_check(bigint, text, integer, integer, bigint) to authenticated;

-- The Chat digest: biggest deals and talking points by full value (cash + players back).
create or replace function public.chat_market_digest(p_world_slug text default 'top-100', p_since timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world record;
  v_since timestamptz;
  v_until timestamptz := now();
begin
  select w.id, w.name, w.slug into v_world from public.game_worlds w where w.slug = coalesce(nullif(trim(p_world_slug), ''), 'top-100');
  if v_world.id is null then raise exception 'Unknown game world %', p_world_slug; end if;

  v_since := coalesce(
    p_since,
    (select max(d.covers_to) from public.chat_market_digests d where d.game_world_id = v_world.id),
    v_until - interval '24 hours'
  );
  -- Never look back more than a week, so a long pause doesn't produce a huge post.
  v_since := greatest(v_since, v_until - interval '7 days');

  return (
    with deals as (
      select d.*, t.to_manager_id, t.from_manager_id
      from public.sm_market_deals(v_world.id, 8) d
      join public.soccer_manager_transfers t on t.id = d.id
      where d.seen_at > v_since and d.seen_at <= v_until
    ),
    -- Deals with a full value (cash + players back); linked swaps and unvalued players left out.
    clean as (select * from deals where valued),
    named as (
      select c.*,
        (select coalesce(m.display_name, m.name) from public.managers m where m.id = c.to_manager_id) as buyer_manager,
        (select coalesce(m.display_name, m.name) from public.managers m where m.id = c.from_manager_id) as seller_manager
      from clean c
    ),
    deal_json as (
      select n.*, jsonb_build_object('player', n.player_name, 'position', n.position_label, 'age', n.age, 'rating', n.rating,
        'fee', n.fee, 'value', n.player_value, 'ratio', n.total_ratio, 'total', n.total_value,
        'playersBack', n.players_back, 'from', n.from_club, 'to', n.to_club,
        'buyer', n.buyer_manager, 'seller', n.seller_manager) as j
      from named n
    ),
    new_listings as (
      select l.* from public.soccer_manager_market_listings l
      where l.game_world_id = v_world.id and l.first_seen_at > v_since and l.first_seen_at <= v_until
    ),
    new_posts as (
      select p.* from public.market_board_posts p
      where p.game_world_id = v_world.id and p.created_at > v_since and p.created_at <= v_until and p.closed_at is null
    ),
    feed as (
      select n.* from public.soccer_manager_newsfeed n
      where n.game_world_id = v_world.id and n.item_type = 10 and n.first_seen_at > v_since and n.first_seen_at <= v_until
        and n.message ~* '(for sale|for sell|\mselling\M|\moffering\M|on the market|transfer list|\mTL\M|listed for|up for grabs|\mcan (all |both )?(potentially )?go\M|\m(is|are|all|still|now) available|available (for|at|to)|could (potentially )?be available|(open|listen) to .{0,15}(offers|deals?)|offers will be considered|willing to (trade|swap|sell)|looking to (swap|sell|add|bring in|make deals|strengthen)|looking for (a |an )?(\d{2}|young|younger|cb|rb|lb|rwb|lwb|gk|keeper|goalkeeper|st|striker|forward|cm|dm|am|lw|rw|winger|centre|left|right|defender|midfielder)|any \d{2}.{0,25}(for sale|available)|\mswap|\m2 ?(for|x) ?1\M|in exchange|exchange offers|px deals?|for cash|can move on)'
        and n.message !~* '(manager account|claim your|available for new managers|teams becoming available|vacant jobs?|youth cup|fixtures|will be staying|thanks (to )?(everyone|those)|coaches who)'
    )
    select jsonb_build_object(
      'world', v_world.name,
      'worldSlug', v_world.slug,
      'from', v_since,
      'to', v_until,
      'deals', (select count(*) from deals),
      'cleanDeals', (select count(*) from clean),
      'totalFees', (select coalesce(sum(fee), 0) from deals),
      'totalValue', (select coalesce(sum(total_value), 0) from clean),
      'typicalRatio', (select round(percentile_cont(0.5) within group (order by total_ratio)::numeric, 2) from clean where seller_is_manager),
      'biggest', coalesce((select jsonb_agg(j order by total_value desc) from (select * from deal_json order by total_value desc limit 5) x), '[]'::jsonb),
      -- Talking points: only deals of some size, so a £50k youth signing isn't the "steal of the day".
      'dearest', (select j from deal_json where total_value >= 1000000 and total_ratio >= 2 order by total_ratio desc, total_value desc limit 1),
      'cheapest', (select j from deal_json where player_value >= 1000000 and total_ratio <= 0.8 order by total_ratio, player_value desc limit 1),
      'partExchanges', (select count(*) from deals where part_exchange),
      'biggestPartExchange', (
        select jsonb_build_object('player', d.player_name, 'rating', d.rating, 'from', d.from_club, 'to', d.to_club, 'fee', d.fee,
          'with', (select string_agg(o->>'name', ', ') from jsonb_array_elements(t.player_offers) o))
        from deals d join public.soccer_manager_transfers t on t.id = d.id
        where d.part_exchange order by d.rating desc, d.player_value desc nulls last limit 1
      ),
      'newlyListed', coalesce((
        select jsonb_agg(jsonb_build_object('player', l.player_name, 'club', l.club_name, 'position', l.position_label, 'age', l.age,
          'rating', l.rating, 'askingPrice', l.asking_price, 'askingLabel', l.asking_label) order by l.rating desc, l.age)
        from (select * from new_listings where list_type = 'transfer' order by rating desc, age limit 5) l
      ), '[]'::jsonb),
      'newlyListedCount', (select count(*) from new_listings where list_type = 'transfer'),
      'newlyUnhappy', coalesce((
        select jsonb_agg(jsonb_build_object('player', l.player_name, 'club', l.club_name, 'position', l.position_label, 'age', l.age,
          'rating', l.rating, 'concern', l.concern_text) order by l.rating desc, l.age)
        from (select * from new_listings where list_type = 'concerns' order by rating desc, age limit 3) l
      ), '[]'::jsonb),
      'newlyUnhappyCount', (select count(*) from new_listings where list_type = 'concerns'),
      'board', jsonb_build_object(
        'wanted', (select count(*) from new_posts where kind = 'wanted'),
        'offered', (select count(*) from new_posts where kind = 'offered'),
        'open', (select count(*) from public.market_board_posts p where p.game_world_id = v_world.id and p.closed_at is null and p.expires_at > now()),
        'latest', coalesce((
          select jsonb_agg(jsonb_build_object('kind', p.kind, 'club', p.club_name, 'group', p.position_group,
            'minRating', p.min_rating, 'maxRating', p.max_rating, 'maxFee', p.max_fee, 'dealTypes', to_jsonb(p.deal_types),
            'player', p.player_name, 'playerRating', p.player_rating, 'playerPosition', p.player_position, 'askingPrice', p.asking_price)
            order by p.created_at desc)
          from (select * from new_posts order by created_at desc limit 4) p
        ), '[]'::jsonb)
      ),
      'newsfeed', coalesce((
        select jsonb_agg(jsonb_build_object('manager', f.manager_name, 'club', f.club_name, 'message', left(f.message, 220)) order by f.posted_at desc)
        from (select * from feed order by posted_at desc limit 4) f
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.chat_market_digest(text, timestamptz) from public, anon, authenticated;
grant execute on function public.chat_market_digest(text, timestamptz) to service_role;
