-- Squad changes made before a club's current manager was appointed are not
-- that manager's breach: Standard Liège signed three loans while it had no
-- manager (S28), and they went back when the new manager took over.
-- A breach that began before the current assignment is marked inherited; the
-- manager is not notified and the administrators' alert says why.

alter table public.squad_cap_breaches add column inherited boolean not null default false;

comment on column public.squad_cap_breaches.inherited is
  'The breach began before the club''s current manager was appointed (for example loans signed while the club had no manager). The manager is not notified.';

create or replace function public.squad_cap_mark_inherited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.inherited := exists (
    select 1 from public.soccer_manager_world_manager_assignments assignment
    where assignment.game_world_id = new.game_world_id
      and assignment.team_id = new.team_id
      and new.started_on is not null
      and assignment.assigned_at::date > new.started_on
  );
  return new;
end;
$$;

create trigger squad_cap_breaches_inherited
  before insert or update of started_on, team_id on public.squad_cap_breaches
  for each row execute function public.squad_cap_mark_inherited();

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

  for v_breach in
    select * from public.squad_cap_breaches
    where manager_notified_at is null
      and status <> 'dismissed'
      and not inherited
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
        case
          when v_breach.inherited then 'Began before ' || coalesce(v_breach.manager_name, 'the current manager') || ' was appointed, so they have not been notified.'
          else coalesce(v_breach.manager_name, 'No manager on record')
            || case when exists (select 1 from public.manager_portal_accounts account
                                 where account.manager_id = v_breach.manager_id and account.active = true)
                 then case when v_breach.confidence = 'confirmed' then ' has been notified.' else ' is notified once you uphold it.' end
                 else ' has no Manager Portal account: contact them directly.' end
        end
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

-- Only where Soccer Manager Sync's tables exist (not in a bare migration replay).
do $$
begin
  if to_regclass('public.soccer_manager_club_crosswalk') is not null then
    perform public.refresh_squad_cap_breaches('top-100', 50);
  end if;
end;
$$;
