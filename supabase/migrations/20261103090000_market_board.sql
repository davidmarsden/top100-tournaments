-- The Manager Portal's transfer board: managers post what they want (a player type, budget and
-- deal types) and what they're offering (a player from their squad), and the board matches them
-- with each other and with the market lists Sync captures:
--   * wanted posts against other managers' offers, transfer-listed players, loan-listed players
--     (when a loan will do) and players with concerns (unhappy players who may be available);
--   * offered posts against other managers' wanted posts;
--   * plus recent newsfeed posts where managers list players for sale, swap or loan.
-- Posts are seen by every manager in the game world. They expire after 14 days unless renewed.
--
-- Also: market functions now accept any world where the manager runs a club (the Portal's
-- world switcher), not only their account's home world.

-- The game world a market request is for: the one asked for if the caller has an active Portal
-- account whose manager runs a club there, has it as their account's world, or is an admin;
-- otherwise their own account's world.
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
      where a.auth_user_id = auth.uid() and a.active
        and (a.game_world_id = p_game_world_id or exists (
          select 1 from public.soccer_manager_world_manager_assignments s
          where s.manager_id = a.manager_id and s.game_world_id = p_game_world_id))
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

-- The signed-in manager and their club in a world (null club when they run none there).
-- @permissions private public.sm_board_me(bigint): used only inside the board functions below.
create or replace function public.sm_board_me(p_world bigint)
returns table (manager_id bigint, manager_name text, team_id bigint, club_name text, source_club_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.manager_id, coalesce(m.display_name, m.name), s.team_id, t.name,
    (select sp.current_source_club_id from public.soccer_manager_players sp
      where sp.game_world_id = p_world and sp.current_team_id = s.team_id and sp.current_source_club_id is not null
      order by sp.last_seen_at desc nulls last limit 1)
  from public.manager_portal_accounts a
  join public.managers m on m.id = a.manager_id
  left join lateral (
    select x.team_id from public.soccer_manager_world_manager_assignments x
    where x.game_world_id = p_world and x.manager_id = a.manager_id
    order by x.updated_at desc limit 1
  ) s on true
  left join public.teams t on t.id = s.team_id
  where a.auth_user_id = auth.uid() and a.active
  order by (s.team_id is null), a.id
  limit 1;
$$;

revoke all on function public.sm_board_me(bigint) from public, anon, authenticated;

-- @permissions private public.market_board_posts: read and written only through the security definer board functions below.
create table if not exists public.market_board_posts (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  manager_id bigint not null references public.managers(id) on delete cascade,
  team_id bigint references public.teams(id) on delete set null,
  club_name text,
  kind text not null check (kind in ('wanted', 'offered')),
  position_group text check (position_group in ('GK','CB','FB','DM','CM','W','AM','ST')),
  min_age integer check (min_age between 14 and 45),
  max_age integer check (max_age between 14 and 45),
  min_rating integer check (min_rating between 40 and 99),
  max_rating integer check (max_rating between 40 and 99),
  max_fee bigint check (max_fee > 0),
  asking_price bigint check (asking_price > 0),
  deal_types text[] not null check (cardinality(deal_types) > 0 and deal_types <@ array['transfer','loan','swap']),
  player_id bigint references public.soccer_manager_players(id) on delete set null,
  player_name text,
  player_position text,
  player_age integer,
  player_rating integer,
  player_value bigint,
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  closed_at timestamptz,
  check (min_age is null or max_age is null or min_age <= max_age),
  check (min_rating is null or max_rating is null or min_rating <= max_rating),
  check (kind = 'wanted' or player_name is not null)
);

comment on table public.market_board_posts is
  'Manager Portal transfer board: wanted and offered posts. Read and written only through get_market_board, save_market_board_post and close_market_board_post.';

create index if not exists market_board_posts_world_open_idx
  on public.market_board_posts (game_world_id, kind, expires_at) where closed_at is null;
create index if not exists market_board_posts_manager_idx on public.market_board_posts (manager_id, game_world_id);

alter table public.market_board_posts enable row level security;
revoke all on public.market_board_posts from anon, authenticated;

-- One post as the board shows it.
-- @permissions private public.sm_board_post_json(public.market_board_posts, bigint): used only inside the board functions below.
create or replace function public.sm_board_post_json(p public.market_board_posts, p_viewer bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'isMine', p.manager_id = p_viewer,
    'manager', (select coalesce(m.display_name, m.name) from public.managers m where m.id = p.manager_id),
    'club', p.club_name, 'group', p.position_group,
    'minAge', p.min_age, 'maxAge', p.max_age, 'minRating', p.min_rating, 'maxRating', p.max_rating,
    'maxFee', p.max_fee, 'askingPrice', p.asking_price, 'dealTypes', to_jsonb(p.deal_types),
    'player', case when p.kind = 'offered' then jsonb_build_object('id', p.player_id, 'name', p.player_name,
      'position', p.player_position, 'age', p.player_age, 'rating', p.player_rating, 'value', p.player_value) end,
    'note', p.note, 'createdAt', p.created_at, 'expiresAt', p.expires_at
  );
$$;

revoke all on function public.sm_board_post_json(public.market_board_posts, bigint) from public, anon, authenticated;

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
        from (select * from open_posts order by created_at desc limit 150) p
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
            select jsonb_agg(row order by (row->>'rating')::int desc) from (
              select jsonb_build_object('list', l.list_type, 'player', l.player_name, 'club', l.club_name, 'position', l.position_label,
                'age', l.age, 'rating', l.rating, 'value', l.value, 'askingPrice', l.asking_price, 'askingLabel', l.asking_label,
                'concern', l.concern_text, 'concernLevel', l.concern_level, 'listedSince', l.first_seen_at) as row
              from listings l
              where (m.position_group is null or l.grp = m.position_group)
                and (m.min_age is null or l.age >= m.min_age) and (m.max_age is null or l.age <= m.max_age)
                and (m.min_rating is null or l.rating >= m.min_rating) and (m.max_rating is null or l.rating <= m.max_rating)
                and (
                  (l.list_type = 'transfer' and (m.deal_types && array['transfer','swap'])
                    and (m.max_fee is null or l.asking_price is null or l.asking_price <= m.max_fee * 1.1))
                  or (l.list_type = 'loan' and 'loan' = any(m.deal_types))
                  or (l.list_type = 'concerns')
                )
              order by l.rating desc, l.age limit 12
            ) r
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
            and n.message ~* '(swap|for sale|sell|selling|listed|loan|looking for|wanted|need a|available|offers?\M|bids?\M|exchange)'
          order by n.posted_at desc limit 20
        ) r
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_market_board(bigint) from public, anon;
grant execute on function public.get_market_board(bigint) to authenticated;

