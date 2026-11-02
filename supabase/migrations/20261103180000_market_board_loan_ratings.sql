-- Transfer board: unhappy players are suggested for loan-only requests only when rated below 89.
-- Clubs practically never loan out players rated 89 or more, so those are left to transfer and
-- swap requests.

create or replace function public.get_market_board(p_game_world_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.sm_market_world(p_game_world_id);
  v_me record;
begin
  if v_world is null then return null; end if;
  select * into v_me from public.sm_board_me(v_world);

  return (
    with open_posts as (
      select p.* from public.market_board_posts p
      where p.game_world_id = v_world and p.closed_at is null and p.expires_at > now()
    ),
    mine as (select * from open_posts where manager_id = v_me.manager_id),
    listings as (
      select l.*, public.sm_position_group(l.position_label) as grp
      from public.soccer_manager_market_listings l
      where l.game_world_id = v_world
        and (v_me.source_club_id is null or l.club_source_id is distinct from v_me.source_club_id)
        and (v_me.club_name is null or l.club_name is distinct from v_me.club_name)
    )
    select jsonb_build_object(
      'worldId', v_world,
      'world', (select w.name from public.game_worlds w where w.id = v_world),
      'me', jsonb_build_object('managerId', v_me.manager_id, 'manager', v_me.manager_name, 'club', v_me.club_name),
      'squad', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'position', coalesce(s.main_position, s.position),
          'age', s.age, 'rating', s.rating, 'value', s.value, 'youth', coalesce(s.youth, false)) order by s.rating desc nulls last, s.name)
        from public.soccer_manager_players s
        where v_me.team_id is not null and s.game_world_id = v_world and s.current_team_id = v_me.team_id
      ), '[]'::jsonb),
      'posts', coalesce((
        select jsonb_agg(public.sm_board_post_json(p, v_me.manager_id) order by p.created_at desc)
        -- All of my open posts, and the latest 150 of everyone else's.
        from (
          select * from mine
          union all
          (select * from open_posts o where o.manager_id is distinct from v_me.manager_id order by o.created_at desc limit 150)
        ) p
      ), '[]'::jsonb),
      -- For each of my posts, what fits it.
      'matches', coalesce((
        select jsonb_object_agg(m.id::text, case when m.kind = 'wanted' then jsonb_build_object(
          'offers', coalesce((
            select jsonb_agg(public.sm_board_post_json(o, v_me.manager_id) order by o.created_at desc)
            from (
              select o.* from open_posts o
              where o.kind = 'offered' and o.manager_id <> m.manager_id
                and (m.position_group is null or public.sm_position_group(o.player_position) = m.position_group)
                and (m.min_age is null or o.player_age >= m.min_age) and (m.max_age is null or o.player_age <= m.max_age)
                and (m.min_rating is null or o.player_rating >= m.min_rating) and (m.max_rating is null or o.player_rating <= m.max_rating)
                and o.deal_types && m.deal_types
                and (m.max_fee is null or o.asking_price is null or o.asking_price <= m.max_fee * 1.1)
              order by o.created_at desc limit 8
            ) o
          ), '[]'::jsonb),
          'listed', coalesce((
            -- Players you can buy first: transfer listed (up to 6), then loan listed (up to 4), then
            -- unhappy players who may be available (up to 4); best rated first within each.
            select jsonb_agg(r.row order by r.list_order, r.rating desc, r.age) from (
              select jsonb_build_object('list', l.list_type, 'player', l.player_name, 'club', l.club_name, 'position', l.position_label,
                'age', l.age, 'rating', l.rating, 'value', l.value, 'askingPrice', l.asking_price, 'askingLabel', l.asking_label,
                'concern', l.concern_text, 'concernLevel', l.concern_level, 'listedSince', l.first_seen_at) as row,
                array_position(array['transfer','loan','concerns'], l.list_type) as list_order, l.rating, l.age,
                row_number() over (partition by l.list_type order by l.rating desc, l.age, l.player_source_id) as rank_in_list
              from listings l
              where (m.position_group is null or l.grp = m.position_group)
                and (m.min_age is null or l.age >= m.min_age) and (m.max_age is null or l.age <= m.max_age)
                and (m.min_rating is null or l.rating >= m.min_rating) and (m.max_rating is null or l.rating <= m.max_rating)
                and (
                  (l.list_type = 'transfer' and (m.deal_types && array['transfer','swap'])
                    and (m.max_fee is null or l.asking_price is null or l.asking_price <= m.max_fee * 1.1))
                  or (l.list_type = 'loan' and 'loan' = any(m.deal_types))
                  -- Unhappy players: a buy (or swap) target at any rating, but a loan target only below 89,
                  -- since clubs practically never loan out players rated 89 or more.
                  or (l.list_type = 'concerns' and ((m.deal_types && array['transfer','swap']) or l.rating < 89))
                )
            ) r
            where r.rank_in_list <= case r.list_order when 1 then 6 else 4 end
          ), '[]'::jsonb)
        ) else jsonb_build_object(
          'wanted', coalesce((
            select jsonb_agg(public.sm_board_post_json(w, v_me.manager_id) order by w.created_at desc)
            from (
              select w.* from open_posts w
              where w.kind = 'wanted' and w.manager_id <> m.manager_id
                and (w.position_group is null or w.position_group = public.sm_position_group(m.player_position))
                and (w.min_age is null or m.player_age >= w.min_age) and (w.max_age is null or m.player_age <= w.max_age)
                and (w.min_rating is null or m.player_rating >= w.min_rating) and (w.max_rating is null or m.player_rating <= w.max_rating)
                and w.deal_types && m.deal_types
                and (w.max_fee is null or m.asking_price is null or m.asking_price <= w.max_fee * 1.1)
              order by w.created_at desc limit 8
            ) w
          ), '[]'::jsonb)
        ) end)
        from mine m
      ), '{}'::jsonb),
      -- Managers' own newsfeed posts about selling, swapping or loaning players, last 14 days.
      'newsfeed', coalesce((
        select jsonb_agg(row order by row->>'postedAt' desc) from (
          select jsonb_build_object('manager', n.manager_name, 'club', n.club_name, 'message', n.message,
            'comments', n.comment_count, 'postedAt', n.posted_at) as row
          from public.soccer_manager_newsfeed n
          where n.game_world_id = v_world and n.item_type = 10 and n.posted_at > now() - interval '14 days'
            -- Posts offering, listing or asking for players; not results, notices or general chat.
            and n.message ~* '(for sale|for sell|\mselling\M|\moffering\M|on the market|transfer list|\mTL\M|listed for|up for grabs|\mcan (all |both )?(potentially )?go\M|\m(is|are|all|still|now) available|available (for|at|to)|could (potentially )?be available|(open|listen) to .{0,15}(offers|deals?)|offers will be considered|willing to (trade|swap|sell)|looking to (swap|sell|add|bring in|make deals|strengthen)|looking for (a |an )?(\d{2}|young|younger|cb|rb|lb|rwb|lwb|gk|keeper|goalkeeper|st|striker|forward|cm|dm|am|lw|rw|winger|centre|left|right|defender|midfielder)|any \d{2}.{0,25}(for sale|available)|\mswap|\m2 ?(for|x) ?1\M|in exchange|exchange offers|px deals?|for cash|can move on)'
            and n.message !~* '(manager account|claim your|available for new managers|teams becoming available|vacant jobs?|youth cup|fixtures|will be staying|thanks (to )?(everyone|those)|coaches who)'
          order by n.posted_at desc limit 20
        ) r
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_market_board(bigint) from public, anon;
grant execute on function public.get_market_board(bigint) to authenticated;
