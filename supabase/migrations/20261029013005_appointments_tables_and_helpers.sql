-- Appointments (rulebook 3.2) and bottom-three reviews (3.1) in Top 100.
--
-- Vacancies are published by the Top 100 officials with a closing date. Managers
-- apply from Manager Portal, naming the vacancies they want in order; Gold is
-- required. Each bottom-three manager is reviewed, and can say whether they want
-- to stay, move or take a break. The officials score both with the archive's
-- appointment-scores function (archive.smtop100.blog), store the result here,
-- vote on close calls with a reason each, decide, and publish. Published
-- decisions, with their scores and reasons, are public.
--
-- league_standings_current_by_club, the Sync tables and manager_signal_snapshots come
-- from Manager Lab's migrations, so SQL function bodies are not checked here.
set check_function_bodies = false;

create table if not exists public.appointment_vacancies (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id),
  season integer not null check (season > 0),
  club_name text not null check (length(trim(club_name)) > 0),
  division integer not null check (division between 1 and 10),
  context text,
  status text not null default 'open' check (status in ('open', 'closed', 'decided', 'withdrawn')),
  closes_at timestamptz,
  appointed_manager_id bigint references public.managers(id),
  decision_reason text,
  decided_at timestamptz,
  published_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (game_world_id, season, club_name)
);

create table if not exists public.appointment_applications (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id),
  season integer not null,
  manager_id bigint not null references public.managers(id),
  preferences bigint[] not null default '{}',
  note text check (note is null or length(note) <= 1000),
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_world_id, season, manager_id)
);

create table if not exists public.appointment_reviews (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id),
  season integer not null,
  club_name text not null,
  division integer not null,
  position integer not null,
  manager_id bigint references public.managers(id),
  manager_name text,
  took_over_mid_season boolean not null default false,
  standing text,
  last_chance boolean not null default false,
  misconduct text,
  inactive text,
  wish text check (wish in ('stay', 'move', 'break')),
  wish_note text check (wish_note is null or length(wish_note) <= 1000),
  wish_at timestamptz,
  suggested_outcome text check (suggested_outcome in ('reappoint', 'secondChance', 'anotherClub', 'leave')),
  decision text check (decision in ('reappoint', 'secondChance', 'anotherClub', 'leave')),
  decision_reason text,
  decided_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (game_world_id, season, club_name)
);

-- The last scoring of each round (kind 'vacancies' or 'review'): the inputs sent to
-- appointment-scores and its result, kept as published evidence for the decisions.
create table if not exists public.appointment_rounds (
  id bigint generated always as identity primary key,
  game_world_id bigint not null references public.game_worlds(id),
  season integer not null,
  kind text not null check (kind in ('vacancies', 'review')),
  inputs jsonb not null default '{}',
  result jsonb not null default '{}',
  scored_at timestamptz not null default now(),
  scored_by uuid default auth.uid(),
  published_at timestamptz,
  unique (game_world_id, season, kind)
);

