-- p_results: [{ "id": 1, "status": "sent"|"skipped"|"failed"|"pending", "error": "..." }]
-- p_gone_endpoints: endpoints the push service reported as expired (404/410).
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
         push_claimed_at = null
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
