-- Single sign-on for My Matches via one-time handoff codes.
--
-- A signed-in Top 100 user on admin.smtop100.blog or tournaments.smtop100.blog can mint a short-lived,
-- single-use code for manager.smtop100.blog, which exchange-manager-handoff turns into a NEW,
-- independent session there. Unlike copying the session tokens between sites, the two sessions
-- never share a refresh token, so neither site can invalidate the other when it renews.
--
-- The existing zero-argument create_manager_auth_handoff() (Community Polls) is unchanged.

alter table public.manager_auth_handoffs drop constraint manager_auth_handoffs_destination_check;
alter table public.manager_auth_handoffs
  add constraint manager_auth_handoffs_destination_check check (destination in ('vote', 'manager'));

create function public.create_manager_auth_handoff(target_destination text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  raw_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_destination not in ('vote', 'manager') then raise exception 'Unknown handoff destination'; end if;
  if not exists (select 1 from public.manager_portal_accounts where auth_user_id = auth.uid() and active = true) then
    raise exception 'Active manager account required';
  end if;
  raw_code := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.manager_auth_handoffs (code_hash, auth_user_id, destination)
  values (encode(extensions.digest(raw_code, 'sha256'), 'hex'), auth.uid(), target_destination);
  delete from public.manager_auth_handoffs where expires_at < now() - interval '1 day';
  return raw_code;
end
$function$;

revoke all on function public.create_manager_auth_handoff(text) from public, anon;
grant execute on function public.create_manager_auth_handoff(text) to authenticated, service_role;
