-- Audited admin-only corrections to Community Poll presentation text.
create or replace function public.update_voting_event_text(
  target_event_id bigint,
  new_title text,
  new_description text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_title text;
  v_old_description text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if nullif(btrim(new_title), '') is null then raise exception 'Poll title cannot be blank'; end if;

  select title, description into v_old_title, v_old_description
  from public.voting_events
  where id = target_event_id
  for update;

  if not found then raise exception 'Voting event not found'; end if;

  update public.voting_events
  set title = btrim(new_title),
      description = nullif(btrim(coalesce(new_description, '')), ''),
      updated_at = now()
  where id = target_event_id;

  insert into public.voting_audit_log(event_id, actor_user_id, action, details)
  values (
    target_event_id,
    auth.uid(),
    'event_text_updated',
    jsonb_build_object(
      'old_title', v_old_title,
      'new_title', btrim(new_title),
      'old_description', v_old_description,
      'new_description', nullif(btrim(coalesce(new_description, '')), '')
    )
  );
end;
$$;

revoke all on function public.update_voting_event_text(bigint, text, text) from public;
grant execute on function public.update_voting_event_text(bigint, text, text) to authenticated;
