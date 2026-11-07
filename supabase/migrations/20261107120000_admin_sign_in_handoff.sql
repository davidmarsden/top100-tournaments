-- Sign-in handoff for the admin team's pages on admin.smtop100.blog.
--
-- Safari (and other browsers that partition storage) cannot read the Manager Portal session from
-- the hidden iframe AdminGate uses, so an official signed in on manager.smtop100.blog arrived at
-- the Control Room signed out. The Manager Portal now mints a one-time 'admin' handoff code and
-- sends it back with the redirect; exchange-manager-handoff turns it into a session there.

alter table public.manager_auth_handoffs drop constraint manager_auth_handoffs_destination_check;
alter table public.manager_auth_handoffs
  add constraint manager_auth_handoffs_destination_check check (destination in ('vote', 'manager', 'admin'));

create or replace function public.create_manager_auth_handoff(target_destination text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  raw_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_destination not in ('vote', 'manager', 'admin') then raise exception 'Unknown handoff destination'; end if;
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
