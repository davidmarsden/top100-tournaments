create or replace function public.wake_push_dispatcher()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  dispatch_url text;
  dispatch_secret text;
begin
  if not exists (select 1 from inserted where push_status = 'pending') then return null; end if;
  -- One wake per transaction is enough: a bulk fixture import enqueues many rows.
  if current_setting('top100.push_dispatcher_woken', true) = 'on' then return null; end if;
  perform set_config('top100.push_dispatcher_woken', 'on', true);

  begin
    select decrypted_secret into dispatch_url from vault.decrypted_secrets
    where name = 'top100_push_dispatch_url' order by created_at desc limit 1;
    select decrypted_secret into dispatch_secret from vault.decrypted_secrets
    where name = 'top100_push_dispatch_secret' order by created_at desc limit 1;
  exception when others then
    return null;
  end;

  if coalesce(dispatch_url, '') = '' or coalesce(dispatch_secret, '') = '' then return null; end if;

  begin
    perform net.http_post(
      url := dispatch_url,
      headers := jsonb_build_object('content-type', 'application/json', 'x-top100-push-secret', dispatch_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

revoke all on function public.wake_push_dispatcher() from public, anon, authenticated;
