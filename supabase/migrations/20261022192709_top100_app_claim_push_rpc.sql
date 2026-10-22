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
