-- Market digest for Top 100 Chat: a short daily post that gives managers something to talk
-- about. A scheduled Netlify function (chat-market-digest) reads chat_market_digest() with the
-- service role, writes the post and sends it to the chat gateway, then records it with
-- record_chat_market_digest() so the next digest starts where this one ended.
--
-- The digest covers, since the last one (or the last 24 hours):
--   * the biggest completed deals (part exchanges and linked deals left out, as in the rates);
--   * a talking point: the dearest and the cheapest deal against the player's value;
--   * the number of part-exchange deals, with the largest one;
--   * players newly transfer listed and newly unhappy;
--   * new posts on the Manager Portal transfer board;
--   * managers' own newsfeed posts about deals.

-- @permissions private public.chat_market_digests: written and read only by the service-role digest functions below.
create table if not exists public.chat_market_digests (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  digest_key text not null unique,
  covers_from timestamptz not null,
  covers_to timestamptz not null,
  posted_at timestamptz not null default now(),
  chat_item_id text,
  summary jsonb not null default '{}'::jsonb
);

alter table public.chat_market_digests enable row level security;
revoke all on public.chat_market_digests from anon, authenticated;

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
    clean as (select * from deals where clean),
    named as (
      select c.*,
        (select coalesce(m.display_name, m.name) from public.managers m where m.id = c.to_manager_id) as buyer_manager,
        (select coalesce(m.display_name, m.name) from public.managers m where m.id = c.from_manager_id) as seller_manager
      from clean c
    ),
    deal_json as (
      select n.*, jsonb_build_object('player', n.player_name, 'position', n.position_label, 'age', n.age, 'rating', n.rating,
        'fee', n.fee, 'value', n.player_value, 'ratio', n.ratio, 'from', n.from_club, 'to', n.to_club,
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
      'typicalRatio', (select round(percentile_cont(0.5) within group (order by ratio)::numeric, 2) from clean),
      'biggest', coalesce((select jsonb_agg(j order by fee desc) from (select * from deal_json order by fee desc limit 5) x), '[]'::jsonb),
      -- Talking points: only deals of some size, so a £50k youth signing isn't the "steal of the day".
      'dearest', (select j from deal_json where fee >= 1000000 and ratio >= 2 order by ratio desc, fee desc limit 1),
      'cheapest', (select j from deal_json where player_value >= 1000000 and ratio <= 0.8 order by ratio, player_value desc limit 1),
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

-- Records a digest once the chat has accepted it. The key makes a retried run a no-op.
create or replace function public.record_chat_market_digest(
  p_world_slug text,
  p_digest_key text,
  p_from timestamptz,
  p_to timestamptz,
  p_chat_item_id text default null,
  p_summary jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_world bigint;
  v_rows integer;
begin
  select w.id into v_world from public.game_worlds w where w.slug = p_world_slug;
  if v_world is null then raise exception 'Unknown game world %', p_world_slug; end if;
  if coalesce(trim(p_digest_key), '') = '' or p_from is null or p_to is null or p_to < p_from then
    raise exception 'A digest key and a valid period are required';
  end if;
  insert into public.chat_market_digests (game_world_id, digest_key, covers_from, covers_to, chat_item_id, summary)
  values (v_world, left(trim(p_digest_key), 120), p_from, p_to, left(p_chat_item_id, 120), coalesce(p_summary, '{}'::jsonb))
  on conflict (digest_key) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.record_chat_market_digest(text, text, timestamptz, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_chat_market_digest(text, text, timestamptz, timestamptz, text, jsonb) to service_role;
