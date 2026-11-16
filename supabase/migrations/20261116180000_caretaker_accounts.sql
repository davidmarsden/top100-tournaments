-- Caretaker accounts: Soccer Manager accounts the admin team uses to look after a club between
-- managers. In a season's managers (league_season_managers(), read by the archive) their spells
-- read "Caretaker", as the Full History sheet writes them, not the account's name.
--
-- Add another with:
--   insert into public.soccer_manager_caretaker_accounts (sm_manager_id, note) values ('<id>', '<name>');

create table if not exists public.soccer_manager_caretaker_accounts (
  sm_manager_id text primary key,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.soccer_manager_caretaker_accounts is
  'Soccer Manager accounts used as caretakers. Their spells read "Caretaker" in league history.';

alter table public.soccer_manager_caretaker_accounts enable row level security;
revoke all on table public.soccer_manager_caretaker_accounts from anon, authenticated;

insert into public.soccer_manager_caretaker_accounts (sm_manager_id, note) values
  ('3626501', 'Gianluca Ghio (second account)'),
  ('186242', 'Benny Hill'),
  ('21143245', 'Steve Coppell')
on conflict (sm_manager_id) do nothing;

create or replace function public.league_season_managers(p_world_id bigint)
returns table (season integer, season_start date, club text, managers text)
language sql
stable
security definer
set search_path = ''
as $$
  with current_season as (
    select public.world_current_season_num(p_world_id) as n
  ),
  seasons as materialized (
    select n.season,
      coalesce(saved.start_date, public.world_season_end(p_world_id, n.season) - 147) as starts_on,
      coalesce(saved.end_date, public.world_season_end(p_world_id, n.season)) as ends_on
    from current_season cross join generate_series(1, current_season.n) n(season)
    left join public.soccer_manager_world_seasons saved on saved.game_world_id = p_world_id and saved.season_num = n.season
  ),
  -- Each league game's date, read once.
  games as materialized (
    select (match.source_data->'fixture'->>'date')::date as played_on
    from public.soccer_manager_match_snapshots match
    where match.game_world_id = p_world_id and match.competition_code = 'league'
      and match.home_score is not null and match.away_score is not null
  ),
  last_game as (
    select seasons.season, max(games.played_on) as played_on
    from seasons
    join games on games.played_on between seasons.starts_on and seasons.ends_on
    group by seasons.season
  ),
  windows as materialized (
    select seasons.season, seasons.starts_on,
      case when current_date < seasons.ends_on then current_date + 1
           else coalesce(last_game.played_on + 1, seasons.ends_on - 5) end as before_date
    from seasons
    left join last_game on last_game.season = seasons.season
    where seasons.starts_on is not null
  ),
  linked as materialized (
    select distinct identity.sm_manager_id
    from public.manager_soccer_manager_identities identity
    where identity.game_world_id = p_world_id and identity.sm_manager_id is not null
  ),
  -- Names used by more than one Soccer Manager account, one of them linked to a manager.
  shared_names as materialized (
    select spell.manager_name
    from public.soccer_manager_manager_stints spell
    where spell.game_world_id = p_world_id
    group by spell.manager_name
    having count(distinct spell.sm_manager_id) > 1
       and bool_or(spell.sm_manager_id in (select linked.sm_manager_id from linked))
  ),
  caretakers as materialized (
    select caretaker.sm_manager_id from public.soccer_manager_caretaker_accounts caretaker
  ),
  spells as (
    select windows.season, windows.starts_on, spell.club_name, spell.started_at,
      case when spell.sm_manager_id in (select caretakers.sm_manager_id from caretakers) then 'Caretaker'
           when spell.manager_name in (select shared_names.manager_name from shared_names)
                and spell.sm_manager_id not in (select linked.sm_manager_id from linked)
           then spell.manager_name || ' (2nd)' else spell.manager_name end as manager_name
    from windows
    join public.soccer_manager_manager_stints spell
      on spell.game_world_id = p_world_id
     and spell.started_at::date < windows.before_date
     -- More than two days of the spell fall inside the season.
     and least(coalesce(spell.ended_at::date, windows.before_date), windows.before_date)
         - greatest(spell.started_at::date, windows.starts_on) > 2
  ),
  -- One name per run of spells: a caretaker's back-to-back spells read "Caretaker" once.
  runs as (
    select spells.*, lag(spells.manager_name) over (partition by spells.season, spells.club_name order by spells.started_at) as previous_name
    from spells
  )
  select runs.season, runs.starts_on, runs.club_name,
         string_agg(runs.manager_name, ' / ' order by runs.started_at)
  from runs
  where runs.previous_name is distinct from runs.manager_name
  group by runs.season, runs.starts_on, runs.club_name;
$$;

revoke all on function public.league_season_managers(bigint) from public, anon, authenticated;
grant execute on function public.league_season_managers(bigint) to service_role;
