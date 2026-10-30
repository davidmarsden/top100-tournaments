-- Move a manager's portal account to the email (sign-in) of a new claim, for a manager who can no
-- longer use the address they linked with. The account keeps its id, so its notifications,
-- reminders, push subscriptions, preferences and history stay with it; only the sign-in changes.
-- The old address no longer opens the account. The claim (pending, or rejected because the
-- manager was already linked) is marked approved with a note of the move.
set check_function_bodies = false;

create or replace function public.move_manager_portal_account(target_claim_id bigint, target_manager_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.manager_portal_claims%rowtype;
  v_account public.manager_portal_accounts%rowtype;
  v_reviewer text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into v_claim from public.manager_portal_claims where id = target_claim_id for update;
  if not found then raise exception 'Manager claim not found'; end if;
  if v_claim.status not in ('pending', 'rejected') then raise exception 'Only a pending or rejected claim can take over an account'; end if;
  if v_claim.auth_user_id is null then raise exception 'This claim has no sign-in to move the account to'; end if;
  if exists (select 1 from public.manager_portal_accounts where auth_user_id = v_claim.auth_user_id
                                                             or lower(email) = lower(v_claim.email)) then
    raise exception '% is already linked to a manager account', v_claim.email;
  end if;

  select * into v_account from public.manager_portal_accounts where manager_id = target_manager_id for update;
  if not found then raise exception 'This manager has no account to move; approve the claim instead'; end if;

  update public.manager_portal_accounts
  set auth_user_id = v_claim.auth_user_id, email = v_claim.email, active = true, updated_at = now()
  where id = v_account.id;

  v_reviewer := coalesce(nullif(auth.jwt() ->> 'name', ''), nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
                         nullif(auth.jwt() ->> 'email', ''), 'Administrator');
  update public.manager_portal_claims
  set status = 'approved',
      suggested_manager_id = target_manager_id,
      review_notes = 'Account moved to this email from ' || v_account.email || '.',
      reviewed_by = auth.uid(), reviewed_by_label = v_reviewer, reviewed_at = now(), updated_at = now()
  where id = v_claim.id;

  return v_account.id;
end;
$$;

revoke all on function public.move_manager_portal_account(bigint, bigint) from public, anon;
grant execute on function public.move_manager_portal_account(bigint, bigint) to authenticated;
