-- Arranged friendlies from Soccer Manager.
--
-- Competitions > Friendlies lists every friendly arranged in a game world, by
-- date. Sync everything reads it, date by date, and saves the rows here, so a
-- World Club Cup fixture can be seen as arranged in Soccer Manager before it is
-- played, whatever the managers have recorded in My Matches.
--
-- A row that was on a date's list and later is not (the friendly was
-- cancelled) keeps its row with cancelled_at set; it is cleared again if the
-- friendly reappears.
--
-- @permissions private public.soccer_manager_scheduled_fixtures: written by save_soccer_manager_scheduled_fixtures(), read by league_phase_sm_arrangements()

create table if not exists public.soccer_manager_scheduled_fixtures (
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  source_fixture_id text not null,
  fixture_date date not null,
  competition text,
  home_source_club_id text not null,
  away_source_club_id text not null,
  home_team_id bigint references public.teams(id) on delete set null,
  away_team_id bigint references public.teams(id) on delete set null,
  home_name text,
  away_name text,
  played boolean not null default false,
  home_score integer,
  away_score integer,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  cancelled_at timestamptz,
  primary key (game_world_id, source_fixture_id)
);
alter table public.soccer_manager_scheduled_fixtures enable row level security;
create index if not exists soccer_manager_scheduled_fixtures_teams_idx
  on public.soccer_manager_scheduled_fixtures (game_world_id, home_team_id, away_team_id, fixture_date);

-- Saves one sync's arranged friendlies. target_rows: [{fixtureId, date, competition,
-- homeClubId, awayClubId, homeName, awayName, played, homeScore, awayScore}];
-- target_dates: the dates whose lists were read in full, so friendlies missing from
-- them are marked cancelled. Returns {saved, cancelled}.
create or replace function public.save_soccer_manager_scheduled_fixtures(target_setup_id text, target_rows jsonb, target_dates jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_id text := nullif(trim(target_setup_id), '');
  v_world_id bigint;
  v_now timestamptz := now();
  v_saved integer := 0;
  v_cancelled integer := 0;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if setup_id is null or setup_id !~ '^[0-9]{1,18}$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;
  if jsonb_typeof(target_rows) is distinct from 'array' or jsonb_typeof(coalesce(target_dates, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'target_rows and target_dates must be arrays';
  end if;
  if jsonb_array_length(target_rows) > 3000 then
    raise exception 'Save at most 3000 fixtures at a time';
  end if;
  select id into v_world_id from public.game_worlds where external_world_id = setup_id::bigint order by id limit 1;
  if v_world_id is null then
    raise exception 'No archived Soccer Manager world %', setup_id;
  end if;

  with input as (
    select distinct on (r->>'fixtureId')
           r->>'fixtureId' fid, (r->>'date')::date d, nullif(r->>'competition', '') comp,
           r->>'homeClubId' hc, r->>'awayClubId' ac, nullif(r->>'homeName', '') hn, nullif(r->>'awayName', '') an,
           coalesce((r->>'played')::boolean, false) played,
           case when r->>'homeScore' ~ '^[0-9]{1,3}$' then (r->>'homeScore')::integer end hs,
           case when r->>'awayScore' ~ '^[0-9]{1,3}$' then (r->>'awayScore')::integer end aws
    from jsonb_array_elements(target_rows) r
    where r->>'fixtureId' ~ '^[1-9][0-9]{0,18}$' and r->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and r->>'homeClubId' ~ '^[1-9][0-9]{0,18}$' and r->>'awayClubId' ~ '^[1-9][0-9]{0,18}$'
  ),
  saved as (
    insert into public.soccer_manager_scheduled_fixtures as t (game_world_id, source_fixture_id, fixture_date, competition,
      home_source_club_id, away_source_club_id, home_team_id, away_team_id, home_name, away_name, played, home_score, away_score,
      first_seen_at, last_seen_at, cancelled_at)
    select v_world_id, i.fid, i.d, i.comp, i.hc, i.ac,
           (select cw.team_id from public.soccer_manager_club_crosswalk cw where cw.source_world_id = setup_id::bigint and cw.source_club_id = i.hc limit 1),
           (select cw.team_id from public.soccer_manager_club_crosswalk cw where cw.source_world_id = setup_id::bigint and cw.source_club_id = i.ac limit 1),
           i.hn, i.an, i.played, i.hs, i.aws, v_now, v_now, null
    from input i
    on conflict (game_world_id, source_fixture_id) do update set
      fixture_date = excluded.fixture_date, competition = excluded.competition,
      home_source_club_id = excluded.home_source_club_id, away_source_club_id = excluded.away_source_club_id,
      home_team_id = coalesce(excluded.home_team_id, t.home_team_id), away_team_id = coalesce(excluded.away_team_id, t.away_team_id),
      home_name = coalesce(excluded.home_name, t.home_name), away_name = coalesce(excluded.away_name, t.away_name),
      played = excluded.played, home_score = excluded.home_score, away_score = excluded.away_score,
      last_seen_at = v_now, cancelled_at = null
    returning 1
  )
  select count(*)::integer into v_saved from saved;

  -- Friendlies no longer on a date that was read in full have been cancelled.
  update public.soccer_manager_scheduled_fixtures t
     set cancelled_at = v_now
   where t.game_world_id = v_world_id
     and t.cancelled_at is null
     and t.played = false
     and t.last_seen_at < v_now
     and t.fixture_date in (select (d #>> '{}')::date from jsonb_array_elements(coalesce(target_dates, '[]'::jsonb)) d
                            where (d #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
  get diagnostics v_cancelled = row_count;

  return jsonb_build_object('saved', v_saved, 'cancelled', v_cancelled);
end;
$$;

revoke all on function public.save_soccer_manager_scheduled_fixtures(text, jsonb, jsonb) from public;
grant execute on function public.save_soccer_manager_scheduled_fixtures(text, jsonb, jsonb) to authenticated;

-- For each fixture of a league-phase tournament, whether its friendly is arranged
-- in Soccer Manager: 'arranged' (same clubs, same club at home, on the fixture's
-- date), 'reversed' (on the date but the wrong club at home), 'other_date' (the
-- same clubs, right way round, within 7 days before to 28 days after the date),
-- or null. Public: the Friendlies list is visible to every Soccer Manager player.
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
              when f.home_team_id = ae.team_id and f.fixture_date = m.fixture_date then 'reversed'
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
    order by (s.home_team_id = he.team_id and s.fixture_date = m.fixture_date) desc,
             (s.fixture_date = m.fixture_date) desc,
             abs(s.fixture_date - coalesce(m.fixture_date, s.fixture_date)), s.source_fixture_id
    limit 1
  ) f on true
  where m.tournament_id = target_tournament_id and t.is_public = true;
$$;

revoke all on function public.league_phase_sm_arrangements(bigint) from public;
grant execute on function public.league_phase_sm_arrangements(bigint) to anon, authenticated;
