-- World Club Cup: knockout round templates, and results filled automatically
-- from Soccer Manager friendlies saved by SM Sync.

-- Knockout rounds after the league phase. Every round is two legs:
-- aggregate, then away goals, then Fictional Extra Time.
insert into public.tournament_formats (name, description, has_group_stage, has_knockout_stage, has_secondary_bracket, legs_group_stage, legs_knockout_stage, notes)
select 'World Club Cup League Phase',
       'One table of every club (6 matchdays), then the World Club Cup and Shield knockouts.',
       false, true, true, 1, 2,
       'Table 1-8: Cup last 16. 9-24: Cup knockout play-off. 25-56: Shield last 32.'
where not exists (select 1 from public.tournament_formats where name = 'World Club Cup League Phase');

insert into public.tournament_round_templates (format_id, bracket, round_name, round_order, legs, away_goals, fictional_extra_time, notes)
select f.id, r.bracket, r.round_name, r.round_order, 2, true, true, r.notes
from public.tournament_formats f
cross join (values
  ('Cup', 'Play-off', 1, 'League 9-24: 9 v 24, 10 v 23 ...'),
  ('Cup', 'R16', 2, 'League 1-8 v play-off winners'),
  ('Cup', 'QF', 3, null),
  ('Cup', 'SF', 4, null),
  ('Cup', 'Final', 5, null),
  ('Shield', 'R32', 1, 'League 25-56: 25 v 56, 26 v 55 ...'),
  ('Shield', 'R16', 2, null),
  ('Shield', 'QF', 3, null),
  ('Shield', 'SF', 4, null),
  ('Shield', 'Final', 5, null)
) as r(bracket, round_name, round_order, notes)
where f.name = 'World Club Cup League Phase'
  and not exists (select 1 from public.tournament_round_templates t where t.format_id = f.id and t.bracket = r.bracket and t.round_name = r.round_name);

