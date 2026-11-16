-- World Club Cup league phase (Champions League style).
-- A tournament with tournament_structure 'league_knockout' has one table of
-- every entrant (matches.stage = 'league'), then Cup and Shield knockouts
-- built from the final table. See src/lib/leaguePhase.js for the draw rules.

alter table public.tournaments drop constraint if exists tournaments_tournament_structure_check;
alter table public.tournaments add constraint tournaments_tournament_structure_check
  check (tournament_structure = any (array['group_knockout'::text, 'knockout_only'::text, 'league_knockout'::text]));

alter table public.tournaments add column if not exists league_draw_seed text;
alter table public.tournaments add column if not exists league_draw_at timestamptz;
alter table public.tournaments add column if not exists league_first_matchday date;

-- Enter every active club of the tournament's game world, pot = division.
-- Safe to run again: clubs already entered are skipped.
create or replace function public.enter_all_game_world_clubs(target_tournament_id bigint)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t record;
  club record;
  v_team_id bigint;
  v_manager_id bigint;
  added integer := 0;
begin
  if not public.can_manage_tournament(target_tournament_id) then
    raise exception 'Only tournament organisers can enter clubs.';
  end if;
  select * into t from public.tournaments where id = target_tournament_id;
  if t.id is null then raise exception 'Tournament % not found.', target_tournament_id; end if;
  if t.game_world_id is null then raise exception 'The tournament has no game world.'; end if;
  if t.league_draw_at is not null then raise exception 'The draw has been made; entrants are locked.'; end if;

  for club in
    select c.club_name, c.current_manager_name, c.division
    from public.game_world_clubs c
    where c.game_world_id = t.game_world_id and c.active
    order by c.division, c.club_name
  loop
    select id into v_team_id from public.teams where lower(name) = lower(club.club_name) order by id limit 1;
    if v_team_id is null then
      insert into public.teams (name, active) values (club.club_name, true) returning id into v_team_id;
    end if;
    if exists (select 1 from public.tournament_entries e where e.tournament_id = target_tournament_id and e.team_id = v_team_id) then
      update public.tournament_entries set pot = club.division
       where tournament_id = target_tournament_id and team_id = v_team_id;
      continue;
    end if;
    v_manager_id := null;
    if club.current_manager_name is not null then
      select id into v_manager_id from public.managers
       where lower(name) = lower(club.current_manager_name) or lower(display_name) = lower(club.current_manager_name)
       order by id limit 1;
    end if;
    insert into public.tournament_entries (tournament_id, team_id, manager_id, pot, entry_status)
    values (target_tournament_id, v_team_id, v_manager_id, club.division, 'confirmed');
    added := added + 1;
  end loop;

  update public.tournaments
     set actual_entries = (select count(*) from public.tournament_entries where tournament_id = target_tournament_id)
   where id = target_tournament_id;
  return added;
end;
$$;

revoke all on function public.enter_all_game_world_clubs(bigint) from public;
grant execute on function public.enter_all_game_world_clubs(bigint) to authenticated;

