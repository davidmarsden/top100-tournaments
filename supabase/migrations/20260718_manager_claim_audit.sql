-- Store a human-readable reviewer label alongside the existing auth UUID.
-- This keeps the manager-account history useful without exposing auth.users.
alter table public.manager_portal_claims
  add column if not exists reviewed_by_label text;

create or replace function public.approve_manager_portal_claim(
  target_claim_id bigint,
  target_manager_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_row public.manager_portal_claims%rowtype;
  resolved_manager_id bigint;
  reviewer_label text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select * into claim_row
  from public.manager_portal_claims
  where id = target_claim_id
  for update;

  if not found then raise exception 'Manager claim not found'; end if;
  if claim_row.status <> 'pending' then raise exception 'Manager claim has already been reviewed'; end if;

  resolved_manager_id := coalesce(target_manager_id, claim_row.suggested_manager_id);
  if resolved_manager_id is null then raise exception 'Choose a manager before approving this claim'; end if;

  reviewer_label := coalesce(
    nullif(auth.jwt() ->> 'name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    nullif(auth.jwt() ->> 'email', ''),
    'Administrator'
  );

  insert into public.manager_portal_accounts (auth_user_id, manager_id, email, active, updated_at)
  values (claim_row.auth_user_id, resolved_manager_id, claim_row.email, true, now())
  on conflict (auth_user_id) do update set
    manager_id = excluded.manager_id,
    email = excluded.email,
    active = true,
    updated_at = now();

  update public.manager_portal_claims set
    suggested_manager_id = resolved_manager_id,
    status = 'approved',
    reviewed_by = auth.uid(),
    reviewed_by_label = reviewer_label,
    reviewed_at = now(),
    updated_at = now()
  where id = target_claim_id;

  return resolved_manager_id;
end;
$$;

create or replace function public.reject_manager_portal_claim(
  target_claim_id bigint,
  notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reviewer_label text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  reviewer_label := coalesce(
    nullif(auth.jwt() ->> 'name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    nullif(auth.jwt() ->> 'email', ''),
    'Administrator'
  );

  update public.manager_portal_claims set
    status = 'rejected',
    review_notes = notes,
    reviewed_by = auth.uid(),
    reviewed_by_label = reviewer_label,
    reviewed_at = now(),
    updated_at = now()
  where id = target_claim_id and status = 'pending';

  if not found then raise exception 'Pending manager claim not found'; end if;
end;
$$;

grant execute on function public.approve_manager_portal_claim(bigint, bigint) to authenticated;
grant execute on function public.reject_manager_portal_claim(bigint, text) to authenticated;
