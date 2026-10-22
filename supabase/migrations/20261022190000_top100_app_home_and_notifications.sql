-- Top 100 app (manager.smtop100.blog as an installable PWA).
--
-- 1. get_my_top100_app_home(): the signed-in manager's club at a glance plus the
--    Soccer Manager identifiers needed for links into soccermanager.com
--    (setup id, world club id, club catalogue id). Exposes only league-table and
--    squad-summary data, never other clubs' private squad state.
-- 2. A notification inbox (manager_notifications) fed by triggers on fixtures,
--    results, opponent arrangement actions and match comments, by admin
--    broadcasts and by Top 100 Chat reply events.
-- 3. Web Push subscriptions and per-category preferences. Pending notifications
--    are delivered by the push-dispatch Netlify function, woken by pg_net after
--    commit and swept on a schedule for retries and daily fixture reminders.
--
-- Notification triggers never block the write that fires them: failures are
-- downgraded to warnings.

-- ---------------------------------------------------------------------------
-- App home
-- ---------------------------------------------------------------------------

create or replace function public.get_my_top100_app_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_account_id bigint;
  v_manager_id bigint;
  v_game_world_id bigint;
  v_world jsonb;
  v_setup_id bigint;
  v_team_id bigint;
  v_team_name text;
  v_source_club_id text;
  v_division integer;
  v_club jsonb := null;
  v_table jsonb := '[]'::jsonb;
  v_squad jsonb := null;
  v_next jsonb := null;
