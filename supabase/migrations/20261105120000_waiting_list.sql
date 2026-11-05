-- Waiting list for Top 100 and Top 100 Regen (rulebook 3.3). New and returning managers join
-- through a Manager Account: Soccer Manager manager name, game world(s), how they found Top 100 and
-- the rules agreement. Current managers can recommend an applicant or raise a concern (confidential
-- to the administrators). The administrators see the list with each applicant's records, score it
-- (scores are worked out on the admin page from Stats & History and saved here) and track offers.
-- SQL function bodies depend on Manager Lab objects, so they are not checked here.
set check_function_bodies = false;

create table if not exists public.waiting_list_entries (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  sm_manager_name text not null check (length(btrim(sm_manager_name)) between 1 and 80),
  how_found text check (how_found is null or length(how_found) <= 500),
  agreed_at timestamptz not null,
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'appointed', 'withdrawn', 'lapsed')),
  confirmed_season integer,
  -- Set by the administrators (or, later, the records check): the Top 100 manager record and the
  -- Soccer Manager manager id, and Gold and game worlds where the records check hasn't seen them.
  manager_id bigint references public.managers(id),
  sm_manager_id text,
  gold boolean,
  game_worlds integer check (game_worlds is null or game_worlds between 0 and 500),
  admin_notes text,
  -- The last scoring: returning Top 100 manager, score out of 100 and its parts.
  is_returning boolean not null default false,
  score numeric,
  score_parts jsonb,
  scored_at timestamptz,
  offer_club text,
  offer_deadline timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_world_id, auth_user_id)
);

create table if not exists public.waiting_list_endorsements (
  id bigint generated always as identity primary key,
  entry_id bigint not null references public.waiting_list_entries(id) on delete cascade,
  by_manager_id bigint not null references public.managers(id),
  by_auth_user uuid not null default auth.uid(),
  kind text not null check (kind in ('recommend', 'concern')),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, by_manager_id)
);

create index if not exists waiting_list_entries_world_status on public.waiting_list_entries (game_world_id, status);

alter table public.waiting_list_entries enable row level security;
alter table public.waiting_list_endorsements enable row level security;
revoke all on public.waiting_list_entries, public.waiting_list_endorsements from public, anon, authenticated;

-- @permissions private public.waiting_list_entries: read and written only through the waiting list functions below
-- @permissions private public.waiting_list_endorsements: read and written only through the waiting list functions below

-- Place in the queue among waiting entries: returning managers first, then score, then date joined.
create or replace function public.waiting_list_positions(p_world_id bigint)
returns table (entry_id bigint, place integer, waiting integer)
language sql
stable
security definer
set search_path = ''
as $$
  select entry.id,
    (row_number() over (order by entry.is_returning desc, entry.score desc nulls last, entry.created_at))::integer,
    (count(*) over ())::integer
  from public.waiting_list_entries entry
  where entry.game_world_id = p_world_id and entry.status = 'waiting';
$$;

revoke all on function public.waiting_list_positions(bigint) from public, anon, authenticated;

-- @permissions private public.waiting_list_positions: used only by the waiting list functions below

-- ── Applicants ──────────────────────────────────────────────────────────────

