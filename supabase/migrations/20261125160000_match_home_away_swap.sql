-- World Club Cup: home and away swapped by agreement.
--
-- Some managers cannot send Soccer Manager friendly invites (a manager in
-- Australia, for one, sees the wrong match day). The two managers can then
-- agree that the away club hosts the friendly in Soccer Manager. Either
-- manager records that in My Matches; the opponent is told and can undo it.
--
-- With a swap recorded:
--   * league_phase_sm_arrangements reports the reversed friendly as 'swapped'
--     (arranged), not 'reversed';
--   * apply_sm_friendly_to_league_phase applies its result to the fixture with
--     the score turned back round (the fixture's home club keeps its home goals).

alter table public.matches add column if not exists home_away_swapped_at timestamptz;
alter table public.matches add column if not exists home_away_swapped_by_entry_id bigint
  references public.tournament_entries(id) on delete set null;

create or replace function public.set_match_home_away_swap(p_match_id bigint, p_tournament_entry_id bigint, p_swapped boolean)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_match public.matches;
  v_other bigint;
  v_actor text;
  v_account bigint;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_match from public.matches
  where id = p_match_id and coalesce(lower(status), 'scheduled') not in ('played','forfeit','voided','cancelled')
  for update;
  if not found then raise exception 'This fixture is no longer active'; end if;
  if p_tournament_entry_id is distinct from v_match.home_entry_id and p_tournament_entry_id is distinct from v_match.away_entry_id then
    raise exception 'You no longer participate in this fixture';
  end if;
  if not exists (
    select 1 from public.tournament_entries e
    join public.manager_portal_accounts a on a.manager_id = e.manager_id and a.auth_user_id = v_user and a.active = true
    where e.id = p_tournament_entry_id
  ) then raise exception 'You do not manage this tournament entry'; end if;
  if coalesce(p_swapped, false) = (v_match.home_away_swapped_at is not null) then return v_match; end if;

  update public.matches
     set home_away_swapped_at = case when p_swapped then now() end,
         home_away_swapped_by_entry_id = case when p_swapped then p_tournament_entry_id end
   where id = p_match_id
  returning * into v_match;

  insert into public.audit_log (action, entity_type, entity_id, new_data, changed_by, created_at)
  values (case when p_swapped then 'home_away_swap_recorded' else 'home_away_swap_undone' end, 'match', p_match_id,
          jsonb_build_object('tournament_entry_id', p_tournament_entry_id), v_user::text, now());

  v_other := case when p_tournament_entry_id = v_match.home_entry_id then v_match.away_entry_id else v_match.home_entry_id end;
  v_actor := public.top100_entry_club_name(p_tournament_entry_id);
  for v_account in select public.top100_entry_accounts(v_other) loop
    perform public.enqueue_manager_notification(
      v_account, 'opponent_actions',
      'Your opponent: ' || v_actor,
      case when p_swapped
        then v_actor || ' has recorded that you agreed to swap home and away in Soccer Manager for ' || public.top100_entry_club_name(v_match.home_entry_id) || ' v ' || public.top100_entry_club_name(v_match.away_entry_id) || '. The result counts with the score the right way round. If you did not agree, undo it in My Matches and tell the organiser.'
        else v_actor || ' has undone the home and away swap for ' || public.top100_entry_club_name(v_match.home_entry_id) || ' v ' || public.top100_entry_club_name(v_match.away_entry_id) || '. The friendly should be hosted by ' || public.top100_entry_club_name(v_match.home_entry_id) || '.'
      end,
      '/',
      'swap:' || p_match_id || ':' || p_swapped || ':' || v_account || ':' || extract(epoch from now())::bigint
    );
  end loop;
  return v_match;
end;
$$;

revoke all on function public.set_match_home_away_swap(bigint, bigint, boolean) from public;
grant execute on function public.set_match_home_away_swap(bigint, bigint, boolean) to authenticated;

-- Arranged friendlies: a reversed friendly on the fixture's date is 'swapped' when a swap is recorded.
create or replace function public.league_phase_sm_arrangements(target_tournament_id bigint)
returns table (match_id bigint, sm_status text, sm_fixture_date date, sm_fixture_id text, sm_seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id,
         case when f.source_fixture_id is null then null
              when f.home_team_id = he.team_id and f.fixture_date = m.fixture_date then 'arranged'
              when f.home_team_id = ae.team_id and f.fixture_date = m.fixture_date
                then case when m.home_away_swapped_at is not null then 'swapped' else 'reversed' end
              else 'other_date' end,
         f.fixture_date, f.source_fixture_id, f.last_seen_at
  from public.matches m
  join public.tournaments t on t.id = m.tournament_id
  join public.tournament_entries he on he.id = m.home_entry_id
  join public.tournament_entries ae on ae.id = m.away_entry_id
  left join lateral (
    select s.* from public.soccer_manager_scheduled_fixtures s
    where s.game_world_id = t.game_world_id and s.cancelled_at is null
      and ((s.home_team_id = he.team_id and s.away_team_id = ae.team_id)
           or (s.home_team_id = ae.team_id and s.away_team_id = he.team_id and s.fixture_date = m.fixture_date))
      and (m.fixture_date is null or s.fixture_date between m.fixture_date - 7 and m.fixture_date + 28)
    order by (s.home_team_id = case when m.home_away_swapped_at is not null then ae.team_id else he.team_id end and s.fixture_date = m.fixture_date) desc,
             (s.fixture_date = m.fixture_date) desc,
             abs(s.fixture_date - coalesce(m.fixture_date, s.fixture_date)), s.source_fixture_id
    limit 1
  ) f on true
  where m.tournament_id = target_tournament_id and t.is_public = true;
$$;

revoke all on function public.league_phase_sm_arrangements(bigint) from public;
grant execute on function public.league_phase_sm_arrangements(bigint) to anon, authenticated;

-- Results: a friendly played the other way round fills a fixture with a recorded swap, score turned back round.
create or replace function public.apply_sm_friendly_to_league_phase(snapshot_id bigint)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s record;
  played date;
  target record;
  hp numeric; ap numeric; hst integer; ast integer;
  hs integer; aws integer;
  hside text; aside text;
begin
  select * into s from public.soccer_manager_match_snapshots where id = snapshot_id;
  if s.id is null or s.competition_code is distinct from 'friendly' then return 0; end if;
  if s.home_team_id is null or s.away_team_id is null or s.home_score is null or s.away_score is null then return 0; end if;
  -- Only the newest capture of a Soccer Manager match counts.
  if exists (select 1 from public.soccer_manager_match_snapshots n
             where n.game_world_id = s.game_world_id and n.source_fixture_id = s.source_fixture_id and n.source_version > s.source_version) then
    return 0;
  end if;

  played := coalesce(nullif(s.source_data #>> '{fixture,date}', '')::date, s.captured_at::date);

  select m.id, m.fixture_date, m.source_id, m.home_score, m.away_score,
         (he.team_id = s.away_team_id) as flipped into target
  from public.matches m
  join public.tournaments t on t.id = m.tournament_id
  join public.tournament_entries he on he.id = m.home_entry_id
  join public.tournament_entries ae on ae.id = m.away_entry_id
  where t.tournament_structure = 'league_knockout'
    and t.archived_at is null
    and t.game_world_id = s.game_world_id
    and ((he.team_id = s.home_team_id and ae.team_id = s.away_team_id)
         or (m.home_away_swapped_at is not null and he.team_id = s.away_team_id and ae.team_id = s.home_team_id))
    and coalesce(m.locked, false) = false
    and (m.status in ('scheduled', 'postponed') or (m.decided_by = 'sm_sync' and m.source_id = 'sm:' || s.source_fixture_id))
    and (m.fixture_date is null or played between m.fixture_date - 7 and m.fixture_date + 28)
    -- A Soccer Manager match fills one fixture only.
    and not exists (select 1 from public.matches o where o.source_id = 'sm:' || s.source_fixture_id and o.id <> m.id)
  -- Nearest fixture date first (two-legged ties have both orientations a week apart), then the unswapped orientation.
  order by abs(coalesce(played - m.fixture_date, 0)), (he.team_id = s.away_team_id), m.fixture_date, m.id
  limit 1;

  if target.id is null then return 0; end if;
  -- The fixture's own home and away, whichever club hosted in Soccer Manager.
  hs := case when target.flipped then s.away_score else s.home_score end;
  aws := case when target.flipped then s.home_score else s.away_score end;
  if target.source_id = 'sm:' || s.source_fixture_id and target.home_score = hs and target.away_score = aws then
    return 0; -- already filled from this capture
  end if;

  -- Soccer Manager's side for the fixture's home and away clubs.
  hside := case when target.flipped then 'away' else 'home' end;
  aside := case when target.flipped then 'home' else 'away' end;
  hp := nullif(s.source_data #>> array['stats', hside, 'possession'], '')::numeric;
  ap := nullif(s.source_data #>> array['stats', aside, 'possession'], '')::numeric;
  hst := nullif(s.source_data #>> array['stats', hside, 'shotsOnTarget'], '')::integer;
  ast := nullif(s.source_data #>> array['stats', aside, 'shotsOnTarget'], '')::integer;

  update public.matches m
     set home_score = hs,
         away_score = aws,
         home_normal_time_score = hs,
         away_normal_time_score = aws,
         home_possession = case when hp between 0 and 100 then hp end,
         away_possession = case when ap between 0 and 100 then ap end,
         home_shots_on_target = case when hst >= 0 then hst end,
         away_shots_on_target = case when ast >= 0 then ast end,
         winner_entry_id = case when hs > aws then m.home_entry_id when aws > hs then m.away_entry_id end,
         loser_entry_id = case when hs > aws then m.away_entry_id when aws > hs then m.home_entry_id end,
         status = 'played',
         decided_by = 'sm_sync',
         source_id = 'sm:' || s.source_fixture_id,
         played_at = played::timestamptz,
         notes = 'Result from SM Sync (Soccer Manager fixture ' || s.source_fixture_id || ')'
                 || case when target.flipped then '; home and away swapped by agreement' else '' end
   where m.id = target.id;

  insert into public.audit_log (action, entity_type, entity_id, new_data, changed_by, created_at)
  values ('sm_sync_result', 'match', target.id,
          jsonb_build_object('snapshot_id', s.id, 'fixture', s.source_fixture_id, 'home_score', hs, 'away_score', aws, 'played', played, 'swapped', target.flipped),
          'sm_sync', now());
  return 1;
end;
$function$;