begin
  if v_user_id is null then
    raise exception 'Sign in required';
  end if;

  select account.id, account.manager_id, account.game_world_id, world.external_world_id,
         jsonb_build_object('id', world.id, 'name', world.name, 'slug', world.slug, 'setupId', world.external_world_id)
    into v_account_id, v_manager_id, v_game_world_id, v_setup_id, v_world
  from public.manager_portal_accounts account
  join public.game_worlds world on world.id = account.game_world_id
  where account.auth_user_id = v_user_id
    and account.active = true
  order by account.id desc
  limit 1;

  if v_account_id is null then
    raise exception 'Active Manager Portal account required';
  end if;

  select assignment.team_id, team.name
    into v_team_id, v_team_name
  from public.soccer_manager_world_manager_assignments assignment
  join public.teams team on team.id = assignment.team_id
  where assignment.game_world_id = v_game_world_id
    and assignment.manager_id = v_manager_id
  order by assignment.updated_at desc
  limit 1;

  if v_team_id is not null then
    select crosswalk.source_club_id
      into v_source_club_id
    from public.soccer_manager_club_crosswalk crosswalk
    where crosswalk.game_world_id = v_game_world_id
      and crosswalk.team_id = v_team_id
    limit 1;

    select standing.division
      into v_division
    from public.league_standings_current_by_club standing
    where standing.game_world_id = v_game_world_id
      and standing.source_club_id = v_source_club_id;

    -- clubDataId is Soccer Manager's club catalogue id, used by
    -- multiplayer.php?action=oppclub&clubdataid=… links.
    with club_data as (
      select distinct on (entity.data->>'clubId')
        entity.data->>'clubId' as source_club_id,
        nullif(entity.data->>'clubDataId', '') as club_data_id
      from public.soccer_manager_canonical_entities entity
      where entity.entity_type = 'standing'
        and entity.data->>'setupId' = v_setup_id::text
      order by entity.data->>'clubId', entity.last_approved_at desc
    )
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'clubName', standing.club_name,
        'sourceClubId', standing.source_club_id,
        'clubDataId', club_data.club_data_id,
        'position', standing.position,
        'played', standing.played,
        'won', standing.won,
        'drawn', standing.drawn,
        'lost', standing.lost,
        'goalDifference', standing.goal_difference,
        'points', standing.points,
        'form', standing.form,
        'isMine', standing.source_club_id = v_source_club_id
      ) order by standing.position) filter (where standing.division = v_division), '[]'::jsonb),
      (array_agg(jsonb_build_object(
        'name', v_team_name,
        'sourceClubId', standing.source_club_id,
        'clubDataId', club_data.club_data_id,
        'division', standing.division,
        'position', standing.position,
        'points', standing.points,
        'form', standing.form,
        'observedAt', standing.world_observed_at,
        'fresh', standing.observation_is_fresh
      )) filter (where standing.source_club_id = v_source_club_id))[1]
      into v_table, v_club
    from public.league_standings_current_by_club standing
    left join club_data on club_data.source_club_id = standing.source_club_id
    where standing.game_world_id = v_game_world_id;

    if v_club is null then
      v_club := jsonb_build_object('name', v_team_name, 'sourceClubId', v_source_club_id);
    end if;

    select jsonb_build_object(
      'players', count(*),
      'seniorPlayers', count(*) filter (where not coalesce(player.youth, false)),
      'youthPlayers', count(*) filter (where coalesce(player.youth, false)),
      'averageRating', round(avg(player.rating) filter (where not coalesce(player.youth, false)), 1),
      'totalValue', sum(player.value),
      'lastSeenAt', max(player.last_seen_at)
    )
      into v_squad
    from public.soccer_manager_players player
    where player.game_world_id = v_game_world_id
      and player.current_team_id = v_team_id;
  end if;

  -- Next unfinished tournament fixture, with the opponent's SM identifiers where known.
  select jsonb_build_object(
    'matchId', match.id,
    'tournament', tournament.name,
    'round', coalesce(match.round, match.stage),
    'fixtureDate', match.fixture_date,
    'home', match.home_entry_id = own_entry.id,
    'opponent', opponent_team.name,
    'opponentClubDataId', (
      select nullif(entity.data->>'clubDataId', '')
      from public.soccer_manager_club_crosswalk crosswalk
      join public.soccer_manager_canonical_entities entity
        on entity.entity_type = 'standing'
       and entity.data->>'setupId' = crosswalk.source_world_id::text
       and entity.data->>'clubId' = crosswalk.source_club_id
      where crosswalk.game_world_id = tournament.game_world_id
        and crosswalk.team_id = opponent_entry.team_id
      order by entity.last_approved_at desc
      limit 1
    )
  )
    into v_next
  from public.tournament_entries own_entry
  join public.tournaments tournament on tournament.id = own_entry.tournament_id
  join public.matches match
    on match.home_entry_id = own_entry.id or match.away_entry_id = own_entry.id
  left join public.tournament_entries opponent_entry
    on opponent_entry.id = case when match.home_entry_id = own_entry.id then match.away_entry_id else match.home_entry_id end
  left join public.teams opponent_team on opponent_team.id = opponent_entry.team_id
  where own_entry.manager_id = v_manager_id
    and tournament.game_world_id = v_game_world_id
    and tournament.is_public = true
    and coalesce(lower(match.status), 'scheduled') not in ('played', 'forfeit', 'voided', 'cancelled')
  order by match.fixture_date nulls last, match.id
  limit 1;

  return jsonb_build_object(
    'accountId', v_account_id,
    'world', v_world,
    'club', v_club,
    'divisionTable', v_table,
    'squad', v_squad,
    'nextFixture', v_next
  );
end;
$$;

revoke all on function public.get_my_top100_app_home() from public, anon;
grant execute on function public.get_my_top100_app_home() to authenticated;

-- ---------------------------------------------------------------------------
-- Notification storage
-- ---------------------------------------------------------------------------

