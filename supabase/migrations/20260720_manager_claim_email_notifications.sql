-- Best-effort administrator email notifications for pending manager claims.
--
-- Required Supabase Vault secrets (configured after this migration):
--   manager_claim_notification_url
--   manager_claim_webhook_secret
--
-- A claim is notified once while it remains pending. If an administrator rejects
-- it and the manager later resubmits, the notification state is reset so the new
-- request can generate a fresh alert.

create extension if not exists pg_net with schema extensions;

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
  -- Notification configuration is deliberately optional. Missing Vault secrets
  -- must never prevent a manager from submitting or correcting a claim.
  begin
    select decrypted_secret into notification_url
    from vault.decrypted_secrets
    where name = 'manager_claim_notification_url'
    limit 1;

    select decrypted_secret into webhook_secret
    from vault.decrypted_secrets
    where name = 'manager_claim_webhook_secret'
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
      body := jsonb_build_object('claimId', new.id)
    );
  exception when others then
    -- pg_net and email delivery are best-effort. The claim remains valid even if
    -- the notification service is temporarily unavailable.
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
  'When the administrator notification email was reserved/sent for the current pending review cycle.';

comment on column public.manager_portal_claims.admin_notification_error is
  'Most recent best-effort administrator notification failure, retained for diagnostics.';
