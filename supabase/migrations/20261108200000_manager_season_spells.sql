-- Mid-season spells: a manager who took over a club part-way through the season is judged on
-- their own games, not the club's whole season (rulebook 3.1 and 3.2).
--
-- When the current spell started, in this order:
--   * a date the admin team entered with set_manager_spell() (which can also correct the games
--     and points by hand);
--   * the manager's Soccer Manager profile history (soccer_manager_manager_stints, read by Sync):
--     their open spell at the club, if it began after the season's first two days
--     (soccer_manager_world_seasons, or 147-day seasons counted back from world_season_end());
--   * otherwise a suggestion from the sync (the club's assignment first seen after the season
--     started, appointment_mid_season_clubs), which counts only once confirmed: re-syncs can
--     re-stamp an assignment without a change of manager.
-- The spell's record is the club's latest table row less its record before the start date:
-- from the table snapshot in the three days before, or else from the synced match reports, which
-- are "complete" when the club has as many earlier games on record as any club in its division
-- and the reports reach the start date.

set check_function_bodies = false;

create table public.manager_spells (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id),
  season integer not null check (season > 0),
  manager_id bigint not null references public.managers(id),
  club_name text,
  started_on date not null,
  games integer check (games is null or games between 0 and 60),
  points integer check (points is null or points between 0 and 180),
  note text check (note is null or length(note) <= 500),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (game_world_id, season, manager_id)
);
alter table public.manager_spells enable row level security;
-- @permissions private public.manager_spells: read and written only through the spell functions below

-- A club's league record from the start date on: its latest table row less the league games it
-- played before that date (in the 160 days before), from the synced match reports.
create or replace function public.appointment_spell_record(p_world_id bigint, p_team_id bigint, p_started_on date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select snapshot.* from public.league_standing_snapshots snapshot
    where snapshot.game_world_id = p_world_id and snapshot.team_id = p_team_id
      and snapshot.captured_at >= p_started_on - 160
    order by snapshot.captured_at desc limit 1
  ),
  -- The club's table row just before the start date, when one was captured.
  at_start as (
    select snapshot.played, snapshot.won, snapshot.drawn, snapshot.lost, snapshot.points
    from public.league_standing_snapshots snapshot
    where snapshot.game_world_id = p_world_id and snapshot.team_id = p_team_id
      and snapshot.captured_at < p_started_on and snapshot.captured_at >= p_started_on - 3
    order by snapshot.captured_at desc limit 1
  ),
  games as (
    select distinct on (match.source_data->'fixture'->>'date', match.home_team_id, match.away_team_id)
      (match.source_data->'fixture'->>'date')::date as played_on,
      match.home_team_id, match.away_team_id, match.home_score, match.away_score
    from public.soccer_manager_match_snapshots match
    where match.game_world_id = p_world_id and match.competition_code = 'league'
      and match.home_score is not null and match.away_score is not null
      and (match.source_data->'fixture'->>'date')::date >= p_started_on - 160
      and (match.source_data->'fixture'->>'date')::date < p_started_on
  ),
  mine as (
    select case when games.home_team_id = p_team_id then games.home_score else games.away_score end as scored,
           case when games.home_team_id = p_team_id then games.away_score else games.home_score end as conceded
    from games where p_team_id in (games.home_team_id, games.away_team_id)
  ),
  from_reports as (
    select count(*)::int as played, count(*) filter (where scored > conceded)::int as won,
           count(*) filter (where scored = conceded)::int as drawn, count(*) filter (where scored < conceded)::int as lost
    from mine
  ),
  division_games as (
    select team.id, games.played_on from games
    join lateral (values (games.home_team_id), (games.away_team_id)) team(id) on true
    where team.id in (select other.team_id from public.league_standing_snapshots other, latest
                      where other.game_world_id = p_world_id and other.league_id = latest.league_id
                        and other.captured_at >= p_started_on - 160)
  ),
  division_most as (
    select coalesce((select max(per_team.played) from (select count(*) as played from division_games group by division_games.id) per_team), 0) as played,
           (select max(division_games.played_on) from division_games) as last_on
  ),
  before as (
    select coalesce(at_start.played, from_reports.played) as played,
           coalesce(at_start.won, from_reports.won) as won,
           coalesce(at_start.drawn, from_reports.drawn) as drawn,
           coalesce(at_start.lost, from_reports.lost) as lost,
           coalesce(at_start.points, 3 * from_reports.won + from_reports.drawn) as points,
           case when at_start.played is not null then true
                else from_reports.played >= division_most.played and division_most.last_on >= p_started_on - 4 end as complete
    from from_reports cross join division_most left join at_start on true
  )
  select jsonb_build_object(
    'division', latest.division,
    'games', latest.played - before.played,
    'won', latest.won - before.won, 'drawn', latest.drawn - before.drawn, 'lost', latest.lost - before.lost,
    'points', latest.points - before.points,
    'gamesBefore', before.played,
    'complete', coalesce(before.complete, false))
  from latest, before;
