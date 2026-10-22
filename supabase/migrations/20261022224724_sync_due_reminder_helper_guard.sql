-- soccer_manager_world_standings_reviewed_at() is created by the Manager Lab
-- repository's migrations, not this one. Look it up at run time so a database
-- built from this repository alone skips the reminder instead of erroring.
create or replace function public.enqueue_sync_due_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/London')::date;
  v_last_sync timestamptz;
  v_account bigint;
  v_count integer := 0;
begin
  if extract(hour from now() at time zone 'Europe/London') < 9 then return 0; end if;
  if to_regprocedure('public.soccer_manager_world_standings_reviewed_at()') is null then return 0; end if;

  execute $sql$
    select reviewed.reviewed_sync_captured_at
    from public.soccer_manager_world_standings_reviewed_at() reviewed
    join public.game_worlds world on world.id = reviewed.game_world_id
    where world.slug = 'top-100'
  $sql$ into v_last_sync;

  if v_last_sync is not null and v_last_sync > now() - interval '24 hours' then return 0; end if;

  for v_account in
    select account.id
    from public.manager_portal_accounts account
    join public.admin_users admin on admin.user_id = account.auth_user_id
    where account.active = true
  loop
    perform public.enqueue_manager_notification(
      v_account, 'admin_alerts',
      'Top 100 sync due',
      'Last synced ' || coalesce(to_char(v_last_sync at time zone 'Europe/London', 'FMDD Mon, HH24:MI'), 'never')
        || '. In Soccer Manager, run Top 100 Sync and tap Sync everything.',
      'https://lab.smtop100.blog/sync',
      'sync-due:' || v_today || ':' || v_account
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.enqueue_sync_due_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_sync_due_reminders() to service_role;