-- One vote per official per decision: the choice and the reason, published with it.
create table if not exists public.appointment_votes (
  id bigint generated always as identity primary key,
  subject_kind text not null check (subject_kind in ('vacancy', 'review')),
  subject_id bigint not null,
  voter uuid not null default auth.uid(),
  voter_name text,
  choice text not null check (length(trim(choice)) > 0),
  reason text not null check (length(trim(reason)) > 0 and length(reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_kind, subject_id, voter)
);

alter table public.appointment_vacancies enable row level security;
alter table public.appointment_applications enable row level security;
alter table public.appointment_reviews enable row level security;
alter table public.appointment_rounds enable row level security;
alter table public.appointment_votes enable row level security;
revoke all on public.appointment_vacancies, public.appointment_applications, public.appointment_reviews,
  public.appointment_rounds, public.appointment_votes from public, anon, authenticated;

-- @permissions private public.appointment_vacancies: read and written only through the appointment functions below
-- @permissions private public.appointment_applications: read and written only through the appointment functions below
-- @permissions private public.appointment_reviews: read and written only through the appointment functions below
-- @permissions private public.appointment_rounds: read and written only through the appointment functions below
-- @permissions private public.appointment_votes: read and written only through the appointment functions below

-- Every club in a world with its manager and current standing.
create or replace function public.appointment_world_managers(p_world_id bigint)
returns table (manager_id bigint, manager_name text, club_name text, game_world_club_id bigint, division integer, "position" integer, played integer)
language sql
stable
security definer
set search_path = ''
as $$
  select assignment.manager_id,
    coalesce(manager.display_name, manager.name, assignment.source_manager_name),
    standing.club_name, standing.game_world_club_id, standing.division, standing.position, standing.played
  from public.league_standings_current_by_club standing
  left join public.soccer_manager_club_crosswalk crosswalk on crosswalk.game_world_club_id = standing.game_world_club_id
  left join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = p_world_id and assignment.team_id = crosswalk.team_id
  left join public.managers manager on manager.id = assignment.manager_id
  where standing.game_world_id = p_world_id;
$$;

revoke all on function public.appointment_world_managers(bigint) from public, anon, authenticated;

-- @permissions private public.appointment_world_managers: used only by the appointment functions below

create or replace function public.appointment_world_id(p_world_slug text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$ select id from public.game_worlds where slug = coalesce(p_world_slug, 'top-100'); $$;

revoke all on function public.appointment_world_id(text) from public, anon;
grant execute on function public.appointment_world_id(text) to authenticated;

-- The current season: the live table's (S28 until the sheet has it).
create or replace function public.appointment_current_season(p_world_slug text default 'top-100')
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select max(season) from public.public_league_season_rows(coalesce(p_world_slug, 'top-100')); $$;

revoke all on function public.appointment_current_season(text) from public;
grant execute on function public.appointment_current_season(text) to anon, authenticated;

-- The signed-in manager (Manager Portal account).
create or replace function public.appointment_my_manager_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select account.manager_id from public.manager_portal_accounts account
  where account.auth_user_id = auth.uid() and account.active and account.manager_id is not null
  order by account.id limit 1;
$$;

revoke all on function public.appointment_my_manager_id() from public, anon, authenticated;

-- @permissions private public.appointment_my_manager_id: used only by the manager appointment functions below

-- Scoring inputs for managers, from what Top 100 records: Gold, days of Gold left and
-- game worlds (Sync), running Top 100 (officials), Top 100 competition entries in this
-- and last season, deals with other Top 100 managers in the last 120 days, forfeits
-- this season and an active transfer ban. Officials can adjust any of them before scoring.
create or replace function public.appointment_manager_inputs(p_world_id bigint, p_season integer, p_manager_ids bigint[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(ids.manager_id::text, jsonb_strip_nulls(jsonb_build_object(
    'gold', signal.gold,
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
                  where entry.manager_id = ids.manager_id and season.number = p_season),
    'openSanction', (select string_agg(coalesce(ban.terms, 'transfer ban') || ' until ' || to_char(ban.ends_on, 'FMDD Mon YYYY'), '; ')
                       from public.club_transfer_bans ban
                       join public.appointment_world_managers(p_world_id) club on club.club_name = ban.club_name
                      where club.manager_id = ids.manager_id and ban.ends_on >= current_date)
  ))), '{}'::jsonb)
  from unnest(p_manager_ids) ids(manager_id)
  left join lateral (
    select snapshot.gold, snapshot.gold_days_left, snapshot.game_worlds
    from public.manager_signal_snapshots snapshot
    where snapshot.game_world_id = p_world_id and snapshot.manager_id = ids.manager_id
    order by snapshot.captured_at desc limit 1
  ) signal on true
  left join public.top100_officials official on official.manager_id = ids.manager_id;
$$;

revoke all on function public.appointment_manager_inputs(bigint, integer, bigint[]) from public, anon, authenticated;

-- @permissions private public.appointment_manager_inputs: used only by the appointment functions below