-- Join (or rejoin) the list for one or more game worlds. A manager already running a club in a
-- game world can't join that world's list.
create or replace function public.join_waiting_list(p_world_slugs text[], p_sm_manager_name text, p_how_found text default null, p_agree boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_name text := btrim(coalesce(p_sm_manager_name, ''));
  v_slug text;
  v_world bigint;
  v_my_manager bigint := public.appointment_my_manager_id();
begin
  if v_user is null then raise exception 'Sign in to join the waiting list.'; end if;
  if not coalesce(p_agree, false) then raise exception 'Please accept the rules agreement to join the waiting list.'; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'Enter your Soccer Manager manager name.'; end if;
  if coalesce(array_length(p_world_slugs, 1), 0) = 0 then raise exception 'Choose at least one game world.'; end if;
  select email into v_email from auth.users where id = v_user;

  foreach v_slug in array p_world_slugs loop
    v_world := public.appointment_world_id(v_slug);
    if v_world is null or v_slug not in ('top-100', 'regen') then raise exception 'Unknown game world: %', v_slug; end if;
    if v_my_manager is not null and exists (
      select 1 from public.manager_game_world_memberships membership
      where membership.manager_id = v_my_manager and membership.game_world_id = v_world and membership.active
    ) then
      raise exception 'You already manage a club in %.', (select name from public.game_worlds where id = v_world);
    end if;
    insert into public.waiting_list_entries as entry (game_world_id, auth_user_id, email, sm_manager_name, how_found, agreed_at, status, confirmed_season, manager_id)
    values (v_world, v_user, v_email, v_name, nullif(btrim(coalesce(p_how_found, '')), ''), now(), 'waiting',
            public.appointment_current_season(v_slug), v_my_manager)
    on conflict (game_world_id, auth_user_id) do update set
      email = excluded.email,
      sm_manager_name = excluded.sm_manager_name,
      how_found = coalesce(excluded.how_found, entry.how_found),
      agreed_at = excluded.agreed_at,
      confirmed_season = excluded.confirmed_season,
      manager_id = coalesce(entry.manager_id, excluded.manager_id),
      -- Rejoining after leaving or lapsing starts a new place; an offer or appointment stands.
      status = case when entry.status in ('withdrawn', 'lapsed') then 'waiting' else entry.status end,
      created_at = case when entry.status in ('withdrawn', 'lapsed') then now() else entry.created_at end,
      updated_at = now();
  end loop;
  return public.my_waiting_list();
end;
$$;

revoke all on function public.join_waiting_list(text[], text, text, boolean) from public, anon;
grant execute on function public.join_waiting_list(text[], text, text, boolean) to authenticated;

-- The signed-in applicant's entries, with their place in the queue.
create or replace function public.my_waiting_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'world', world.slug, 'worldName', world.name,
      'managerName', entry.sm_manager_name, 'status', entry.status,
      'joinedAt', entry.created_at, 'confirmedSeason', entry.confirmed_season,
      'season', public.appointment_current_season(world.slug),
      'needsConfirming', entry.status = 'waiting' and coalesce(entry.confirmed_season, 0) < coalesce(public.appointment_current_season(world.slug), 0),
      'place', position.place, 'waiting', position.waiting,
      'offer', case when entry.status = 'offered' then jsonb_build_object('club', entry.offer_club, 'deadline', entry.offer_deadline) end
    ) order by world.display_order), '[]'::jsonb)
  from public.waiting_list_entries entry
  join public.game_worlds world on world.id = entry.game_world_id
  left join lateral public.waiting_list_positions(entry.game_world_id) position on position.entry_id = entry.id
  where entry.auth_user_id = auth.uid();
$$;

revoke all on function public.my_waiting_list() from public, anon;
grant execute on function public.my_waiting_list() to authenticated;

-- Confirm interest for this season (p_withdraw = false) or leave the list (p_withdraw = true).
create or replace function public.update_my_waiting_list(p_world_slug text, p_withdraw boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  update public.waiting_list_entries entry set
    status = case when p_withdraw then 'withdrawn' else entry.status end,
    confirmed_season = case when p_withdraw then entry.confirmed_season else public.appointment_current_season(p_world_slug) end,
    updated_at = now()
  where entry.auth_user_id = auth.uid() and entry.game_world_id = v_world and entry.status in ('waiting', 'offered');
  if not found then raise exception 'You are not on that waiting list.'; end if;
  return public.my_waiting_list();
end;
$$;

revoke all on function public.update_my_waiting_list(text, boolean) from public, anon;
grant execute on function public.update_my_waiting_list(text, boolean) to authenticated;

-- ── Current managers ────────────────────────────────────────────────────────

-- Applicants waiting in either game world, for current managers to recommend or raise a concern.
-- Each manager sees only their own recommendation or concern, never anyone else's.
create or replace function public.waiting_list_for_managers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_manager bigint := public.appointment_my_manager_id();
begin
  if v_manager is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', entry.id, 'world', world.slug, 'worldName', world.name, 'managerName', entry.sm_manager_name,
      'joinedAt', entry.created_at,
      'mine', (select jsonb_build_object('kind', endorsement.kind, 'note', endorsement.note)
               from public.waiting_list_endorsements endorsement
               where endorsement.entry_id = entry.id and endorsement.by_manager_id = v_manager)
    ) order by world.display_order, entry.sm_manager_name)
    from public.waiting_list_entries entry
    join public.game_worlds world on world.id = entry.game_world_id
    where entry.status in ('waiting', 'offered') and entry.auth_user_id <> auth.uid()), '[]'::jsonb);