-- Creates or updates one of the signed-in manager's posts. An offered post names a player from
-- their own squad in that world. Saving renews the 14 days. At most 10 open posts per world.
create or replace function public.save_market_board_post(p_game_world_id bigint, p_post jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.sm_market_world(p_game_world_id);
  v_me record;
  v_id bigint := case when coalesce(p_post->>'id', '') ~ '^[0-9]{1,18}$' then (p_post->>'id')::bigint end;
  v_kind text := p_post->>'kind';
  v_group text := upper(nullif(trim(p_post->>'group'), ''));
  v_types text[];
  v_player record;
  v_note text := nullif(trim(p_post->>'note'), '');
  v_row public.market_board_posts;
  int_or_null text := '^[0-9]{1,12}$';
begin
  if v_world is null then raise exception 'You have no club in this game world'; end if;
  select null::bigint as id, null::text as name, null::text as position, null::integer as age, null::integer as rating, null::bigint as value into v_player;
  select * into v_me from public.sm_board_me(v_world);
  if v_me.manager_id is null or v_me.team_id is null then raise exception 'You have no club in this game world'; end if;
  if v_kind is null or v_kind not in ('wanted', 'offered') then raise exception 'A post is either wanted or offered'; end if;
  if v_group is not null and v_group not in ('GK','CB','FB','DM','CM','W','AM','ST') then raise exception 'Unknown position group %', v_group; end if;
  if jsonb_typeof(p_post->'dealTypes') is distinct from 'array' then raise exception 'Choose at least one deal type'; end if;
  select array_agg(distinct t) into v_types from jsonb_array_elements_text(p_post->'dealTypes') t where t in ('transfer','loan','swap');
  if coalesce(cardinality(v_types), 0) = 0 then raise exception 'Choose at least one deal type'; end if;
  if char_length(coalesce(v_note, '')) > 280 then raise exception 'Keep the note to 280 characters'; end if;

  if v_id is not null and not exists (
    select 1 from public.market_board_posts p where p.id = v_id and p.manager_id = v_me.manager_id and p.game_world_id = v_world and p.closed_at is null
  ) then
    raise exception 'That post is not one of your open posts';
  end if;
  if v_id is null and (select count(*) from public.market_board_posts p
      where p.manager_id = v_me.manager_id and p.game_world_id = v_world and p.closed_at is null and p.expires_at > now()) >= 10 then
    raise exception 'You already have 10 open posts in this world. Close one first.';
  end if;

  if v_kind = 'offered' then
    select s.id, s.name, coalesce(s.main_position, s.position) as position, s.age, s.rating, s.value into v_player
    from public.soccer_manager_players s
    where s.id = case when coalesce(p_post->>'playerId', '') ~ '^[0-9]{1,18}$' then (p_post->>'playerId')::bigint end
      and s.game_world_id = v_world and s.current_team_id = v_me.team_id;
    if v_player.id is null then raise exception 'Choose a player from your squad'; end if;
  end if;

  if v_id is null then
    insert into public.market_board_posts (game_world_id, manager_id, kind, deal_types, player_name)
    values (v_world, v_me.manager_id, v_kind, v_types, coalesce(v_player.name, case when v_kind = 'offered' then '' end))
    returning id into v_id;
  end if;

  update public.market_board_posts p set
    team_id = v_me.team_id,
    club_name = v_me.club_name,
    kind = v_kind,
    position_group = case when v_kind = 'wanted' then v_group else public.sm_position_group(v_player.position) end,
    min_age = case when v_kind = 'wanted' and coalesce(p_post->>'minAge', '') ~ int_or_null then (p_post->>'minAge')::int end,
    max_age = case when v_kind = 'wanted' and coalesce(p_post->>'maxAge', '') ~ int_or_null then (p_post->>'maxAge')::int end,
    min_rating = case when v_kind = 'wanted' and coalesce(p_post->>'minRating', '') ~ int_or_null then (p_post->>'minRating')::int end,
    max_rating = case when v_kind = 'wanted' and coalesce(p_post->>'maxRating', '') ~ int_or_null then (p_post->>'maxRating')::int end,
    max_fee = case when v_kind = 'wanted' and coalesce(p_post->>'maxFee', '') ~ int_or_null then nullif((p_post->>'maxFee')::bigint, 0) end,
    asking_price = case when v_kind = 'offered' and coalesce(p_post->>'askingPrice', '') ~ int_or_null then nullif((p_post->>'askingPrice')::bigint, 0) end,
    deal_types = v_types,
    player_id = v_player.id,
    player_name = v_player.name,
    player_position = v_player.position,
    player_age = v_player.age,
    player_rating = v_player.rating,
    player_value = v_player.value,
    note = v_note,
    updated_at = now(),
    expires_at = now() + interval '14 days'
  where p.id = v_id
  returning * into v_row;

  return public.sm_board_post_json(v_row, v_me.manager_id);
end;
$$;

revoke all on function public.save_market_board_post(bigint, jsonb) from public, anon;
grant execute on function public.save_market_board_post(bigint, jsonb) to authenticated;

create or replace function public.close_market_board_post(p_post_id bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_done integer;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.market_board_posts p set closed_at = now(), updated_at = now()
  where p.id = p_post_id and p.closed_at is null
    and p.manager_id in (select a.manager_id from public.manager_portal_accounts a where a.auth_user_id = auth.uid() and a.active);
  get diagnostics v_done = row_count;
  return v_done > 0;
end;
$$;

revoke all on function public.close_market_board_post(bigint) from public, anon;
grant execute on function public.close_market_board_post(bigint) to authenticated;
