-- The market's public lists and the game world newsfeed, from Sync everything.
--   * soccer_manager_market_listings: who is transfer listed, loan listed or has concerns
--     (transfer-market-mobile.php?action=transfer-list|loan-list|concerns-list). A complete read
--     replaces a world's list (players no longer listed are removed); a partial read only adds and
--     refreshes rows. first_seen_at survives refreshes, so "listed since" is known.
--   * soccer_manager_newsfeed: completed signings (type 1, with fee), new and resigned managers
--     (type 2) and managers' own posts (type 10), with comments where read.
-- Written only by the save functions below (global admins, via the Lab Sync tab); read by admins.
-- Later steps (market rates, the wanted/offered board, chat digests) read them through their own
-- functions.

create table if not exists public.soccer_manager_market_listings (
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  list_type text not null check (list_type in ('transfer', 'loan', 'concerns')),
  player_source_id text not null check (player_source_id ~ '^[1-9][0-9]{0,19}$'),
  player_name text,
  club_source_id text,
  club_name text,
  age integer,
  country text,
  position_id integer,
  position_label text,
  position_title text,
  rating integer,
  value bigint,
  asking_price bigint,
  asking_label text,
  part_exchange_only boolean not null default false,
  concern_level integer,
  concern_past_level integer,
  concern_level_text text,
  concern_text text,
  managed boolean,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (game_world_id, list_type, player_source_id)
);

comment on table public.soccer_manager_market_listings is
  'Transfer, loan and concerns lists from Soccer Manager. Written only by save_soccer_manager_market_list().';

create table if not exists public.soccer_manager_newsfeed (
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  item_source_id text not null check (item_source_id ~ '^[1-9][0-9]{0,19}$'),
  item_type integer not null,
  posted_at timestamptz not null,
  title text,
  message text,
  comment_count integer not null default 0,
  player_source_id text,
  player_name text,
  rating integer,
  position_label text,
  position_id integer,
  fee bigint,
  club_data_id text,
  club_name text,
  other_club_data_id text,
  other_club_name text,
  manager_source_id text,
  manager_name text,
  comments jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (game_world_id, item_source_id)
);

comment on table public.soccer_manager_newsfeed is
  'Game world newsfeed from Soccer Manager. Written only by save_soccer_manager_newsfeed().';

create index if not exists soccer_manager_newsfeed_world_posted_idx
  on public.soccer_manager_newsfeed (game_world_id, posted_at desc);
create index if not exists soccer_manager_newsfeed_world_type_idx
  on public.soccer_manager_newsfeed (game_world_id, item_type, posted_at desc);

alter table public.soccer_manager_market_listings enable row level security;
alter table public.soccer_manager_newsfeed enable row level security;
revoke all on public.soccer_manager_market_listings from anon, authenticated;
revoke all on public.soccer_manager_newsfeed from anon, authenticated;

drop policy if exists "Admins read market listings" on public.soccer_manager_market_listings;
create policy "Admins read market listings" on public.soccer_manager_market_listings
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "Admins read newsfeed" on public.soccer_manager_newsfeed;
create policy "Admins read newsfeed" on public.soccer_manager_newsfeed
  for select to authenticated using ((select public.is_admin()));
grant select on public.soccer_manager_market_listings to authenticated;
grant select on public.soccer_manager_newsfeed to authenticated;