-- Save a league-phase draw made in the app (from a published seed).
-- fixtures: [{ "matchday": 1, "home_entry_id": 1, "away_entry_id": 2 }, ...]
-- The database checks the rules again before anything is written.
create or replace function public.save_league_phase_draw(target_tournament_id bigint, draw_seed text, first_matchday date, fixtures jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t record;
  entry_count integer;
  matchdays integer;
  bad text;
  saved integer;
begin
  if not public.can_manage_tournament(target_tournament_id) then
    raise exception 'Only tournament organisers can save the draw.';
  end if;
  select * into t from public.tournaments where id = target_tournament_id for update;
  if t.id is null then raise exception 'Tournament % not found.', target_tournament_id; end if;
  if t.tournament_structure <> 'league_knockout' then raise exception 'This tournament is not a league-phase tournament.'; end if;
  if coalesce(trim(draw_seed), '') = '' then raise exception 'A draw seed is required.'; end if;
  if first_matchday is null or extract(isodow from first_matchday) <> 3 then raise exception 'The first matchday must be a Wednesday.'; end if;
  if exists (
    select 1 from public.matches m
    where m.tournament_id = target_tournament_id and m.stage = 'league' and (m.status <> 'scheduled' or m.home_score is not null)
  ) then
    raise exception 'League results have been entered; the draw can no longer be replaced.';
  end if;

  drop table if exists pg_temp.draw_rows;
  create temporary table draw_rows on commit drop as
  select (f->>'matchday')::int matchday, (f->>'home_entry_id')::bigint home_id, (f->>'away_entry_id')::bigint away_id,
         row_number() over () ord
  from jsonb_array_elements(fixtures) f;

  select count(*) into entry_count from public.tournament_entries where tournament_id = target_tournament_id;
  select count(distinct matchday) into matchdays from draw_rows;

  select string_agg(problem, '; ') into bad from (
    select 'unknown entrant ' || x.id problem
      from (select home_id id from draw_rows union select away_id from draw_rows) x
     where not exists (select 1 from public.tournament_entries e where e.id = x.id and e.tournament_id = target_tournament_id)
    union all
    select 'entrant ' || e.id || ' has ' || count(d.*) || ' matches'
      from public.tournament_entries e
      left join draw_rows d on d.home_id = e.id or d.away_id = e.id
     where e.tournament_id = target_tournament_id
     group by e.id having count(d.*) <> matchdays
    union all
    select 'entrant ' || e.id || ' has ' || count(d.*) || ' home matches'
      from public.tournament_entries e
      left join draw_rows d on d.home_id = e.id
     where e.tournament_id = target_tournament_id
     group by e.id having count(d.*) * 2 <> matchdays
    union all
    select 'entrant ' || c.id || ' plays twice on matchday ' || c.matchday
      from (select home_id id, matchday from draw_rows union all select away_id, matchday from draw_rows) c
     group by c.id, c.matchday having count(*) > 1
    union all
    select 'a pairing repeats: ' || least(home_id, away_id) || ' v ' || greatest(home_id, away_id)
      from draw_rows group by least(home_id, away_id), greatest(home_id, away_id) having count(*) > 1
    union all
    select 'a club plays itself' from draw_rows where home_id = away_id
    limit 10
  ) problems;
  if bad is not null then raise exception 'The draw breaks the rules: %', bad; end if;
  if entry_count < 2 then raise exception 'Enter the clubs before the draw.'; end if;

  delete from public.matches where tournament_id = target_tournament_id and stage = 'league';

  insert into public.matches (tournament_id, stage, bracket, round, leg, match_order, home_entry_id, away_entry_id, status, fixture_date, match_code, published)
  select target_tournament_id, 'league', 'League Stage', 'Matchday ' || d.matchday, 1,
         d.matchday * 1000 + row_number() over (partition by d.matchday order by d.ord),
         d.home_id, d.away_id, 'scheduled', first_matchday + (d.matchday - 1) * 7,
         'L' || d.matchday || '-' || row_number() over (partition by d.matchday order by d.ord), true
  from draw_rows d;
  get diagnostics saved = row_count;

  update public.tournaments
     set league_draw_seed = draw_seed, league_draw_at = now(), league_first_matchday = first_matchday,
         status = case when status = 'draft' then 'published' else status end
   where id = target_tournament_id;

  insert into public.audit_log (action, entity_type, entity_id, new_data, changed_by, created_at)
  values ('league_phase_draw', 'tournament', target_tournament_id,
          jsonb_build_object('seed', draw_seed, 'fixtures', saved, 'first_matchday', first_matchday),
          (select auth.uid())::text, now());

  return saved;
end;
$$;

revoke all on function public.save_league_phase_draw(bigint, text, date, jsonb) from public;
grant execute on function public.save_league_phase_draw(bigint, text, date, jsonb) to authenticated;
