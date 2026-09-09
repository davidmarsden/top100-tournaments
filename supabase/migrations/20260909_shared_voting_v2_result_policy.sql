-- Manual-release events must not expose final result rows before an admin releases them.
drop policy if exists "Eligible managers can read final voting results" on public.voting_event_results;

create policy "Eligible managers can read final voting results"
on public.voting_event_results for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.voting_events ve
    join public.manager_portal_accounts a
      on a.auth_user_id = auth.uid() and a.active = true
    join public.voting_electorate e
      on e.manager_id = a.manager_id and e.event_id = ve.id
    where ve.id = voting_event_results.event_id
      and ve.results_visibility <> 'hidden'
      and (
        ve.results_visibility <> 'manual_release'
        or ve.results_released_at is not null
      )
      and (
        ve.results_visibility <> 'after_close'
        or ve.status = 'closed'
        or (ve.closes_at is not null and now() >= ve.closes_at)
      )
  )
);