-- Apply one Soccer Manager friendly to the matching World Club Cup fixture.
-- A fixture matches when the same clubs played with the same club at home,
-- between 7 days before and 28 days after the fixture's Wednesday. Only
-- scheduled or postponed fixtures are filled, or fixtures already filled from
-- this same Soccer Manager match (a later capture can correct them). Locked
-- fixtures and those decided by forfeit are never touched.
-- Returns the number of fixtures updated (0 or 1).
create or replace function public.apply_sm_friendly_to_league_phase(snapshot_id bigint)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s record;
  played date;
  target record;
  hp numeric; ap numeric; hst integer; ast integer;
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

  select m.id, m.fixture_date, m.source_id, m.home_score, m.away_score into target
  from public.matches m
  join public.tournaments t on t.id = m.tournament_id
  join public.tournament_entries he on he.id = m.home_entry_id
  join public.tournament_entries ae on ae.id = m.away_entry_id
  where t.tournament_structure = 'league_knockout'
    and t.archived_at is null
    and t.game_world_id = s.game_world_id
    and he.team_id = s.home_team_id
    and ae.team_id = s.away_team_id
    and coalesce(m.locked, false) = false
    and (m.status in ('scheduled', 'postponed') or (m.decided_by = 'sm_sync' and m.source_id = 'sm:' || s.source_fixture_id))
    and (m.fixture_date is null or played between m.fixture_date - 7 and m.fixture_date + 28)
    -- A Soccer Manager match fills one fixture only.
    and not exists (select 1 from public.matches o where o.source_id = 'sm:' || s.source_fixture_id and o.id <> m.id)
  order by abs(coalesce(played - m.fixture_date, 0)), m.fixture_date, m.id
  limit 1;

  if target.id is null then return 0; end if;
  if target.source_id = 'sm:' || s.source_fixture_id and target.home_score = s.home_score and target.away_score = s.away_score then
    return 0; -- already filled from this capture
  end if;

  hp := nullif(s.source_data #>> '{stats,home,possession}', '')::numeric;
  ap := nullif(s.source_data #>> '{stats,away,possession}', '')::numeric;
  hst := nullif(s.source_data #>> '{stats,home,shotsOnTarget}', '')::integer;
  ast := nullif(s.source_data #>> '{stats,away,shotsOnTarget}', '')::integer;

  update public.matches m
     set home_score = s.home_score,
         away_score = s.away_score,
         home_normal_time_score = s.home_score,
         away_normal_time_score = s.away_score,
         home_possession = case when hp between 0 and 100 then hp end,
         away_possession = case when ap between 0 and 100 then ap end,
         home_shots_on_target = case when hst >= 0 then hst end,
         away_shots_on_target = case when ast >= 0 then ast end,
         winner_entry_id = case when s.home_score > s.away_score then m.home_entry_id when s.away_score > s.home_score then m.away_entry_id end,
         loser_entry_id = case when s.home_score > s.away_score then m.away_entry_id when s.away_score > s.home_score then m.home_entry_id end,
         status = 'played',
         decided_by = 'sm_sync',
         source_id = 'sm:' || s.source_fixture_id,
         played_at = played::timestamptz,
         notes = 'Result from SM Sync (Soccer Manager fixture ' || s.source_fixture_id || ')'
   where m.id = target.id;

  insert into public.audit_log (action, entity_type, entity_id, new_data, changed_by, created_at)
  values ('sm_sync_result', 'match', target.id,
          jsonb_build_object('snapshot_id', s.id, 'fixture', s.source_fixture_id, 'home_score', s.home_score, 'away_score', s.away_score, 'played', played),
          'sm_sync', now());
  return 1;
end;
$$;

revoke all on function public.apply_sm_friendly_to_league_phase(bigint) from public;
-- @permissions private public.apply_sm_friendly_to_league_phase(bigint): called only by the snapshot trigger and apply_sm_results_to_tournament()

create or replace function public.sm_friendly_snapshot_to_league_phase()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.competition_code = 'friendly' then
    begin
      perform public.apply_sm_friendly_to_league_phase(new.id);
    exception when others then
      -- Never block Sync: a failed match-up is left for the organiser's "Check SM Sync" button.
      raise warning 'World Club Cup result from SM Sync failed for snapshot %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

revoke all on function public.sm_friendly_snapshot_to_league_phase() from public;

drop trigger if exists sm_friendly_snapshot_to_league_phase on public.soccer_manager_match_snapshots;
create trigger sm_friendly_snapshot_to_league_phase
  after insert on public.soccer_manager_match_snapshots
  for each row execute function public.sm_friendly_snapshot_to_league_phase();

-- Organiser button: apply every saved friendly that fits an open fixture.
create or replace function public.apply_sm_results_to_tournament(target_tournament_id bigint)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t record;
  snap record;
  applied integer := 0;
begin
  if not public.can_manage_tournament(target_tournament_id) then
    raise exception 'Only tournament organisers can check SM Sync for results.';
  end if;
  select * into t from public.tournaments where id = target_tournament_id;
  if t.id is null then raise exception 'Tournament % not found.', target_tournament_id; end if;
  for snap in
    select s.id
    from public.soccer_manager_match_snapshots s
    where s.game_world_id = t.game_world_id
      and s.competition_code = 'friendly'
      and coalesce(nullif(s.source_data #>> '{fixture,date}', '')::date, s.captured_at::date)
          >= coalesce(t.league_first_matchday, current_date) - 7
      and exists (select 1 from public.tournament_entries e where e.tournament_id = t.id and e.team_id = s.home_team_id)
    order by s.captured_at, s.id
  loop
    applied := applied + public.apply_sm_friendly_to_league_phase(snap.id);
  end loop;
  return applied;
end;
$$;

revoke all on function public.apply_sm_results_to_tournament(bigint) from public;
grant execute on function public.apply_sm_results_to_tournament(bigint) to authenticated;

-- What still needs the organiser: fixtures past their Wednesday with no
-- result, and friendlies played the wrong way round (home and away swapped),
-- which are never applied automatically.
create or replace function public.league_phase_result_issues(target_tournament_id bigint)
returns table (match_id bigint, stage text, bracket text, round text, leg integer, fixture_date date,
               home_name text, away_name text, issue text, sm_fixture_id text, sm_home_score integer, sm_away_score integer, sm_played date)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.id, m.stage, m.bracket, m.round, m.leg, m.fixture_date, ht.name, at.name,
         case when sw.source_fixture_id is not null then 'played_reversed' else 'no_result' end,
         sw.source_fixture_id, sw.home_score, sw.away_score, sw.played
  from public.matches m
  join public.tournament_entries he on he.id = m.home_entry_id
  join public.tournament_entries ae on ae.id = m.away_entry_id
  join public.teams ht on ht.id = he.team_id
  join public.teams at on at.id = ae.team_id
  left join lateral (
    select s.source_fixture_id, s.home_score, s.away_score,
           coalesce(nullif(s.source_data #>> '{fixture,date}', '')::date, s.captured_at::date) played
    from public.soccer_manager_match_snapshots s
    where s.competition_code = 'friendly'
      and s.home_team_id = ae.team_id and s.away_team_id = he.team_id
      and (m.fixture_date is null or coalesce(nullif(s.source_data #>> '{fixture,date}', '')::date, s.captured_at::date) between m.fixture_date - 7 and m.fixture_date + 28)
      and not exists (select 1 from public.matches o where o.source_id = 'sm:' || s.source_fixture_id)
    order by s.captured_at desc limit 1
  ) sw on true
  where m.tournament_id = target_tournament_id
    and public.can_manage_tournament(target_tournament_id)
    and m.status in ('scheduled', 'postponed')
    and m.fixture_date < current_date
  order by m.fixture_date, m.match_order, m.leg;
$$;

revoke all on function public.league_phase_result_issues(bigint) from public;
grant execute on function public.league_phase_result_issues(bigint) to authenticated;
