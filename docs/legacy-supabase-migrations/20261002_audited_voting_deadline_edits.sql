-- Audited admin-only corrections to Community Poll closing deadlines.
create or replace function public.update_voting_event_deadline(
  target_event_id bigint,
  new_closes_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_closes_at timestamptz;
  v_status text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if new_closes_at is null then raise exception 'Poll closing date cannot be blank'; end if;
  if new_closes_at <= now() then raise exception 'Poll closing date must be in the future'; end if;

  select closes_at, status into v_old_closes_at, v_status
  from public.voting_events
  where id = target_event_id
  for update;

  if not found then raise exception 'Voting event not found'; end if;
  if v_status not in ('draft', 'open') then raise exception 'Only draft or open polls can have their closing date changed'; end if;
  if v_status = 'open' and v_old_closes_at is not null and v_old_closes_at <= now() then
    raise exception 'Voting has already closed; its deadline cannot be extended';
  end if;

  update public.voting_events
  set closes_at = new_closes_at,
      updated_at = now()
  where id = target_event_id;

  insert into public.voting_audit_log(event_id, actor_user_id, action, details)
  values (
    target_event_id,
    auth.uid(),
    'event_deadline_updated',
    jsonb_build_object(
      'old_closes_at', v_old_closes_at,
      'new_closes_at', new_closes_at,
      'status', v_status
    )
  );
end;
$$;

revoke all on function public.update_voting_event_deadline(bigint, timestamptz) from public;
grant execute on function public.update_voting_event_deadline(bigint, timestamptz) to authenticated;
