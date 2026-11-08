-- Who managed each club during each season, for the archive's club trajectories and search
-- results: every club-season in which the manager changed (a spell beginning or ending more than
-- two days inside the season), with each spell's dates from the managers' Soccer Manager profile
-- histories (soccer_manager_manager_stints) and, for the current season, each manager's own record.
--
-- A spell's record is the club's record at its end (the latest table row, or the record when the
-- manager left) less its record at its start. The record on a date is the table snapshot in the
-- three days before, or else the season's synced league match reports before it: "complete" when
-- they run from the season's start and the club has as many games as any club in its division.
-- Season dates are Sync's saved ones where it has them, else 147 days ending on world_season_end().
set check_function_bodies = false;

create or replace function public.public_club_season_spells(p_world_slug text default 'top-100')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with world as (
    select public.appointment_world_id(p_world_slug) as id, public.appointment_current_season(p_world_slug) as current_season
  ),
  -- A season's saved dates where Sync has them, else 147 days ending on world_season_end().
  seasons as (
    select n.season,
      coalesce(saved.start_date, public.world_season_end(world.id, n.season) - 147) as starts_on,
      coalesce(saved.end_date, public.world_season_end(world.id, n.season)) as ends_on
    from world cross join generate_series(1, world.current_season) n(season)
    left join public.soccer_manager_world_seasons saved on saved.game_world_id = world.id and saved.season_num = n.season
  ),
  -- Each current club's team, for this season's records.
  clubs as (
    select distinct on (lower(managed.club_name)) lower(managed.club_name) as club_key, crosswalk.team_id
    from world, public.appointment_world_managers(world.id) managed
    join public.soccer_manager_club_crosswalk crosswalk on crosswalk.game_world_club_id = managed.game_world_club_id
    order by lower(managed.club_name)
  ),
  -- Every spell, once for each season it overlaps.
  pieces as (
    select row_number() over () as id, season.season, season.starts_on, season.ends_on,
      spell.club_name, spell.manager_name, spell.started_at::date as started_on, spell.ended_at::date as ended_on, spell.started_at
    from world
    join public.soccer_manager_manager_stints spell on spell.game_world_id = world.id
    join seasons season on spell.started_at::date < season.ends_on and coalesce(spell.ended_at::date, 'infinity'::date) > season.starts_on
  ),
  changed as (
    select distinct piece.season, lower(piece.club_name) as club_key from pieces piece
    where (piece.started_on > piece.starts_on + 2 and piece.started_on < piece.ends_on - 2)
       or (piece.ended_on > piece.starts_on + 2 and piece.ended_on < piece.ends_on - 2)
  ),
  shown as (
    select piece.*, case when piece.season = world.current_season then club.team_id end as team_id
    from world, pieces piece
    join changed on changed.season = piece.season and changed.club_key = lower(piece.club_name)
    left join clubs club on club.club_key = lower(piece.club_name)
  ),
  -- The dates (this season) on which a club's record is needed: a spell's start and, if it ended, its end.
  checkpoints as (
    select shown.id, 'start' as kind, shown.team_id, shown.started_on as on_date, shown.starts_on
    from shown where shown.team_id is not null and shown.started_on > shown.starts_on + 2
    union all
    select shown.id, 'end', shown.team_id, shown.ended_on, shown.starts_on
    from shown where shown.team_id is not null and shown.ended_on < shown.ends_on - 2
  ),
  games as materialized (
    select distinct on (match.source_data->'fixture'->>'date', match.home_team_id, match.away_team_id)
      (match.source_data->'fixture'->>'date')::date as played_on,
      match.home_team_id, match.away_team_id, match.home_score, match.away_score
    from world, public.soccer_manager_match_snapshots match
    where match.game_world_id = world.id and match.competition_code = 'league'
      and match.home_score is not null and match.away_score is not null
      and exists (select 1 from checkpoints)
      and (match.source_data->'fixture'->>'date')::date >= (select min(checkpoints.starts_on) from checkpoints)
      and (match.source_data->'fixture'->>'date')::date < (select max(checkpoints.on_date) from checkpoints)
  ),
  team_games as materialized (
    select games.played_on, side.team_id, side.scored, side.conceded
    from games
    cross join lateral (values (games.home_team_id, games.home_score, games.away_score),
                               (games.away_team_id, games.away_score, games.home_score)) side(team_id, scored, conceded)
  ),
  latest as (
    select distinct on (snapshot.team_id) snapshot.team_id, snapshot.league_id, snapshot.played, snapshot.won, snapshot.drawn,
      snapshot.lost, snapshot.points
    from world, public.league_standing_snapshots snapshot
    where snapshot.game_world_id = world.id
      and snapshot.team_id in (select shown.team_id from shown where shown.team_id is not null)
      and snapshot.captured_at >= (select min(season.starts_on) from seasons season where season.season = world.current_season)
    order by snapshot.team_id, snapshot.captured_at desc
  ),
  -- Each club's league (division) this season, read once.
  league_teams as materialized (
    select distinct snapshot.team_id, snapshot.league_id
    from world, public.league_standing_snapshots snapshot
    where snapshot.game_world_id = world.id
      and snapshot.captured_at >= (select season.starts_on from seasons season where season.season = world.current_season)
  ),
  record_at as (
    select checkpoints.id, checkpoints.kind,
      coalesce(at_date.played, reports.played) as played, coalesce(at_date.won, reports.won) as won,
      coalesce(at_date.drawn, reports.drawn) as drawn, coalesce(at_date.lost, reports.lost) as lost,
      coalesce(at_date.points, 3 * reports.won + reports.drawn) as points,
      case when at_date.played is not null then true
           else coalesce(reports.played >= division_most.played and division_most.first_on <= checkpoints.starts_on + 4
                         and division_most.last_on >= checkpoints.on_date - 4, false) end as complete
    from checkpoints
    left join latest on latest.team_id = checkpoints.team_id
    left join lateral (
      select snapshot.played, snapshot.won, snapshot.drawn, snapshot.lost, snapshot.points
      from world, public.league_standing_snapshots snapshot
      where snapshot.game_world_id = world.id and snapshot.team_id = checkpoints.team_id
        and snapshot.captured_at < checkpoints.on_date and snapshot.captured_at >= greatest(checkpoints.on_date - 3, checkpoints.starts_on)
      order by snapshot.captured_at desc limit 1
    ) at_date on true
    cross join lateral (
      select count(*)::int as played, count(*) filter (where team_games.scored > team_games.conceded)::int as won,
             count(*) filter (where team_games.scored = team_games.conceded)::int as drawn,
             count(*) filter (where team_games.scored < team_games.conceded)::int as lost
      from team_games where team_games.team_id = checkpoints.team_id and team_games.played_on < checkpoints.on_date
    ) reports
    cross join lateral (
      select coalesce(max(per_team.played), 0) as played, min(per_team.first_on) as first_on, max(per_team.last_on) as last_on
      from (
        select count(*) as played, min(team_games.played_on) as first_on, max(team_games.played_on) as last_on
        from team_games
        where team_games.played_on < checkpoints.on_date
          and team_games.team_id in (select league_teams.team_id from league_teams where league_teams.league_id = latest.league_id)
        group by team_games.team_id
      ) per_team
    ) division_most
  )
  select jsonb_build_object('currentSeason', (select world.current_season from world), 'spells', coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'season', shown.season, 'club', shown.club_name, 'manager', shown.manager_name,
      -- Null when the spell began before the season, or ran on past its end.
      'startedOn', case when shown.started_on > shown.starts_on + 2 then shown.started_on end,
      'endedOn', case when shown.ended_on < shown.ends_on - 2 then shown.ended_on end)) ||
    case when latest.team_id is null then '{}'::jsonb else jsonb_build_object(
      'games', coalesce(finish.played, latest.played) - coalesce(start.played, 0),
      'won', coalesce(finish.won, latest.won) - coalesce(start.won, 0),
      'drawn', coalesce(finish.drawn, latest.drawn) - coalesce(start.drawn, 0),
      'lost', coalesce(finish.lost, latest.lost) - coalesce(start.lost, 0),
      'points', coalesce(finish.points, latest.points) - coalesce(start.points, 0),
      'complete', coalesce(start.complete, true) and coalesce(finish.complete, true)) end
    order by shown.season, lower(shown.club_name), shown.started_at), '[]'::jsonb))
  from shown
  left join latest on latest.team_id = shown.team_id
  left join record_at start on start.id = shown.id and start.kind = 'start'
  left join record_at finish on finish.id = shown.id and finish.kind = 'end';
$$;

revoke all on function public.public_club_season_spells(text) from public;
grant execute on function public.public_club_season_spells(text) to anon, authenticated, service_role;
