-- Push administrators only for confirmed and likely squad-limit breaches.
--
-- The first run over S28 data found 26 "possible" breaches: clubs over 50 only
-- in the worst-case reading of the transfers, where a youth intake or a release
-- (a squad change that is not a transfer) could explain the gap. They stay in the
-- register and on lab.smtop100.blog/compliance for review, without a push.
-- An upheld breach is still pushed whatever its confidence.

create or replace function public.enqueue_squad_cap_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_breach public.squad_cap_breaches;
  v_account bigint;
  v_count integer := 0;
  v_rules_url constant text := 'https://smtop100.blog/rules/';
  v_admin_url constant text := 'https://lab.smtop100.blog/compliance';
begin
  perform public.refresh_squad_cap_breaches('top-100', 50);

  -- Managers: confirmed breaches that are still open, and anything an administrator upheld.
  for v_breach in
    select * from public.squad_cap_breaches
    where manager_notified_at is null
      and status <> 'dismissed'
      and ((confidence = 'confirmed' and status = 'open') or status = 'upheld')
  loop
    for v_account in
      select account.id from public.manager_portal_accounts account
      where account.manager_id = v_breach.manager_id and account.active = true
    loop
      perform public.enqueue_manager_notification(
        v_account, 'admin_alerts',
        'Squad limit: ' || v_breach.club_name,
        public.squad_cap_breach_message(v_breach),
        v_rules_url,
        'squad-cap:' || v_breach.id || ':manager:' || v_account
      );
      v_count := v_count + 1;
    end loop;
    update public.squad_cap_breaches set manager_notified_at = now() where id = v_breach.id;
  end loop;

  -- Administrators: every new breach, with the manager's reach so a missing
  -- Manager Portal account can be followed up directly.
  for v_breach in
    select * from public.squad_cap_breaches
    where admins_notified_at is null and status <> 'dismissed'
      and (confidence in ('confirmed', 'likely') or status = 'upheld')
  loop
    for v_account in
      select account.id
      from public.manager_portal_accounts account
      join public.admin_users admin on admin.user_id = account.auth_user_id
      where account.active = true
    loop
      perform public.enqueue_manager_notification(
        v_account, 'admin_alerts',
        case v_breach.confidence
          when 'confirmed' then 'Squad limit breach: '
          when 'likely' then 'Likely squad limit breach: '
          else 'Possible squad limit breach: '
        end || v_breach.club_name || ' (' || v_breach.peak_count || ')',
        coalesce(v_breach.manager_name, 'No manager on record')
          || case when exists (select 1 from public.manager_portal_accounts account
                               where account.manager_id = v_breach.manager_id and account.active = true)
               then case when v_breach.confidence = 'confirmed' then ' has been notified.' else ' is notified once you uphold it.' end
               else ' has no Manager Portal account: contact them directly.' end
          || case when v_breach.status = 'resolved' then ' Already back within the limit.' else '' end,
        v_admin_url,
        'squad-cap:' || v_breach.id || ':admin:' || v_account
      );
      v_count := v_count + 1;
    end loop;
    update public.squad_cap_breaches set admins_notified_at = now() where id = v_breach.id;
  end loop;

  return v_count;
end;
$$;


revoke all on function public.enqueue_squad_cap_alerts() from public, anon, authenticated;
grant execute on function public.enqueue_squad_cap_alerts() to service_role;
