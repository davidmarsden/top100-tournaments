create or replace function public.send_manager_broadcast(
  p_title text,
  p_body text,
  p_url text default null,
  p_game_world_id bigint default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_broadcast_id bigint;
  v_account bigint;
  v_url text := coalesce(nullif(trim(p_url), ''), '/');
  v_count integer := 0;
begin
  if not public.is_admin() then raise exception 'Global administrator required'; end if;
  if length(trim(coalesce(p_title, ''))) not between 3 and 120 then raise exception 'Title must be 3–120 characters'; end if;
  if length(trim(coalesce(p_body, ''))) not between 1 and 500 then raise exception 'Message must be 1–500 characters'; end if;
  if v_url !~ '^(/|https://([a-z0-9-]+\.)*smtop100\.blog(/|$))' then raise exception 'Links must point to a Top 100 page'; end if;

  insert into public.manager_broadcasts (game_world_id, title, body, url, created_by)
  values (p_game_world_id, trim(p_title), trim(p_body), v_url, auth.uid())
  returning id into v_broadcast_id;

  for v_account in
    select account.id from public.manager_portal_accounts account
    where account.active = true
      and (p_game_world_id is null or account.game_world_id = p_game_world_id)
  loop
    perform public.enqueue_manager_notification(v_account, 'broadcasts', trim(p_title), trim(p_body), v_url, 'broadcast:' || v_broadcast_id || ':' || v_account);
    v_count := v_count + 1;
  end loop;

  update public.manager_broadcasts set recipient_count = v_count where id = v_broadcast_id;
  return v_count;
end;
$$;

revoke all on function public.send_manager_broadcast(text, text, text, bigint) from public, anon;
grant execute on function public.send_manager_broadcast(text, text, text, bigint) to authenticated;

-- Top 100 Chat reply events, forwarded by the chat gateway through the
-- chat-push-event Netlify function (service role).
create or replace function public.enqueue_chat_reply_notification(
  p_manager_id bigint,
  p_author text,
  p_excerpt text,
  p_url text,
  p_event_key text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account bigint;
  v_count integer := 0;
  v_url text := coalesce(nullif(trim(p_url), ''), 'https://chat.smtop100.blog/');
begin
  if v_url !~ '^https://chat\.smtop100\.blog(/|$)' then v_url := 'https://chat.smtop100.blog/'; end if;
  for v_account in
    select account.id
    from public.manager_portal_accounts account
    join public.game_worlds world on world.id = account.game_world_id and world.slug = 'top-100'
    where account.manager_id = p_manager_id and account.active = true
  loop
    perform public.enqueue_manager_notification(
      v_account, 'chat_replies',
      coalesce(nullif(trim(p_author), ''), 'A manager') || ' replied in Top 100 Chat',
      left(coalesce(p_excerpt, ''), 200),
      v_url,
      'chat:' || left(p_event_key, 200) || ':' || v_account
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.enqueue_chat_reply_notification(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_chat_reply_notification(bigint, text, text, text, text) to service_role;

create or replace function public.top100_my_account_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select account.id from public.manager_portal_accounts account
  where account.auth_user_id = (select auth.uid()) and account.active = true
  order by account.id desc
  limit 1;
$$;

revoke all on function public.top100_my_account_id() from public, anon, authenticated;
