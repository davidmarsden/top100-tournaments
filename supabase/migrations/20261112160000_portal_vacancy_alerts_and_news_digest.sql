-- Manager Portal notifications for vacancies and a daily news digest.
--
-- 1. Vacancies notify every manager automatically: notify_new_vacancies() (service role, run every
--    10 minutes by netlify/functions/portal-news.mjs) sends one Announcements notification per open
--    vacancy, 15 minutes after it is created (so the admin team can correct it first), within three
--    days and while it is still open. Each manager gets each vacancy once (dedupe key).
-- 2. A new "news" category: one evening digest a day of new blog posts, new managers and votes
--    opening, built by portal-news.mjs and sent with enqueue_news_digest() (service role). Managers
--    can turn off its push alerts in their notification settings; it still lands in the inbox.

alter table public.manager_notification_preferences
  add column if not exists news boolean not null default true;

alter table public.manager_notifications drop constraint if exists manager_notifications_category_check;
alter table public.manager_notifications add constraint manager_notifications_category_check
  check (category in ('fixtures', 'results', 'opponent_actions', 'match_comments', 'chat_replies', 'broadcasts', 'admin_alerts', 'news'));

create or replace function public.enqueue_manager_notification(p_account_id bigint, p_category text, p_title text, p_body text, p_url text, p_dedupe_key text)
returns void
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
           when 'news' then pref.news
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

  insert into public.manager_notification_preferences as pref (account_id, fixtures, results, opponent_actions, match_comments, chat_replies, broadcasts, news)
  values (
    v_account_id,
    coalesce((p_preferences->>'fixtures')::boolean, true),
    coalesce((p_preferences->>'results')::boolean, true),
    coalesce((p_preferences->>'opponent_actions')::boolean, true),
    coalesce((p_preferences->>'match_comments')::boolean, true),
    coalesce((p_preferences->>'chat_replies')::boolean, true),
    coalesce((p_preferences->>'broadcasts')::boolean, true),
    coalesce((p_preferences->>'news')::boolean, true)
  )
  on conflict (account_id) do update
    set fixtures = coalesce((p_preferences->>'fixtures')::boolean, pref.fixtures),
        results = coalesce((p_preferences->>'results')::boolean, pref.results),
        opponent_actions = coalesce((p_preferences->>'opponent_actions')::boolean, pref.opponent_actions),
        match_comments = coalesce((p_preferences->>'match_comments')::boolean, pref.match_comments),
        chat_replies = coalesce((p_preferences->>'chat_replies')::boolean, pref.chat_replies),
        broadcasts = coalesce((p_preferences->>'broadcasts')::boolean, pref.broadcasts),
        news = coalesce((p_preferences->>'news')::boolean, pref.news),
        updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

-- One notification per open vacancy per manager, once it has settled. Returns how many were queued
-- (an already-notified manager doesn't count again).
create or replace function public.notify_new_vacancies(p_world_slug text default 'top-100')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_vacancy public.appointment_vacancies;
  v_count integer := 0;
  v_added integer;
begin
  for v_vacancy in
    select * from public.appointment_vacancies vacancy
    where vacancy.game_world_id = v_world and vacancy.status = 'open' and vacancy.published_at is null
      and vacancy.created_at between now() - interval '3 days' and now() - interval '15 minutes'
      and (vacancy.closes_at is null or vacancy.closes_at > now())
    order by vacancy.created_at
  loop
    insert into public.manager_notifications (account_id, category, title, body, url, dedupe_key, push_status)
    select account.id, 'broadcasts',
      left('Vacancy: ' || v_vacancy.club_name || ' (Division ' || v_vacancy.division || ')', 200),
      left(coalesce(v_vacancy.context || ' ', '') || 'Apply in Manager Portal'
        || coalesce(' by ' || to_char(v_vacancy.closes_at at time zone 'Europe/London', 'FMDD Mon HH24:MI') || ' (UK)', '') || '.', 600),
      'https://manager.smtop100.blog/appointments',
      'vacancy:' || v_vacancy.id || ':' || account.id,
      case when coalesce(pref.broadcasts, true) then 'pending' else 'skipped' end
    from public.manager_portal_accounts account
    left join public.manager_notification_preferences pref on pref.account_id = account.id
    where account.active and account.manager_id is not null
    on conflict (dedupe_key) do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.notify_new_vacancies(text) from public, anon, authenticated;
grant execute on function public.notify_new_vacancies(text) to service_role;

-- The evening news digest, once per manager per day (p_day). Returns how many were queued.
create or replace function public.enqueue_news_digest(p_day date, p_title text, p_body text, p_url text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_day is null or nullif(trim(p_body), '') is null then return 0; end if;
  insert into public.manager_notifications (account_id, category, title, body, url, dedupe_key, push_status)
  select account.id, 'news', left(coalesce(nullif(trim(p_title), ''), 'Top 100 today'), 200), left(p_body, 600),
    left(coalesce(nullif(trim(p_url), ''), 'https://smtop100.blog/'), 500),
    'digest:' || p_day || ':' || account.id,
    case when coalesce(pref.news, true) then 'pending' else 'skipped' end
  from public.manager_portal_accounts account
  left join public.manager_notification_preferences pref on pref.account_id = account.id
  where account.active and account.manager_id is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.enqueue_news_digest(date, text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_news_digest(date, text, text, text) to service_role;
