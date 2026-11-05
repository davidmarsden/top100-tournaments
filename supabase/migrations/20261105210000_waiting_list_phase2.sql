-- Waiting list phase 2 (rulebook 3.3).
--  1. Gold and game worlds for applicants without a club in our worlds: Sync everything reads their
--     Soccer Manager profiles (the same profile_mpOverview it reads for current managers) for the SM
--     manager ids waiting_list_profile_targets() names, and record_waiting_list_profiles() saves them.
--  2. Taking a club: when the records check saves a new open spell at a club in a world (Soccer
--     Manager's own profile history) for a manager on that world's waiting list, the entry is marked
--     appointed and, if they have no Manager Account yet, a pending claim for that club is opened
--     for the administrators to approve as usual.
--  3. Offer emails: waiting_list_offer_details() gives the offer email's details to the Netlify
--     function that sends it, and waiting_list_offer_emailed() records the send; officials only.
-- SQL function bodies depend on Manager Lab objects, so they are not checked here.
set check_function_bodies = false;

alter table public.waiting_list_entries
  add column if not exists checked_gold boolean,
  add column if not exists checked_game_worlds integer check (checked_game_worlds is null or checked_game_worlds between 0 and 500),
  add column if not exists checked_at timestamptz,
  add column if not exists offer_emailed_at timestamptz;

-- Each open entry's Soccer Manager manager id: the one the administrators entered, otherwise the
-- one on a recorded club spell under the same name.
create or replace function public.waiting_list_sm_ids()
returns table (entry_id bigint, sm_manager_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select entry.id, coalesce(entry.sm_manager_id,
    (select max(stint.sm_manager_id) from public.soccer_manager_manager_stints stint
     where lower(btrim(stint.manager_name)) = lower(btrim(entry.sm_manager_name))))
  from public.waiting_list_entries entry
  where entry.status in ('waiting', 'offered');
$$;

revoke all on function public.waiting_list_sm_ids() from public, anon, authenticated;

-- @permissions private public.waiting_list_sm_ids: used only by the waiting list functions below

-- For Sync everything: the SM manager ids whose profiles to read (open entries not read in the last day).
create or replace function public.waiting_list_profile_targets()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can read the waiting list.'; end if;
  return coalesce((select array_agg(distinct ids.sm_manager_id)
    from public.waiting_list_sm_ids() ids
    join public.waiting_list_entries entry on entry.id = ids.entry_id
    where ids.sm_manager_id ~ '^[0-9]{1,20}$'
      and (entry.checked_at is null or entry.checked_at < now() - interval '20 hours')), '{}');
end;
$$;

revoke all on function public.waiting_list_profile_targets() from public, anon;
grant execute on function public.waiting_list_profile_targets() to authenticated;

-- Save profile readings: [{ "cid": "123", "isGM": 1, "gmDays": 200, "numGameWorlds": 4 }, ...].
-- Gold counts when the profile says Gold or shows days of Gold left.
create or replace function public.record_waiting_list_profiles(p_profiles jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can update the waiting list.'; end if;
  if jsonb_typeof(coalesce(p_profiles, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_profiles, '[]'::jsonb)) > 500 then
    raise exception 'Expected a list of up to 500 profiles.';
  end if;
  with readings as (
    select profile->>'cid' as cid,
      case when coalesce(profile->>'isGM', '') in ('1', 'true') or coalesce((profile->>'gmDays')::numeric, 0) > 0 then true
           when profile ? 'isGM' or profile ? 'gmDays' then false end as gold,
      case when (profile->>'numGameWorlds') ~ '^[0-9]{1,3}$' then (profile->>'numGameWorlds')::integer end as game_worlds
    from jsonb_array_elements(coalesce(p_profiles, '[]'::jsonb)) profile
    where profile->>'cid' ~ '^[0-9]{1,20}$'
  )
  update public.waiting_list_entries entry set
    checked_gold = readings.gold,
    checked_game_worlds = readings.game_worlds,
    checked_at = now(),
    sm_manager_id = coalesce(entry.sm_manager_id, readings.cid),
    updated_at = now()
  from public.waiting_list_sm_ids() ids
  join readings on readings.cid = ids.sm_manager_id
  where entry.id = ids.entry_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.record_waiting_list_profiles(jsonb) from public, anon;
grant execute on function public.record_waiting_list_profiles(jsonb) to authenticated;

-- A new open spell at a club: close the matching waiting-list entry for that world and, for an
-- applicant without a Manager Account, open a claim for the club. Never blocks the records check.
create or replace function public.waiting_list_on_new_stint()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.waiting_list_entries%rowtype;
begin
  if new.ended_at is not null then return new; end if;
  begin
    for v_entry in
      select * from public.waiting_list_entries entry
      where entry.game_world_id = new.game_world_id and entry.status in ('waiting', 'offered')
        and (entry.sm_manager_id = new.sm_manager_id or lower(btrim(entry.sm_manager_name)) = lower(btrim(new.manager_name)))
        and new.started_at >= entry.created_at - interval '14 days'
    loop
      update public.waiting_list_entries set
        status = 'appointed', sm_manager_id = coalesce(sm_manager_id, new.sm_manager_id),
        offer_club = new.club_name, updated_at = now()
      where id = v_entry.id;
      if not exists (select 1 from public.manager_portal_accounts account where account.auth_user_id = v_entry.auth_user_id and account.active)
         and not exists (select 1 from public.manager_portal_claims claim where claim.auth_user_id = v_entry.auth_user_id and claim.status = 'pending') then
        begin
          insert into public.manager_portal_claims as claim (auth_user_id, email, game_world_id, claimed_manager_name, claimed_club_name, status)
          values (v_entry.auth_user_id, v_entry.email, new.game_world_id, new.manager_name, new.club_name, 'pending')
          on conflict (auth_user_id) do update set
            game_world_id = excluded.game_world_id, claimed_manager_name = excluded.claimed_manager_name,
            claimed_club_name = excluded.claimed_club_name, status = 'pending', review_notes = null,
            reviewed_by = null, reviewed_at = null, updated_at = now();
        exception when others then
          raise warning 'waiting list: could not open a claim for entry %: %', v_entry.id, sqlerrm;
        end;
      end if;
    end loop;
  exception when others then
    raise warning 'waiting list: new spell not matched: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.waiting_list_on_new_stint() from public, anon, authenticated;

-- @permissions private public.waiting_list_on_new_stint: trigger function, run by the records check's saves only

drop trigger if exists waiting_list_on_new_stint on public.soccer_manager_manager_stints;
create trigger waiting_list_on_new_stint
  after insert on public.soccer_manager_manager_stints
  for each row execute function public.waiting_list_on_new_stint();

-- The applicant's own entries, now with the club they have taken (to link it to their account).
create or replace function public.my_waiting_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'world', world.slug, 'worldName', world.name, 'worldId', world.id,
      'managerName', entry.sm_manager_name, 'status', entry.status,
      'joinedAt', entry.created_at, 'confirmedSeason', entry.confirmed_season,
      'season', public.appointment_current_season(world.slug),
      'needsConfirming', entry.status = 'waiting' and coalesce(entry.confirmed_season, 0) < coalesce(public.appointment_current_season(world.slug), 0),
      'place', position.place, 'waiting', position.waiting,
      'offer', case when entry.status = 'offered' then jsonb_build_object('club', entry.offer_club, 'deadline', entry.offer_deadline) end,
      -- Once they have taken a club: the club, so the Portal can offer to link it to their account.
      'club', case when entry.status = 'appointed' then entry.offer_club end
    ) order by world.display_order), '[]'::jsonb)
  from public.waiting_list_entries entry
  join public.game_worlds world on world.id = entry.game_world_id
  left join lateral public.waiting_list_positions(entry.game_world_id) position on position.entry_id = entry.id
  where entry.auth_user_id = auth.uid();