create table if not exists public.manager_notification_preferences (
  account_id bigint primary key references public.manager_portal_accounts(id) on delete cascade,
  fixtures boolean not null default true,
  results boolean not null default true,
  opponent_actions boolean not null default true,
  match_comments boolean not null default true,
  chat_replies boolean not null default true,
  broadcasts boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_push_subscriptions (
  id bigint generated by default as identity primary key,
  account_id bigint not null references public.manager_portal_accounts(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth_secret text not null check (length(auth_secret) <= 100),
  user_agent text check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);
create index if not exists manager_push_subscriptions_account_idx on public.manager_push_subscriptions(account_id);
create index if not exists manager_push_subscriptions_auth_user_idx on public.manager_push_subscriptions(auth_user_id);

create table if not exists public.manager_notifications (
  id bigint generated by default as identity primary key,
  account_id bigint not null references public.manager_portal_accounts(id) on delete cascade,
  category text not null check (category in ('fixtures', 'results', 'opponent_actions', 'match_comments', 'chat_replies', 'broadcasts')),
  title text not null check (length(title) <= 200),
  body text not null default '' check (length(body) <= 600),
  url text not null default '/' check (length(url) <= 500),
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_status text not null default 'pending' check (push_status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  push_attempts integer not null default 0,
  push_claimed_at timestamptz,
  pushed_at timestamptz,
  push_error text
);
create index if not exists manager_notifications_account_created_idx on public.manager_notifications(account_id, created_at desc);
create index if not exists manager_notifications_pending_idx on public.manager_notifications(created_at) where push_status in ('pending', 'sending');

create table if not exists public.manager_broadcasts (
  id bigint generated by default as identity primary key,
  game_world_id bigint references public.game_worlds(id) on delete set null,
  title text not null,
  body text not null,
  url text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  recipient_count integer not null default 0
);

alter table public.manager_notification_preferences enable row level security;
alter table public.manager_push_subscriptions enable row level security;
alter table public.manager_notifications enable row level security;
alter table public.manager_broadcasts enable row level security;

create policy "Managers read own notification preferences" on public.manager_notification_preferences
  for select to authenticated
  using (exists (select 1 from public.manager_portal_accounts a where a.id = account_id and a.auth_user_id = (select auth.uid()) and a.active));

create policy "Managers read own push subscriptions" on public.manager_push_subscriptions
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy "Managers read own notifications" on public.manager_notifications
  for select to authenticated
  using (exists (select 1 from public.manager_portal_accounts a where a.id = account_id and a.auth_user_id = (select auth.uid()) and a.active));

-- manager_broadcasts is an audit log for the service role only; admins send
-- through send_manager_broadcast(). Manager writes go through the RPCs below.
grant select on public.manager_notification_preferences, public.manager_push_subscriptions,
  public.manager_notifications to authenticated;
grant select, insert, update, delete on public.manager_notification_preferences, public.manager_push_subscriptions,
  public.manager_notifications, public.manager_broadcasts to service_role;

-- ---------------------------------------------------------------------------
-- Enqueueing
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_manager_notification(
  p_account_id bigint,
  p_category text,
  p_title text,
  p_body text,
  p_url text,
  p_dedupe_key text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  if p_account_id is null or p_dedupe_key is null then return; end if;

  select case p_category
           when 'fixtures' then pref.fixtures
           when 'results' then pref.results
           when 'opponent_actions' then pref.opponent_actions
           when 'match_comments' then pref.match_comments
           when 'chat_replies' then pref.chat_replies
           when 'broadcasts' then pref.broadcasts
         end
    into v_enabled
  from public.manager_notification_preferences pref
  where pref.account_id = p_account_id;

  -- A disabled category still lands in the in-app inbox; it just isn't pushed.
  insert into public.manager_notifications (account_id, category, title, body, url, dedupe_key, push_status)
  values (
    p_account_id,
    p_category,
    left(coalesce(nullif(trim(p_title), ''), 'Top 100'), 200),
    left(coalesce(p_body, ''), 600),
    left(coalesce(nullif(trim(p_url), ''), '/'), 500),
    p_dedupe_key,
    case when coalesce(v_enabled, true) then 'pending' else 'skipped' end
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke all on function public.enqueue_manager_notification(bigint, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_manager_notification(bigint, text, text, text, text, text) to service_role;

-- Active Manager Portal accounts behind a tournament entry.
create or replace function public.top100_entry_accounts(p_entry_id bigint)
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  select account.id
  from public.tournament_entries entry
  join public.manager_portal_accounts account on account.manager_id = entry.manager_id and account.active = true
  where entry.id = p_entry_id;
$$;

revoke all on function public.top100_entry_accounts(bigint) from public, anon, authenticated;
grant execute on function public.top100_entry_accounts(bigint) to service_role;

create or replace function public.top100_entry_club_name(p_entry_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(team.name, 'TBC')
  from public.tournament_entries entry
  left join public.teams team on team.id = entry.team_id
  where entry.id = p_entry_id;
$$;

revoke all on function public.top100_entry_club_name(bigint) from public, anon, authenticated;
grant execute on function public.top100_entry_club_name(bigint) to service_role;

create or replace function public.top100_tournament_url(p_tournament_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when world.slug is not null and competition.slug is not null and tournament.public_slug is not null
             then 'https://tournaments.smtop100.blog/' || world.slug || '/' || competition.slug || '/' || tournament.public_slug
           else 'https://tournaments.smtop100.blog/'
         end
  from public.tournaments tournament
  left join public.game_worlds world on world.id = tournament.game_world_id
  left join public.competition_types competition on competition.id = tournament.competition_type_id
  where tournament.id = p_tournament_id;
$$;

revoke all on function public.top100_tournament_url(bigint) from public, anon, authenticated;
grant execute on function public.top100_tournament_url(bigint) to service_role;

-- Fixtures and results.
create or replace function public.notify_managers_of_match_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home text;
  v_away text;
  v_tournament text;
  v_status text := lower(coalesce(new.status, 'scheduled'));
  v_account bigint;
  v_entry bigint;
begin
  begin
    if new.home_entry_id is null or new.away_entry_id is null then return new; end if;

    select tournament.name into v_tournament
    from public.tournaments tournament
    where tournament.id = new.tournament_id and tournament.is_public = true;
    if v_tournament is null then return new; end if;

    v_home := public.top100_entry_club_name(new.home_entry_id);
    v_away := public.top100_entry_club_name(new.away_entry_id);

    if new.fixture_date is not null
       and v_status not in ('played', 'forfeit', 'voided', 'cancelled')
       and (tg_op = 'INSERT'
            or new.fixture_date is distinct from old.fixture_date
            or new.home_entry_id is distinct from old.home_entry_id
            or new.away_entry_id is distinct from old.away_entry_id) then
      foreach v_entry in array array[new.home_entry_id, new.away_entry_id] loop
        for v_account in select public.top100_entry_accounts(v_entry) loop
          perform public.enqueue_manager_notification(
            v_account, 'fixtures',
            'Fixture: ' || v_home || ' v ' || v_away,
            v_tournament || ' · ' || coalesce(new.round, new.stage, 'Fixture') || ' · ' || to_char(new.fixture_date, 'FMDay FMDD Mon'),
            '/',
            'fixture:' || new.id || ':' || new.fixture_date || ':' || new.home_entry_id || ':' || new.away_entry_id || ':' || v_account
          );
        end loop;
      end loop;
    end if;

    if v_status in ('played', 'forfeit')
       and new.home_score is not null and new.away_score is not null
       and (tg_op = 'INSERT'
            or old.status is distinct from new.status
            or old.home_score is distinct from new.home_score
            or old.away_score is distinct from new.away_score) then
      foreach v_entry in array array[new.home_entry_id, new.away_entry_id] loop
        for v_account in select public.top100_entry_accounts(v_entry) loop
          perform public.enqueue_manager_notification(
            v_account, 'results',
            'Result: ' || v_home || ' ' || new.home_score || '–' || new.away_score || ' ' || v_away,
            v_tournament || ' · ' || coalesce(new.round, new.stage, 'Result') || case when v_status = 'forfeit' then ' · forfeit' else '' end,
            '/',
            'result:' || new.id || ':' || v_status || ':' || new.home_score || '-' || new.away_score || ':' || v_account
          );
        end loop;
      end loop;
    end if;
  exception when others then
    raise warning 'notify_managers_of_match_change failed for match %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.notify_managers_of_match_change() from public, anon, authenticated;

drop trigger if exists notify_managers_of_match_change on public.matches;
create trigger notify_managers_of_match_change
after insert or update of fixture_date, home_entry_id, away_entry_id, status, home_score, away_score
on public.matches
for each row
execute function public.notify_managers_of_match_change();

-- Opponent arrangement actions (SM match request sent / received / chased, problem reported).
create or replace function public.notify_opponent_of_arrangement_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match record;
  v_other_entry bigint;
  v_actor text;
  v_body text;
  v_account bigint;
begin
  begin
    select match.home_entry_id, match.away_entry_id, match.tournament_id
      into v_match
    from public.matches match
    join public.tournaments tournament on tournament.id = match.tournament_id and tournament.is_public = true
    where match.id = new.match_id;
    if not found or new.tournament_entry_id is null then return new; end if;

    v_other_entry := case
      when new.tournament_entry_id = v_match.home_entry_id then v_match.away_entry_id
      when new.tournament_entry_id = v_match.away_entry_id then v_match.home_entry_id
    end;
    if v_other_entry is null then return new; end if;

    v_actor := public.top100_entry_club_name(new.tournament_entry_id);
    v_body := case new.action
      when 'sent' then v_actor || ' has sent the Soccer Manager match request. Accept it in SM.'
      when 'received' then v_actor || ' has received your Soccer Manager match request.'
      when 'chased' then v_actor || ' is still waiting for your Soccer Manager match request.'
      when 'problem' then v_actor || ' has reported a problem arranging the fixture.'
      else v_actor || ' updated the fixture arrangement.'
    end;

    for v_account in select public.top100_entry_accounts(v_other_entry) loop
      perform public.enqueue_manager_notification(
        v_account, 'opponent_actions',
        'Your opponent: ' || v_actor,
        v_body,
        '/',
        'arrangement:' || new.id || ':' || v_account
      );
    end loop;
  exception when others then
    raise warning 'notify_opponent_of_arrangement_action failed for event %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.notify_opponent_of_arrangement_action() from public, anon, authenticated;

drop trigger if exists notify_opponent_of_arrangement_action on public.manager_match_arrangement_events;
create trigger notify_opponent_of_arrangement_action
after insert on public.manager_match_arrangement_events
for each row
execute function public.notify_opponent_of_arrangement_action();

-- Match comments on a manager's own fixtures.
create or replace function public.notify_managers_of_match_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match record;
  v_home text;
  v_away text;
  v_url text;
  v_entry bigint;
  v_account bigint;
  v_author_key text := lower(regexp_replace(coalesce(new.manager_name, ''), '[^[:alnum:]]+', '', 'g'));
begin
  begin
    if new.status <> 'visible' then return new; end if;

    select match.home_entry_id, match.away_entry_id, match.tournament_id
      into v_match
    from public.matches match
    join public.tournaments tournament on tournament.id = match.tournament_id and tournament.is_public = true
    where match.id = new.match_id;
    if not found or v_match.home_entry_id is null or v_match.away_entry_id is null then return new; end if;

    v_home := public.top100_entry_club_name(v_match.home_entry_id);
    v_away := public.top100_entry_club_name(v_match.away_entry_id);
    v_url := public.top100_tournament_url(v_match.tournament_id);

    foreach v_entry in array array[v_match.home_entry_id, v_match.away_entry_id] loop
      for v_account in
        select account_id
        from public.top100_entry_accounts(v_entry) as account_id
        join public.manager_portal_accounts account on account.id = account_id
        join public.managers manager on manager.id = account.manager_id
        -- Don't notify managers about their own comments.
        where v_author_key = ''
           or v_author_key not in (
             lower(regexp_replace(coalesce(manager.display_name, ''), '[^[:alnum:]]+', '', 'g')),
             lower(regexp_replace(coalesce(manager.name, ''), '[^[:alnum:]]+', '', 'g'))
           )
      loop
        perform public.enqueue_manager_notification(
          v_account, 'match_comments',
          'New comment: ' || v_home || ' v ' || v_away,
          coalesce(nullif(trim(new.manager_name), '') || ': ', '') || left(new.comment, 160),
          v_url,
          'comment:' || new.id || ':' || v_account
        );
      end loop;
    end loop;
  exception when others then
    raise warning 'notify_managers_of_match_comment failed for comment %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.notify_managers_of_match_comment() from public, anon, authenticated;

drop trigger if exists notify_managers_of_match_comment on public.match_comments;
create trigger notify_managers_of_match_comment
after insert on public.match_comments
for each row
execute function public.notify_managers_of_match_comment();

-- Day-before and fixture-day reminders, called by the scheduled dispatcher.
-- Reminders start from 08:00 UK time so nobody is woken overnight.
create or replace function public.enqueue_due_fixture_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/London')::date;
  v_count integer := 0;
  v_row record;
  v_account bigint;
  v_entry bigint;
begin
  if extract(hour from now() at time zone 'Europe/London') < 8 then return 0; end if;

  for v_row in
    select match.id, match.fixture_date, match.home_entry_id, match.away_entry_id, match.round, match.stage, tournament.name as tournament
    from public.matches match
    join public.tournaments tournament on tournament.id = match.tournament_id and tournament.is_public = true
    where match.fixture_date in (v_today, v_today + 1)
      and match.home_entry_id is not null
      and match.away_entry_id is not null
      and coalesce(lower(match.status), 'scheduled') not in ('played', 'forfeit', 'voided', 'cancelled')
  loop
    foreach v_entry in array array[v_row.home_entry_id, v_row.away_entry_id] loop
      for v_account in select public.top100_entry_accounts(v_entry) loop
        perform public.enqueue_manager_notification(
          v_account, 'fixtures',
          case when v_row.fixture_date = v_today then 'Today: ' else 'Tomorrow: ' end
            || public.top100_entry_club_name(v_row.home_entry_id) || ' v ' || public.top100_entry_club_name(v_row.away_entry_id),
          v_row.tournament || ' · ' || coalesce(v_row.round, v_row.stage, 'Fixture')
            || case when v_row.fixture_date = v_today then ' · submit the result once it is played' else ' · make sure the SM match is arranged' end,
          '/',
          'fixture-reminder:' || v_row.id || ':' || v_row.fixture_date || ':' || (v_row.fixture_date = v_today) || ':' || v_account
        );
        v_count := v_count + 1;
      end loop;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.enqueue_due_fixture_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_due_fixture_reminders() to service_role;

-- Admin broadcasts.
create or replace function public.send_manager_broadcast(
  p_title text,
  p_body text,
  p_url text default null,
  p_game_world_id bigint default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_broadcast_id bigint;
  v_account bigint;
  v_url text := coalesce(nullif(trim(p_url), ''), '/');
  v_count integer := 0;
begin
  if not public.is_admin() then raise exception 'Global administrator required'; end if;
  if length(trim(coalesce(p_title, ''))) not between 3 and 120 then raise exception 'Title must be 3–120 characters'; end if;
  if length(trim(coalesce(p_body, ''))) not between 1 and 500 then raise exception 'Message must be 1–500 characters'; end if;
  if v_url !~ '^(/|https://([a-z0-9-]+\.)*smtop100\.blog(/|$))' then raise exception 'Links must point to a Top 100 page'; end if;

  insert into public.manager_broadcasts (game_world_id, title, body, url, created_by)
  values (p_game_world_id, trim(p_title), trim(p_body), v_url, auth.uid())
  returning id into v_broadcast_id;

  for v_account in
    select account.id from public.manager_portal_accounts account
    where account.active = true
      and (p_game_world_id is null or account.game_world_id = p_game_world_id)
  loop
    perform public.enqueue_manager_notification(v_account, 'broadcasts', trim(p_title), trim(p_body), v_url, 'broadcast:' || v_broadcast_id || ':' || v_account);
    v_count := v_count + 1;
  end loop;

  update public.manager_broadcasts set recipient_count = v_count where id = v_broadcast_id;
  return v_count;
end;
$$;

revoke all on function public.send_manager_broadcast(text, text, text, bigint) from public, anon;
grant execute on function public.send_manager_broadcast(text, text, text, bigint) to authenticated;

-- Top 100 Chat reply events, forwarded by the chat gateway through the
-- chat-push-event Netlify function (service role).
create or replace function public.enqueue_chat_reply_notification(
  p_manager_id bigint,
  p_author text,
  p_excerpt text,
  p_url text,
  p_event_key text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account bigint;
  v_count integer := 0;
  v_url text := coalesce(nullif(trim(p_url), ''), 'https://chat.smtop100.blog/');
begin
  if v_url !~ '^https://chat\.smtop100\.blog(/|$)' then v_url := 'https://chat.smtop100.blog/'; end if;
  for v_account in
    select account.id
    from public.manager_portal_accounts account
    join public.game_worlds world on world.id = account.game_world_id and world.slug = 'top-100'
    where account.manager_id = p_manager_id and account.active = true
  loop
    perform public.enqueue_manager_notification(
      v_account, 'chat_replies',
      coalesce(nullif(trim(p_author), ''), 'A manager') || ' replied in Top 100 Chat',
      left(coalesce(p_excerpt, ''), 200),
      v_url,
      'chat:' || left(p_event_key, 200) || ':' || v_account
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.enqueue_chat_reply_notification(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_chat_reply_notification(bigint, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Manager-facing RPCs
-- ---------------------------------------------------------------------------

create or replace function public.top100_my_account_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select account.id from public.manager_portal_accounts account
  where account.auth_user_id = (select auth.uid()) and account.active = true
  order by account.id desc
  limit 1;
$$;

revoke all on function public.top100_my_account_id() from public, anon, authenticated;

create or replace function public.save_my_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id bigint := public.top100_my_account_id();
begin
  if v_account_id is null then raise exception 'Active Manager Portal account required'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' then raise exception 'Invalid push subscription'; end if;
  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'Invalid push subscription keys'; end if;

  -- A shared browser may have switched accounts: the endpoint moves to the current one.
  insert into public.manager_push_subscriptions (account_id, auth_user_id, endpoint, p256dh, auth_secret, user_agent)
  values (v_account_id, auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set account_id = excluded.account_id,
        auth_user_id = excluded.auth_user_id,
        p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        user_agent = excluded.user_agent,
        failure_count = 0,
        updated_at = now();

  if (select count(*) from public.manager_push_subscriptions where account_id = v_account_id) > 10 then
    delete from public.manager_push_subscriptions
    where id in (
      select id from public.manager_push_subscriptions
      where account_id = v_account_id
      order by updated_at desc
      offset 10
    );
  end if;
end;
$$;

revoke all on function public.save_my_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_my_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_my_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.manager_push_subscriptions
  where endpoint = p_endpoint and auth_user_id = (select auth.uid());
$$;

revoke all on function public.delete_my_push_subscription(text) from public, anon;
grant execute on function public.delete_my_push_subscription(text) to authenticated;

create or replace function public.set_my_notification_preferences(p_preferences jsonb)
returns public.manager_notification_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id bigint := public.top100_my_account_id();
  v_row public.manager_notification_preferences;
begin
  if v_account_id is null then raise exception 'Active Manager Portal account required'; end if;

  insert into public.manager_notification_preferences as pref (account_id, fixtures, results, opponent_actions, match_comments, chat_replies, broadcasts)
  values (
    v_account_id,
    coalesce((p_preferences->>'fixtures')::boolean, true),
    coalesce((p_preferences->>'results')::boolean, true),
    coalesce((p_preferences->>'opponent_actions')::boolean, true),
    coalesce((p_preferences->>'match_comments')::boolean, true),
    coalesce((p_preferences->>'chat_replies')::boolean, true),
    coalesce((p_preferences->>'broadcasts')::boolean, true)
  )
  on conflict (account_id) do update
    set fixtures = coalesce((p_preferences->>'fixtures')::boolean, pref.fixtures),
        results = coalesce((p_preferences->>'results')::boolean, pref.results),
        opponent_actions = coalesce((p_preferences->>'opponent_actions')::boolean, pref.opponent_actions),
        match_comments = coalesce((p_preferences->>'match_comments')::boolean, pref.match_comments),
        chat_replies = coalesce((p_preferences->>'chat_replies')::boolean, pref.chat_replies),
        broadcasts = coalesce((p_preferences->>'broadcasts')::boolean, pref.broadcasts),
        updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_my_notification_preferences(jsonb) from public, anon;
grant execute on function public.set_my_notification_preferences(jsonb) to authenticated;

create or replace function public.mark_my_notifications_read(p_ids bigint[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.manager_notifications notification
     set read_at = now()
   where notification.read_at is null
     and (p_ids is null or notification.id = any(p_ids))
     and exists (
       select 1 from public.manager_portal_accounts account
       where account.id = notification.account_id
         and account.auth_user_id = (select auth.uid())
         and account.active
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_my_notifications_read(bigint[]) from public, anon;
grant execute on function public.mark_my_notifications_read(bigint[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Delivery (service role, used by netlify/functions/lib/pushDispatch.mjs)
-- ---------------------------------------------------------------------------

-- Claims a batch of pending notifications together with the devices to push to.
-- Rows stuck in 'sending' for 10 minutes (a crashed run) are reclaimed.
create or replace function public.claim_pending_push_notifications(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed jsonb;
begin
  with candidates as (
    select notification.id
    from public.manager_notifications notification
    where (notification.push_status = 'pending'
           or (notification.push_status = 'sending' and notification.push_claimed_at < now() - interval '10 minutes'))
      and notification.created_at > now() - interval '2 days'
    order by notification.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  ), claimed as (
    update public.manager_notifications notification
       set push_status = 'sending',
           push_claimed_at = now(),
           push_attempts = notification.push_attempts + 1
      from candidates
     where notification.id = candidates.id
    returning notification.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', claimed.id,
    'attempts', claimed.push_attempts,
    'title', claimed.title,
    'body', claimed.body,
    'url', claimed.url,
    'category', claimed.category,
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', sub.endpoint, 'p256dh', sub.p256dh, 'auth', sub.auth_secret))
      from public.manager_push_subscriptions sub
      where sub.account_id = claimed.account_id
    ), '[]'::jsonb)
  )), '[]'::jsonb)
    into v_claimed
  from claimed;

  -- Old pending work is not worth pushing any more; keep the inbox tidy.
  update public.manager_notifications
     set push_status = 'skipped', push_error = 'expired before delivery'
   where push_status in ('pending', 'sending') and created_at <= now() - interval '2 days';
  delete from public.manager_notifications where created_at < now() - interval '120 days';

  return v_claimed;
end;
$$;

revoke all on function public.claim_pending_push_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_pending_push_notifications(integer) to service_role;

-- p_results: [{ "id": 1, "status": "sent"|"skipped"|"failed"|"pending", "error": "..." }]
-- p_gone_endpoints: endpoints the push service reported as expired (404/410).
create or replace function public.complete_push_notifications(p_results jsonb, p_gone_endpoints text[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.manager_notifications notification
     set push_status = case
                         when result.status = 'pending' and notification.push_attempts >= 5 then 'failed'
                         else result.status
                       end,
         pushed_at = case when result.status = 'sent' then now() else notification.pushed_at end,
         push_error = left(result.error, 500),
         push_claimed_at = null
    from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as result(id bigint, status text, error text)
   where notification.id = result.id
     and notification.push_status = 'sending'
     and result.status in ('sent', 'skipped', 'failed', 'pending');

  delete from public.manager_push_subscriptions where endpoint = any(coalesce(p_gone_endpoints, '{}'));
end;
$$;

revoke all on function public.complete_push_notifications(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.complete_push_notifications(jsonb, text[]) to service_role;

-- Wake the dispatcher right after new pending notifications commit. pg_net
-- queues the request inside this transaction, so a rolled-back write sends nothing.
-- Vault secrets: top100_push_dispatch_url, top100_push_dispatch_secret.
create or replace function public.wake_push_dispatcher()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  dispatch_url text;
  dispatch_secret text;
begin
  if not exists (select 1 from inserted where push_status = 'pending') then return null; end if;
  -- One wake per transaction is enough: a bulk fixture import enqueues many rows.
  if current_setting('top100.push_dispatcher_woken', true) = 'on' then return null; end if;
  perform set_config('top100.push_dispatcher_woken', 'on', true);

  begin
    select decrypted_secret into dispatch_url from vault.decrypted_secrets
    where name = 'top100_push_dispatch_url' order by created_at desc limit 1;
    select decrypted_secret into dispatch_secret from vault.decrypted_secrets
    where name = 'top100_push_dispatch_secret' order by created_at desc limit 1;
  exception when others then
    return null;
  end;

  if coalesce(dispatch_url, '') = '' or coalesce(dispatch_secret, '') = '' then return null; end if;

  begin
    perform net.http_post(
      url := dispatch_url,
      headers := jsonb_build_object('content-type', 'application/json', 'x-top100-push-secret', dispatch_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

revoke all on function public.wake_push_dispatcher() from public, anon, authenticated;

drop trigger if exists wake_push_dispatcher on public.manager_notifications;
create trigger wake_push_dispatcher
after insert on public.manager_notifications
referencing new table as inserted
for each statement
execute function public.wake_push_dispatcher();
