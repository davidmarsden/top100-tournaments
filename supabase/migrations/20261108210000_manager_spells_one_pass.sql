-- appointment_manager_spells() worked out each spell's record with appointment_spell_record(),
-- which read every synced match report again for each manager (about 0.75 s each), so the admin
-- overview, with 40 or so managers, ran past the statement timeout. This version reads the
-- season's league results once and works out every spell's record from them, with the same rules:
-- the club's latest table row this season less its record at the start date, from the table
-- snapshot in the three days before, or else from the match reports, which are complete when they
-- run from the season's start to the takeover and the club has as many games as any club in its
-- division.
set check_function_bodies = false;

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
    select distinct on (club.manager_id) club.manager_id, club.club_name, crosswalk.team_id,
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
  ),
  -- This season's league results up to the latest start date, read once.
  games as materialized (
    select distinct on (match.source_data->'fixture'->>'date', match.home_team_id, match.away_team_id)
      (match.source_data->'fixture'->>'date')::date as played_on,
      match.home_team_id, match.away_team_id, match.home_score, match.away_score
    from season, public.soccer_manager_match_snapshots match
    where match.game_world_id = p_world_id and match.competition_code = 'league'
      and match.home_score is not null and match.away_score is not null
      and exists (select 1 from found)
      and (match.source_data->'fixture'->>'date')::date >= season.starts_on
      and (match.source_data->'fixture'->>'date')::date < (select max(found.started_on) from found)
  ),
  team_games as materialized (
    select games.played_on, side.team_id, side.scored, side.conceded
    from games
    cross join lateral (values (games.home_team_id, games.home_score, games.away_score),
                               (games.away_team_id, games.away_score, games.home_score)) side(team_id, scored, conceded)
  ),
  records as (
    select found.manager_id, latest.division,
      latest.played - before.played as games,
      latest.won - before.won as won, latest.drawn - before.drawn as drawn, latest.lost - before.lost as lost,
      latest.points - before.points as points, before.played as games_before, before.complete
    from found cross join season
    join lateral (
      select snapshot.* from public.league_standing_snapshots snapshot
      where snapshot.game_world_id = p_world_id and snapshot.team_id = found.team_id and snapshot.captured_at >= season.starts_on
      order by snapshot.captured_at desc limit 1
    ) latest on true
    left join lateral (
      select snapshot.played, snapshot.won, snapshot.drawn, snapshot.lost, snapshot.points
      from public.league_standing_snapshots snapshot
      where snapshot.game_world_id = p_world_id and snapshot.team_id = found.team_id
        and snapshot.captured_at < found.started_on and snapshot.captured_at >= greatest(found.started_on - 3, season.starts_on)
      order by snapshot.captured_at desc limit 1
    ) at_start on true
    cross join lateral (
      select count(*)::int as played, count(*) filter (where team_games.scored > team_games.conceded)::int as won,
             count(*) filter (where team_games.scored = team_games.conceded)::int as drawn,
             count(*) filter (where team_games.scored < team_games.conceded)::int as lost
      from team_games where team_games.team_id = found.team_id and team_games.played_on < found.started_on
    ) reports
    cross join lateral (
      select coalesce(max(per_team.played), 0) as played, min(per_team.first_on) as first_on, max(per_team.last_on) as last_on
      from (
        select count(*) as played, min(team_games.played_on) as first_on, max(team_games.played_on) as last_on
        from team_games
        where team_games.played_on < found.started_on
          and team_games.team_id in (select other.team_id from public.league_standing_snapshots other
                                     where other.game_world_id = p_world_id and other.league_id = latest.league_id
                                       and other.captured_at >= season.starts_on)
        group by team_games.team_id
      ) per_team
    ) division_most
    cross join lateral (
      select coalesce(at_start.played, reports.played) as played,
             coalesce(at_start.won, reports.won) as won,
             coalesce(at_start.drawn, reports.drawn) as drawn,
             coalesce(at_start.lost, reports.lost) as lost,
             coalesce(at_start.points, 3 * reports.won + reports.drawn) as points,
             case when at_start.played is not null then true
                  else coalesce(reports.played >= division_most.played and division_most.first_on <= season.starts_on + 4
                                and division_most.last_on >= found.started_on - 4, false) end as complete
    ) before
  )
  select coalesce(jsonb_object_agg(found.manager_id::text,
    jsonb_strip_nulls(jsonb_build_object('club', found.club_name, 'confirmed', found.source <> 'records',
      'startedOn', found.started_on, 'source', found.source, 'note', found.note, 'division', records.division)) ||
    -- The admin team's games and points replace the record from the table and match reports.
    case when found.override_games is not null
           then jsonb_build_object('games', found.override_games, 'points', found.override_points, 'complete', true, 'corrected', true)
         when records.manager_id is null then '{}'::jsonb
         else jsonb_build_object('games', records.games, 'won', records.won, 'drawn', records.drawn, 'lost', records.lost,
                                 'points', records.points, 'gamesBefore', records.games_before, 'complete', records.complete)
    end), '{}'::jsonb)
  from found left join records on records.manager_id = found.manager_id;
$$;

-- The scoring inputs worked out the spells once per manager (the spells query was folded into
-- each row): materialised, they're worked out once.
create or replace function public.appointment_manager_inputs(p_world_id bigint, p_season integer, p_manager_ids bigint[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with spells as materialized (select public.appointment_manager_spells(p_world_id, p_season, p_manager_ids) as by_manager)
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