$$;

revoke all on function public.my_waiting_list() from public, anon;
grant execute on function public.my_waiting_list() to authenticated;

-- The offer email's details, for the Netlify function that sends it (officials only). Reading them
-- changes nothing; the function records the send with waiting_list_offer_emailed() once the email
-- provider has accepted it.
create or replace function public.waiting_list_offer_details(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can send offers.'; end if;
  select jsonb_build_object('email', entry.email, 'managerName', entry.sm_manager_name, 'club', entry.offer_club,
    'deadline', entry.offer_deadline, 'world', (select name from public.game_worlds where id = entry.game_world_id))
  into v_result
  from public.waiting_list_entries entry
  where entry.id = p_id and entry.status = 'offered' and entry.offer_club is not null and entry.email is not null;
  if v_result is null then raise exception 'That entry has no open offer with an email address.'; end if;
  return v_result;
end;
$$;

revoke all on function public.waiting_list_offer_details(bigint) from public, anon;
grant execute on function public.waiting_list_offer_details(bigint) to authenticated;

-- Record that the offer email went (after the email provider accepted it).
create or replace function public.waiting_list_offer_emailed(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can send offers.'; end if;
  update public.waiting_list_entries set offer_emailed_at = now() where id = p_id and status = 'offered';
end;
$$;

revoke all on function public.waiting_list_offer_emailed(bigint) from public, anon;
grant execute on function public.waiting_list_offer_emailed(bigint) to authenticated;

create or replace function public.waiting_list_admin(p_world_slug text default 'top-100')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  -- The average length of a Top 100 Regen season so far, in days: the time since the world's first
  -- recorded club spell, over the seasons played (completed seasons plus the share of the current
  -- one). Regen's league history only holds the current season, so time at a club is the measure.
  v_regen_start timestamptz := (select min(stint.started_at) from public.soccer_manager_manager_stints stint where stint.game_world_id = 2);
  v_regen_played numeric := (select (max(regen.season) - 1) + least(1, avg(regen.played) / 38.0) from public.public_league_season_rows('regen') regen);
  v_regen_season_days numeric := case when v_regen_played > 0 then extract(epoch from now() - v_regen_start) / 86400 / v_regen_played end;
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
          -- Gold and game worlds: the administrators' entry wins, otherwise the latest reading, from a
          -- records check of their club or of their profile while on the waiting list.
          'gold', coalesce(entry.gold, latest.gold), 'goldFrom', case when entry.gold is not null then 'admin' when latest.gold is not null then 'records' end,
          'gameWorlds', coalesce(entry.game_worlds, latest.game_worlds), 'gameWorldsFrom', case when entry.game_worlds is not null then 'admin' when latest.game_worlds is not null then 'records' end,
          'checkedAt', latest.at, 'offerEmailedAt', entry.offer_emailed_at,
          'stints', coalesce(stints.list, '[]'::jsonb),
          -- Seasons managed in Top 100 Regen: time at Regen clubs over the average season length, to the nearest season.
          'regenSeasons', coalesce(round(stints.regen_days / nullif(v_regen_season_days, 0)), 0),
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
            sum(extract(epoch from coalesce(stint.ended_at, now()) - stint.started_at) / 86400) filter (where stint.game_world_id = 2) as regen_days,
            jsonb_agg(jsonb_build_object('world', stint.game_world_id, 'club', stint.club_name, 'from', stint.started_at, 'to', stint.ended_at, 'games', stint.games)
                      order by stint.started_at) as list
          from public.soccer_manager_manager_stints stint
          where lower(btrim(stint.manager_name)) = lower(btrim(entry.sm_manager_name))
             or (entry.sm_manager_id is not null and stint.sm_manager_id = entry.sm_manager_id)
        ) stints on true
        left join lateral (
          select snapshot.gold, snapshot.game_worlds, snapshot.captured_at
          from public.manager_signal_snapshots snapshot
          where snapshot.sm_manager_id = coalesce(entry.sm_manager_id, stints.sm_manager_id)
          order by snapshot.captured_at desc limit 1
        ) signal on true
        cross join lateral (
          select case when entry.checked_at is not null and (signal.captured_at is null or entry.checked_at >= signal.captured_at)
                      then entry.checked_gold else signal.gold end as gold,
                 case when entry.checked_at is not null and (signal.captured_at is null or entry.checked_at >= signal.captured_at)
                      then entry.checked_game_worlds else signal.game_worlds end as game_worlds,
                 greatest(entry.checked_at, signal.captured_at) as at
        ) latest
        where entry.game_world_id = v_world
      ) sub), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.waiting_list_admin(text) from public, anon;
grant execute on function public.waiting_list_admin(text) to authenticated;
