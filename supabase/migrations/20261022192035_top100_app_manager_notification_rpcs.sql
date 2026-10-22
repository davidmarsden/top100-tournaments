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
