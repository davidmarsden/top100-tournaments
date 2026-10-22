-- Back off before retrying a push that failed transiently (rate limit, push
-- service outage). complete_push_notifications now stamps push_claimed_at on a
-- row it returns to 'pending', and claim_pending_push_notifications skips such
-- rows for four minutes, so one dispatcher run cannot burn all five attempts
-- before the push service recovers. The scheduled sweep retries them.

create or replace function public.complete_push_notifications(p_results jsonb, p_gone_endpoints text[] default array[]::text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.manager_notifications as notification
     set push_status = case
                         when outcome.status = 'pending' and notification.push_attempts >= 5 then 'failed'
                         else outcome.status
                       end,
         pushed_at = case when outcome.status = 'sent' then now() else notification.pushed_at end,
         push_error = left(outcome.error, 500),
         push_claimed_at = case when outcome.status = 'pending' then now() end
    from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as outcome(id bigint, status text, error text)
   where notification.id = outcome.id
     and notification.push_status = 'sending'
     and outcome.status in ('sent', 'skipped', 'failed', 'pending');

  if cardinality(p_gone_endpoints) > 0 then
    delete from public.manager_push_subscriptions as sub
     where sub.endpoint = any(p_gone_endpoints);
  end if;
end;
$$;

revoke all on function public.complete_push_notifications(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.complete_push_notifications(jsonb, text[]) to service_role;

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
    where ((notification.push_status = 'pending'
            and (notification.push_claimed_at is null or notification.push_claimed_at < now() - interval '4 minutes'))
           or (notification.push_status = 'sending' and notification.push_claimed_at < now() - interval '10 minutes'))
      and notification.created_at > now() - interval '2 days'
    order by notification.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  ), claimed as (
    update public.manager_notifications as notification
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

  -- Old pending work is not worth pushing any more.
  update public.manager_notifications as stale
     set push_status = 'skipped', push_error = 'expired before delivery'
   where stale.push_status in ('pending', 'sending') and stale.created_at <= now() - interval '2 days';

  return v_claimed;
end;
$$;

revoke all on function public.claim_pending_push_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_pending_push_notifications(integer) to service_role;
