-- Add a stable Resend idempotency key for each manager-claim review cycle.
-- This is a forward migration because 20260720_manager_claim_email_notifications.sql
-- may already have been applied in production.

alter table public.manager_portal_claims
  add column if not exists admin_notification_key uuid not null default gen_random_uuid();

create or replace function public.protect_manager_claim_notification_state()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  -- The Netlify notification worker uses the Supabase service-role credential and
  -- must be able to reserve/release notification state. SQL maintenance by the
  -- postgres role is also trusted. Authenticated manager/admin browser sessions
  -- are never allowed to write these server-owned columns directly.
  if current_user in ('postgres', 'service_role') or jwt_role = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.admin_notified_at := null;
    new.admin_notification_error := null;
    new.admin_notification_key := coalesce(new.admin_notification_key, gen_random_uuid());
    return new;
  end if;

  if old.status = 'rejected' and new.status = 'pending' then
    new.admin_notified_at := null;
    new.admin_notification_error := null;
    new.admin_notification_key := gen_random_uuid();
  else
    new.admin_notified_at := old.admin_notified_at;
    new.admin_notification_error := old.admin_notification_error;
    new.admin_notification_key := old.admin_notification_key;
  end if;

  return new;
end;
$$;

comment on column public.manager_portal_claims.admin_notification_key is
  'Stable Resend idempotency key for the current pending review cycle; replaced only when a rejected claim is resubmitted.';
