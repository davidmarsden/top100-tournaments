create table public.manager_auth_handoffs (
  code_hash text primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  destination text not null check (destination = 'vote'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  consumed_at timestamptz
);
alter table public.manager_auth_handoffs enable row level security;
revoke all on public.manager_auth_handoffs from anon, authenticated;

create or replace function public.create_manager_auth_handoff()
returns text
language plpgsql
security definer
set search_path='public','extensions'
as $$
declare raw_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.manager_portal_accounts
    where auth_user_id=auth.uid() and active=true
  ) then raise exception 'Active manager account required'; end if;

  raw_code := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.manager_auth_handoffs(code_hash,auth_user_id,destination)
  values(encode(extensions.digest(raw_code,'sha256'),'hex'),auth.uid(),'vote');
  delete from public.manager_auth_handoffs where expires_at < now() - interval '1 day';
  return raw_code;
end $$;

revoke all on function public.create_manager_auth_handoff() from public, anon;
grant execute on function public.create_manager_auth_handoff() to authenticated;