$$;
revoke all on function public.appointment_spell_record(bigint, bigint, date) from public, anon, authenticated;
-- @permissions private public.appointment_spell_record(bigint, bigint, date): used only by appointment_manager_spells

-- Each manager's current spell this season, when it began after the season started: keyed by
-- manager id, with its start date, its source (admin, profile or records), whether it counts
-- (confirmed: admin or profile), and its record (games and points as the admin team corrected
-- them, when they did).
create or replace function public.appointment_manager_spells(p_world_id bigint, p_season integer, p_manager_ids bigint[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with season as (
    select coalesce(
      (select world_season.start_date from public.soccer_manager_world_seasons world_season
        where world_season.game_world_id = p_world_id and world_season.season_num = p_season),
      public.world_season_end(p_world_id, p_season) - 147) as starts_on
  ),
  found as (
    select distinct on (club.manager_id) club.manager_id, club.club_name, crosswalk.team_id, override.id as override_id,
      override.games as override_games, override.points as override_points, override.note,
      case when override.id is not null then override.started_on
           when stint.started_at is not null then stint.started_at::date
           else mid.assigned_at::date end as started_on,
      case when override.id is not null then 'admin' when stint.started_at is not null then 'profile' else 'records' end as source
    from season, public.appointment_world_managers(p_world_id) club
    join public.soccer_manager_club_crosswalk crosswalk on crosswalk.game_world_club_id = club.game_world_club_id
    left join public.manager_spells override
      on override.game_world_id = p_world_id and override.season = p_season and override.manager_id = club.manager_id
    -- The manager's open spell at the club in their Soccer Manager history, begun after the season's first two days.
    left join lateral (
      select history.started_at from public.soccer_manager_manager_stints history
      where history.game_world_id = p_world_id and lower(history.club_name) = lower(club.club_name) and history.ended_at is null
      order by history.started_at desc limit 1
    ) open_spell on true
    left join lateral (select open_spell.started_at where open_spell.started_at::date > season.starts_on + 2) stint on true
    left join public.appointment_mid_season_clubs(p_world_id) mid on mid.club_name = club.club_name
    where club.manager_id = any (p_manager_ids)
      and (override.id is not null or stint.started_at is not null or mid.club_name is not null)
      -- A club whose profile history shows its manager there since before the season isn't a suggestion.
      and (override.id is not null or stint.started_at is not null or open_spell.started_at is null)
    order by club.manager_id, override.id nulls last
  )
  select coalesce(jsonb_object_agg(found.manager_id::text,
    jsonb_strip_nulls(jsonb_build_object('club', found.club_name, 'confirmed', found.source <> 'records',
      'startedOn', found.started_on, 'source', found.source, 'note', found.note)) ||
    case when found.override_games is not null
      -- The admin team's games and points replace the record from the table and match reports.
      then (coalesce(public.appointment_spell_record(p_world_id, found.team_id, found.started_on), '{}'::jsonb)
              - array['won', 'drawn', 'lost', 'gamesBefore'])
           || jsonb_build_object('games', found.override_games, 'points', found.override_points, 'complete', true, 'corrected', true)
      else coalesce(public.appointment_spell_record(p_world_id, found.team_id, found.started_on), '{}'::jsonb)
    end), '{}'::jsonb)
  from found;
$$;
revoke all on function public.appointment_manager_spells(bigint, integer, bigint[]) from public, anon, authenticated;
-- @permissions private public.appointment_manager_spells(bigint, integer, bigint[]): used only by the appointment functions

-- Officials: record (or, with a null date, remove) when a manager took over their current club
-- this season, optionally with their games and points in charge.
create or replace function public.set_manager_spell(p_manager_id bigint, p_started_on date, p_games integer default null,
  p_points integer default null, p_note text default null, p_season integer default null, p_world_slug text default 'top-100')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can record when a manager took over.'; end if;
  if p_started_on is null then
    delete from public.manager_spells spell
    where spell.game_world_id = v_world and spell.season = v_season and spell.manager_id = p_manager_id;
  else
    if (p_games is null) <> (p_points is null) then raise exception 'Give both games and points, or neither.'; end if;
    insert into public.manager_spells (game_world_id, season, manager_id, club_name, started_on, games, points, note, updated_by)
    values (v_world, v_season, p_manager_id,
            (select club.club_name from public.appointment_world_managers(v_world) club where club.manager_id = p_manager_id limit 1),
            p_started_on, p_games, p_points, nullif(trim(p_note), ''), auth.uid())
    on conflict (game_world_id, season, manager_id) do update
      set club_name = excluded.club_name, started_on = excluded.started_on, games = excluded.games, points = excluded.points,
          note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  end if;
  return public.appointment_manager_spells(v_world, v_season, array[p_manager_id]) -> p_manager_id::text;
end;
$$;
revoke all on function public.set_manager_spell(bigint, date, integer, integer, text, integer, text) from public, anon;
grant execute on function public.set_manager_spell(bigint, date, integer, integer, text, integer, text) to authenticated;

-- Scoring inputs: each manager's mid-season spell (confirmed or suggested), and, when confirmed,
-- forfeits only from when they took over (a club's earlier forfeits stay with its earlier manager).
create or replace function public.appointment_manager_inputs(p_world_id bigint, p_season integer, p_manager_ids bigint[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with spells as (select public.appointment_manager_spells(p_world_id, p_season, p_manager_ids) as by_manager)
  select coalesce(jsonb_object_agg(ids.manager_id::text, jsonb_strip_nulls(jsonb_build_object(
    -- The Manager List badge decides Gold. When the profile has shown no days left since a date now
    -- past but the badge is still on, it is unclear (run out, or in Soccer Manager's renewal grace):
    -- flagged for an administrator to check, not counted against the manager.
    'gold', signal.gold,
    'goldUnclearSince', case when signal.gold is true then signal.gold_ended_on end,
    'goldDaysLeft', signal.gold_days_left,
    'gameWorlds', signal.game_worlds,
    'running', case when official.manager_id is not null then 3 else 0 end,
    'competitions', (select count(distinct entry.tournament_id) from public.tournament_entries entry
                       join public.tournaments tournament on tournament.id = entry.tournament_id
                       join public.seasons season on season.id = tournament.season_id
                      where entry.manager_id = ids.manager_id and season.number between p_season - 1 and p_season
                        and not coalesce(entry.withdrawn, false)),
    'topManagerDeals', (select count(*) from public.soccer_manager_transfers transfer
                         where transfer.game_world_id = p_world_id
                           and transfer.from_manager_id is not null and transfer.to_manager_id is not null
                           and transfer.from_manager_id <> transfer.to_manager_id
                           and ids.manager_id in (transfer.from_manager_id, transfer.to_manager_id)
                           and transfer.first_seen_at >= now() - interval '120 days'),
    'forfeits', (select count(*) from public.forfeits forfeit
                   join public.tournament_entries entry on entry.id = forfeit.forfeiting_entry_id
                   join public.tournaments tournament on tournament.id = entry.tournament_id
                   join public.seasons season on season.id = tournament.season_id
                  where entry.manager_id = ids.manager_id and season.number = p_season
                    and (spell.started_on is null or forfeit.created_at >= spell.started_on)),
    'spell', spells.by_manager -> ids.manager_id::text,
    'openSanction', (select string_agg(coalesce(ban.terms, 'transfer ban') || ' until ' || to_char(ban.ends_on, 'FMDD Mon YYYY'), '; ')
                       from public.club_transfer_bans ban
                       join public.appointment_world_managers(p_world_id) club on club.club_name = ban.club_name
                      where club.manager_id = ids.manager_id and ban.ends_on >= current_date)
  ))), '{}'::jsonb)
  from spells cross join unnest(p_manager_ids) ids(manager_id)
  left join lateral (select case when ((spells.by_manager -> ids.manager_id::text) ->> 'confirmed')::boolean
                                 then ((spells.by_manager -> ids.manager_id::text) ->> 'startedOn')::date end as started_on) spell on true
  left join lateral (
    select snapshot.gold, snapshot.gold_days_left, snapshot.game_worlds,
      (select expiry.expires_on from public.manager_gold_expiry(snapshot.source_world_id) expiry
        where expiry.source_club_id = snapshot.source_club_id and expiry.sm_manager_id = snapshot.sm_manager_id
          and expiry.expires_on < (now() at time zone 'UTC')::date) as gold_ended_on
    from public.manager_signal_snapshots snapshot
    where snapshot.game_world_id = p_world_id and snapshot.manager_id = ids.manager_id
    order by snapshot.captured_at desc limit 1
  ) signal on true
  left join public.top100_officials official on official.manager_id = ids.manager_id;
$$;

-- Public: every current manager's confirmed mid-season spell this season (start date and record), for the
-- archive's manager profiles. Soccer Manager shows the same results to every player.
create or replace function public.public_manager_spells(p_world_slug text default 'top-100')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('season', public.appointment_current_season(p_world_slug),
    'spells', coalesce((select jsonb_agg(spell.value || jsonb_build_object('manager', coalesce(m.display_name, m.name)) - 'note')
      from jsonb_each(public.appointment_manager_spells(public.appointment_world_id(p_world_slug), public.appointment_current_season(p_world_slug),
             (select coalesce(array_agg(club.manager_id), '{}') from public.appointment_world_managers(public.appointment_world_id(p_world_slug)) club
              where club.manager_id is not null))) spell
      join public.managers m on m.id = spell.key::bigint
      where (spell.value ->> 'confirmed')::boolean), '[]'::jsonb));
$$;
revoke all on function public.public_manager_spells(text) from public;
grant execute on function public.public_manager_spells(text) to anon, authenticated, service_role;
