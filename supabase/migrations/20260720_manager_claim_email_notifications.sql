-- Track best-effort administrator email notifications for manager claims.
--
-- A claim is notified once while it remains pending. If an administrator rejects
-- it and the manager later resubmits, the notification state is reset so the new
-- request can generate a fresh alert.

alter table public.manager_portal_claims
  add column if not exists admin_notified_at timestamptz,
  add column if not exists admin_notification_error text;

create or replace function public.reset_manager_claim_notification_on_resubmit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'rejected' and new.status = 'pending' then
    new.admin_notified_at := null;
    new.admin_notification_error := null;
  end if;

  return new;
end;
$$;

drop trigger if exists reset_manager_claim_notification_on_resubmit
  on public.manager_portal_claims;

create trigger reset_manager_claim_notification_on_resubmit
before update of status
on public.manager_portal_claims
for each row
execute function public.reset_manager_claim_notification_on_resubmit();

comment on column public.manager_portal_claims.admin_notified_at is
  'When the administrator notification email was successfully reserved/sent for the current pending review cycle.';

comment on column public.manager_portal_claims.admin_notification_error is
  'Most recent best-effort administrator notification failure, retained for diagnostics.';
