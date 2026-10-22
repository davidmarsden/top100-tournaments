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