-- Small parsing helpers for the save functions.
-- @permissions private: called only inside the security definer save functions below.
create or replace function public.sm_market_int(p_value text, p_min bigint, p_max bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(trim(p_value), '') ~ '^-?[0-9]{1,15}$'
               and trim(p_value)::bigint between p_min and p_max
              then trim(p_value)::bigint end;
$$;

revoke all on function public.sm_market_int(text, bigint, bigint) from public, anon, authenticated;

-- Saves one list for a world. A complete read replaces the stored list; a partial read only adds
-- and refreshes rows. Returns { listed, added, removed, complete }.
create or replace function public.save_soccer_manager_market_list(
  target_setup_id text,
  target_list_type text,
  target_rows jsonb,
  target_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_id text := nullif(trim(target_setup_id), '');
  v_world_id bigint;
  v_now timestamptz := now();
  v_added integer := 0;
  v_removed integer := 0;
  v_listed integer := 0;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if setup_id is null or setup_id !~ '^[0-9]{1,18}$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;
  if target_list_type is null or target_list_type not in ('transfer', 'loan', 'concerns') then
    raise exception 'List type must be transfer, loan or concerns';
  end if;
  if jsonb_typeof(target_rows) is distinct from 'array' then
    raise exception 'target_rows must be an array';
  end if;
  if jsonb_array_length(target_rows) > 1000 then
    raise exception 'Save at most 1000 rows per list';
  end if;

  select id into v_world_id from public.game_worlds where external_world_id = setup_id::bigint order by id limit 1;
  if v_world_id is null then
    raise exception 'No archived Soccer Manager world %', setup_id;
  end if;

  create temporary table if not exists pg_temp.sm_market_incoming (
    player_source_id text primary key,
    player_name text, club_source_id text, club_name text, age integer, country text,
    position_id integer, position_label text, position_title text, rating integer, value bigint,
    asking_price bigint, asking_label text, part_exchange_only boolean,
    concern_level integer, concern_past_level integer, concern_level_text text, concern_text text, managed boolean
  ) on commit drop;
  truncate pg_temp.sm_market_incoming;

  insert into pg_temp.sm_market_incoming
  select distinct on (player_source_id) *
  from (
    select
      r->>'playerId' as player_source_id,
      left(nullif(trim(r->>'playerName'), ''), 120),
      case when coalesce(r->>'clubId', '') ~ '^[1-9][0-9]{0,19}$' then r->>'clubId' end,
      left(nullif(trim(r->>'clubName'), ''), 160),
      public.sm_market_int(r->>'age', 10, 60)::integer,
      left(nullif(trim(r->>'country'), ''), 80),
      public.sm_market_int(r->>'positionId', 0, 2147483647)::integer,
      left(nullif(trim(r->>'positionLabel'), ''), 40),
      left(nullif(trim(r->>'positionTitle'), ''), 200),
      public.sm_market_int(r->>'rating', 1, 120)::integer,
      public.sm_market_int(r->>'value', 0, 10000000000),
      nullif(public.sm_market_int(r->>'askingPrice', 0, 10000000000), 0),
      left(nullif(trim(r->>'askingLabel'), ''), 60),
      coalesce(case when jsonb_typeof(r->'partExchangeOnly') = 'boolean' then (r->>'partExchangeOnly')::boolean end, false),
      public.sm_market_int(r->>'concernLevel', 0, 10)::integer,
      public.sm_market_int(r->>'concernPastLevel', 0, 10)::integer,
      left(nullif(trim(r->>'concernLevelText'), ''), 80),
      left(nullif(trim(r->>'concernText'), ''), 160),
      case when jsonb_typeof(r->'managed') = 'boolean' then (r->>'managed')::boolean end
    from jsonb_array_elements(target_rows) r
    where jsonb_typeof(r) = 'object' and coalesce(r->>'playerId', '') ~ '^[1-9][0-9]{0,19}$'
  ) parsed
  order by player_source_id;

  get diagnostics v_listed = row_count;

  select count(*) into v_added
  from pg_temp.sm_market_incoming i
  where not exists (
    select 1 from public.soccer_manager_market_listings l
    where l.game_world_id = v_world_id and l.list_type = target_list_type and l.player_source_id = i.player_source_id
  );

  insert into public.soccer_manager_market_listings as l (
    game_world_id, list_type, player_source_id, player_name, club_source_id, club_name, age, country,
    position_id, position_label, position_title, rating, value, asking_price, asking_label, part_exchange_only,
    concern_level, concern_past_level, concern_level_text, concern_text, managed, first_seen_at, last_seen_at
  )
  select v_world_id, target_list_type, i.player_source_id, i.player_name, i.club_source_id, i.club_name, i.age, i.country,
         i.position_id, i.position_label, i.position_title, i.rating, i.value, i.asking_price, i.asking_label, i.part_exchange_only,
         i.concern_level, i.concern_past_level, i.concern_level_text, i.concern_text, i.managed, v_now, v_now
  from pg_temp.sm_market_incoming i
  on conflict (game_world_id, list_type, player_source_id) do update set
    player_name = excluded.player_name,
    -- A player listed by a different club is a new listing.
    first_seen_at = case when l.club_source_id is distinct from excluded.club_source_id then excluded.first_seen_at else l.first_seen_at end,
    club_source_id = excluded.club_source_id,
    club_name = excluded.club_name,
    age = excluded.age,
    country = excluded.country,
    position_id = excluded.position_id,
    position_label = excluded.position_label,
    position_title = excluded.position_title,
    rating = excluded.rating,
    value = excluded.value,
    asking_price = excluded.asking_price,
    asking_label = excluded.asking_label,
    part_exchange_only = excluded.part_exchange_only,
    concern_level = excluded.concern_level,
    concern_past_level = excluded.concern_past_level,
    concern_level_text = excluded.concern_level_text,
    concern_text = excluded.concern_text,
    managed = excluded.managed,
    last_seen_at = excluded.last_seen_at;

  if coalesce(target_complete, false) then
    delete from public.soccer_manager_market_listings l
    where l.game_world_id = v_world_id and l.list_type = target_list_type
      and not exists (select 1 from pg_temp.sm_market_incoming i where i.player_source_id = l.player_source_id);
    get diagnostics v_removed = row_count;
  end if;

  return jsonb_build_object('listed', v_listed, 'added', v_added, 'removed', v_removed, 'complete', coalesce(target_complete, false));
end;
$$;

revoke all on function public.save_soccer_manager_market_list(text, text, jsonb, boolean) from public, anon;
grant execute on function public.save_soccer_manager_market_list(text, text, jsonb, boolean) to authenticated, service_role;

-- Adds or refreshes newsfeed items by id. Comments are replaced only when sent (an item sent
-- without them keeps what was stored). Returns { items, added }.
create or replace function public.save_soccer_manager_newsfeed(
  target_setup_id text,
  target_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_id text := nullif(trim(target_setup_id), '');
  v_world_id bigint;
  v_now timestamptz := now();
  v_items integer := 0;
  v_added integer := 0;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if setup_id is null or setup_id !~ '^[0-9]{1,18}$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;
  if jsonb_typeof(target_items) is distinct from 'array' then
    raise exception 'target_items must be an array';
  end if;
  if jsonb_array_length(target_items) > 400 then
    raise exception 'Save at most 400 newsfeed items per call';
  end if;

  select id into v_world_id from public.game_worlds where external_world_id = setup_id::bigint order by id limit 1;
  if v_world_id is null then
    raise exception 'No archived Soccer Manager world %', setup_id;
  end if;

  with parsed as (
    select distinct on (item_source_id) *
    from (
      select
        r->>'id' as item_source_id,
        public.sm_market_int(r->>'type', 0, 1000)::integer as item_type,
        case when coalesce(r->>'postedAt', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then (r->>'postedAt')::timestamptz end as posted_at,
        left(nullif(trim(r->>'title'), ''), 300) as title,
        left(nullif(trim(r->>'message'), ''), 2000) as message,
        coalesce(public.sm_market_int(r->>'commentCount', 0, 100000)::integer, 0) as comment_count,
        case when coalesce(r->>'playerId', '') ~ '^[1-9][0-9]{0,19}$' then r->>'playerId' end as player_source_id,
        left(nullif(trim(r->>'playerName'), ''), 160) as player_name,
        public.sm_market_int(r->>'rating', 1, 120)::integer as rating,
        left(nullif(trim(r->>'positionLabel'), ''), 40) as position_label,
        public.sm_market_int(r->>'positionId', 0, 2147483647)::integer as position_id,
        public.sm_market_int(r->>'fee', 0, 10000000000) as fee,
        case when coalesce(r->>'clubDataId', '') ~ '^[1-9][0-9]{0,19}$' then r->>'clubDataId' end as club_data_id,
        left(nullif(trim(r->>'clubName'), ''), 160) as club_name,
        case when coalesce(r->>'otherClubDataId', '') ~ '^[1-9][0-9]{0,19}$' then r->>'otherClubDataId' end as other_club_data_id,
        left(nullif(trim(r->>'otherClubName'), ''), 160) as other_club_name,
        case when coalesce(r->>'managerId', '') ~ '^[1-9][0-9]{0,19}$' then r->>'managerId' end as manager_source_id,
        left(nullif(trim(r->>'managerName'), ''), 160) as manager_name,
        case when jsonb_typeof(r->'comments') = 'array' then (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', c->>'id',
            'customerId', case when coalesce(c->>'customerId', '') ~ '^[1-9][0-9]{0,19}$' then c->>'customerId' end,
            'name', left(nullif(trim(c->>'name'), ''), 120),
            'text', left(nullif(trim(c->>'text'), ''), 1000),
            'date', left(nullif(trim(c->>'date'), ''), 40)
          ) order by ord), '[]'::jsonb)
          from jsonb_array_elements(r->'comments') with ordinality cs(c, ord)
          where ord <= 60 and jsonb_typeof(c) = 'object' and nullif(trim(c->>'text'), '') is not null
        ) end as comments
      from jsonb_array_elements(target_items) r
      where jsonb_typeof(r) = 'object' and coalesce(r->>'id', '') ~ '^[1-9][0-9]{0,19}$'
    ) rows
    where item_type is not null and posted_at is not null
    order by item_source_id
  ),
  counted as (
    select count(*) filter (where not exists (
      select 1 from public.soccer_manager_newsfeed n where n.game_world_id = v_world_id and n.item_source_id = p.item_source_id
    )) as added, count(*) as items
    from parsed p
  ),
  saved as (
    insert into public.soccer_manager_newsfeed as n (
      game_world_id, item_source_id, item_type, posted_at, title, message, comment_count, player_source_id, player_name,
      rating, position_label, position_id, fee, club_data_id, club_name, other_club_data_id, other_club_name,
      manager_source_id, manager_name, comments, first_seen_at, last_seen_at
    )
    select v_world_id, p.item_source_id, p.item_type, p.posted_at, p.title, p.message, p.comment_count, p.player_source_id, p.player_name,
           p.rating, p.position_label, p.position_id, p.fee, p.club_data_id, p.club_name, p.other_club_data_id, p.other_club_name,
           p.manager_source_id, p.manager_name, p.comments, v_now, v_now
    from parsed p
    on conflict (game_world_id, item_source_id) do update set
      item_type = excluded.item_type,
      posted_at = excluded.posted_at,
      title = excluded.title,
      message = excluded.message,
      comment_count = excluded.comment_count,
      player_source_id = excluded.player_source_id,
      player_name = excluded.player_name,
      rating = excluded.rating,
      position_label = excluded.position_label,
      position_id = excluded.position_id,
      fee = excluded.fee,
      club_data_id = excluded.club_data_id,
      club_name = excluded.club_name,
      other_club_data_id = excluded.other_club_data_id,
      other_club_name = excluded.other_club_name,
      manager_source_id = excluded.manager_source_id,
      manager_name = excluded.manager_name,
      comments = coalesce(excluded.comments, n.comments),
      last_seen_at = excluded.last_seen_at
    returning 1
  )
  select c.items, c.added into v_items, v_added
  from counted c, (select count(*) from saved) s;

  return jsonb_build_object('items', coalesce(v_items, 0), 'added', coalesce(v_added, 0));
end;
$$;

revoke all on function public.save_soccer_manager_newsfeed(text, jsonb) from public, anon;
grant execute on function public.save_soccer_manager_newsfeed(text, jsonb) to authenticated, service_role;