end;
$$;

revoke all on function public.waiting_list_for_managers() from public, anon;
grant execute on function public.waiting_list_for_managers() to authenticated;

-- Recommend (p_kind 'recommend'), raise a concern ('concern') or take either back (null).
create or replace function public.endorse_waiting_list_entry(p_entry_id bigint, p_kind text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_manager bigint := public.appointment_my_manager_id();
begin
  if v_manager is null then raise exception 'Only current managers with a Manager Account can recommend or raise a concern.'; end if;
  if p_kind is not null and p_kind not in ('recommend', 'concern') then raise exception 'Unknown choice.'; end if;
  if not exists (select 1 from public.waiting_list_entries entry
                 where entry.id = p_entry_id and entry.status in ('waiting', 'offered') and entry.auth_user_id <> auth.uid()) then
    raise exception 'That applicant is not on the waiting list.';
  end if;
  if p_kind is null then
    delete from public.waiting_list_endorsements where entry_id = p_entry_id and by_manager_id = v_manager;
  else
    insert into public.waiting_list_endorsements as endorsement (entry_id, by_manager_id, by_auth_user, kind, note)
    values (p_entry_id, v_manager, auth.uid(), p_kind, nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (entry_id, by_manager_id) do update set kind = excluded.kind, note = excluded.note, by_auth_user = excluded.by_auth_user, updated_at = now();
  end if;
  return public.waiting_list_for_managers();
end;
$$;

revoke all on function public.endorse_waiting_list_entry(bigint, text, text) from public, anon;
grant execute on function public.endorse_waiting_list_entry(bigint, text, text) to authenticated;

-- ── Administrators ──────────────────────────────────────────────────────────

-- The list for one game world with everything the administrators need to score it: Soccer Manager
-- stints and Regen seasons found by manager name, Gold and game worlds from the latest records check
-- (or the administrators' own entry), recommendations and concerns, and the saved score and place.
create or replace function public.waiting_list_admin(p_world_slug text default 'top-100')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can see the waiting list.'; end if;
  return jsonb_build_object(
    'world', p_world_slug,
    'season', public.appointment_current_season(p_world_slug),
    'entries', coalesce((select jsonb_agg(row_json order by (row_json->>'sortStatus')::integer, (row_json->>'place')::integer nulls last, row_json->>'joinedAt')
      from (
        select jsonb_build_object(
          'id', entry.id, 'managerName', entry.sm_manager_name, 'email', entry.email, 'howFound', entry.how_found,
          'status', entry.status, 'joinedAt', entry.created_at, 'agreedAt', entry.agreed_at,
          'confirmedSeason', entry.confirmed_season, 'managerId', entry.manager_id, 'smManagerId', coalesce(entry.sm_manager_id, stints.sm_manager_id),
          'adminNotes', entry.admin_notes, 'offerClub', entry.offer_club, 'offerDeadline', entry.offer_deadline,
          'returning', entry.is_returning, 'score', entry.score, 'scoreParts', entry.score_parts, 'scoredAt', entry.scored_at,
          'place', position.place,
          'sortStatus', case entry.status when 'offered' then 0 when 'waiting' then 1 when 'appointed' then 2 else 3 end,
          -- Gold and game worlds: the administrators' entry wins, otherwise the latest records check.
          'gold', coalesce(entry.gold, signal.gold), 'goldFrom', case when entry.gold is not null then 'admin' when signal.gold is not null then 'records' end,
          'gameWorlds', coalesce(entry.game_worlds, signal.game_worlds), 'gameWorldsFrom', case when entry.game_worlds is not null then 'admin' when signal.game_worlds is not null then 'records' end,
          'stints', coalesce(stints.list, '[]'::jsonb),
          'regenSeasons', (select count(distinct regen.season) from public.public_league_season_rows('regen') regen
                           where lower(btrim(regen.manager)) = lower(btrim(entry.sm_manager_name))),
          'endorsements', coalesce((select jsonb_agg(jsonb_build_object('kind', endorsement.kind, 'note', endorsement.note,
                              'by', coalesce(manager.display_name, manager.name), 'at', endorsement.updated_at) order by endorsement.updated_at)
                            from public.waiting_list_endorsements endorsement
                            left join public.managers manager on manager.id = endorsement.by_manager_id
                            where endorsement.entry_id = entry.id), '[]'::jsonb)
        ) as row_json
        from public.waiting_list_entries entry
        left join lateral public.waiting_list_positions(entry.game_world_id) position on position.entry_id = entry.id
        left join lateral (
          select max(stint.sm_manager_id) filter (where stint.sm_manager_id is not null) as sm_manager_id,
            jsonb_agg(jsonb_build_object('world', stint.game_world_id, 'club', stint.club_name, 'from', stint.started_at, 'to', stint.ended_at, 'games', stint.games)
                      order by stint.started_at) as list
          from public.soccer_manager_manager_stints stint
          where lower(btrim(stint.manager_name)) = lower(btrim(entry.sm_manager_name))
             or (entry.sm_manager_id is not null and stint.sm_manager_id = entry.sm_manager_id)
        ) stints on true
        left join lateral (
          select snapshot.gold, snapshot.game_worlds
          from public.manager_signal_snapshots snapshot
          where snapshot.sm_manager_id = coalesce(entry.sm_manager_id, stints.sm_manager_id)
          order by snapshot.captured_at desc limit 1
        ) signal on true
        where entry.game_world_id = v_world
      ) sub), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.waiting_list_admin(text) from public, anon;
grant execute on function public.waiting_list_admin(text) to authenticated;

-- Update one entry: status, links, Gold and game worlds, notes and offers. Keys left out are unchanged;
-- a key given as null clears it.
create or replace function public.update_waiting_list_entry(p_id bigint, p_fields jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can update the waiting list.'; end if;
  if p_fields ? 'status' and p_fields->>'status' not in ('waiting', 'offered', 'appointed', 'withdrawn', 'lapsed') then
    raise exception 'Unknown status.';
  end if;
  update public.waiting_list_entries entry set
    status = case when p_fields ? 'status' then p_fields->>'status' else entry.status end,
    manager_id = case when p_fields ? 'managerId' then (p_fields->>'managerId')::bigint else entry.manager_id end,
    sm_manager_id = case when p_fields ? 'smManagerId' then nullif(btrim(p_fields->>'smManagerId'), '') else entry.sm_manager_id end,
    gold = case when p_fields ? 'gold' then (p_fields->>'gold')::boolean else entry.gold end,
    game_worlds = case when p_fields ? 'gameWorlds' then (p_fields->>'gameWorlds')::integer else entry.game_worlds end,
    admin_notes = case when p_fields ? 'adminNotes' then nullif(btrim(p_fields->>'adminNotes'), '') else entry.admin_notes end,
    offer_club = case when p_fields ? 'offerClub' then nullif(btrim(p_fields->>'offerClub'), '') else entry.offer_club end,
    offer_deadline = case when p_fields ? 'offerDeadline' then (p_fields->>'offerDeadline')::timestamptz else entry.offer_deadline end,
    updated_at = now()
  where entry.id = p_id;
  if not found then raise exception 'No such waiting list entry.'; end if;
end;
$$;

revoke all on function public.update_waiting_list_entry(bigint, jsonb) from public, anon;
grant execute on function public.update_waiting_list_entry(bigint, jsonb) to authenticated;

-- Save the scores worked out on the admin page: { "<entry id>": { "score": n, "returning": bool, "parts": {...} } }.
create or replace function public.save_waiting_list_scores(p_world_slug text, p_scores jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_count integer;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can score the waiting list.'; end if;
  update public.waiting_list_entries entry set
    score = (scored.value->>'score')::numeric,
    is_returning = coalesce((scored.value->>'returning')::boolean, false),
    score_parts = scored.value->'parts',
    scored_at = now()
  from jsonb_each(coalesce(p_scores, '{}'::jsonb)) scored
  where entry.game_world_id = v_world and entry.id = scored.key::bigint;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.save_waiting_list_scores(text, jsonb) from public, anon;
grant execute on function public.save_waiting_list_scores(text, jsonb) to authenticated;
