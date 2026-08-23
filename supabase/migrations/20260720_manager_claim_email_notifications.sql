-- Best-effort administrator email notifications for pending manager claims.
-- Requires Supabase Vault secrets:
--   manager_claim_notification_url
--   manager_claim_webhook_secret

create extension if not exists pg_net;

alter table public.manager_portal_claims
  add column if not exists admin_notified_at timestamptz,
  add column if not exists admin_notification_error text,
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
    new.admin_notification_key := gen_random_uuid();
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

drop trigger if exists protect_manager_claim_notification_state
  on public.manager_portal_claims;

create trigger protect_manager_claim_notification_state
before insert or update
on public.manager_portal_claims
for each row
execute function public.protect_manager_claim_notification_state();

create or replace function public.notify_admin_of_pending_manager_claim()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  notification_url text;
  webhook_secret text;
begin
  begin
    select decrypted_secret into notification_url
    from vault.decrypted_secrets
    where name = 'manager_claim_notification_url'
    order by created_at desc
    limit 1;

    select decrypted_secret into webhook_secret
    from vault.decrypted_secrets
    where name = 'manager_claim_webhook_secret'
    order by created_at desc
    limit 1;
  exception when others then
    return new;
  end;

  if coalesce(notification_url, '') = '' or coalesce(webhook_secret, '') = '' then
    return new;
  end if;

  begin
    perform net.http_post(
      url := notification_url,
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-manager-claim-webhook-secret', webhook_secret
      ),
      body := jsonb_build_object('claimId', new.id),
      timeout_milliseconds := 5000
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

drop trigger if exists notify_admin_of_pending_manager_claim
  on public.manager_portal_claims;

create trigger notify_admin_of_pending_manager_claim
after insert or update of status, claimed_manager_name, claimed_club_name
on public.manager_portal_claims
for each row
when (new.status = 'pending')
execute function public.notify_admin_of_pending_manager_claim();

comment on column public.manager_portal_claims.admin_notified_at is
  'When the administrator notification was reserved/sent for the current pending review cycle.';

comment on column public.manager_portal_claims.admin_notification_error is
  'Most recent best-effort administrator notification failure, retained for diagnostics.';

comment on column public.manager_portal_claims.admin_notification_key is
  'Stable idempotency key for the current pending review cycle; replaced only when a rejected claim is resubmitted.';
