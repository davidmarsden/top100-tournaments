-- A Manager Portal account belongs to a person, not to a game world: one account
-- per manager covers every world they manage in. manager_portal_accounts.game_world_id
-- only records the world the account was claimed through, but several Top 100
-- features read it as "is this a Top 100 manager?", so a Top 100 manager who
-- claimed through Top 100 Regen (Pane Trifunov, Tom Lee) was kept out of Top 100
-- Chat, broadcasts, chat reply notifications and the Top 100 electorate.
--
-- manager_in_world(): the account's claim world, or an active membership in that
-- world (kept by the core archive apply after each Sync). The three functions that
-- tested the claim world now use it; my_manager_world_slugs() lets the portal ask
-- the same question for the signed-in manager.
--
-- Patched in place: every anchor must match exactly once, or nothing changes.

create or replace function public.manager_in_world(p_manager_id bigint, p_world_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_manager_id is not null and p_world_id is not null and (
    exists (
      select 1 from public.manager_portal_accounts account
      where account.manager_id = p_manager_id and account.active and account.game_world_id = p_world_id
    )
    or exists (
      select 1 from public.manager_game_world_memberships membership
      where membership.manager_id = p_manager_id and membership.game_world_id = p_world_id and membership.active
    )
  );
$$;

revoke all on function public.manager_in_world(bigint, bigint) from public, anon, authenticated;
grant execute on function public.manager_in_world(bigint, bigint) to service_role;

-- The worlds the signed-in manager's account covers (claim world plus current memberships).
create or replace function public.my_manager_world_slugs()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(world.slug order by world.id), array[]::text[])
  from public.manager_portal_accounts account
  join public.game_worlds world on public.manager_in_world(account.manager_id, world.id)
  where account.auth_user_id = auth.uid() and account.active;
$$;

revoke all on function public.my_manager_world_slugs() from public, anon;
grant execute on function public.my_manager_world_slugs() to authenticated, service_role;

do $migration$
declare
  patches text[][] := array[
    [
      'enqueue_chat_reply_notification',
      'join public.game_worlds world on world.id = account.game_world_id and world.slug = ''top-100''',
      'join public.game_worlds world on world.slug = ''top-100'' and public.manager_in_world(account.manager_id, world.id)'
    ],
    [
      'open_voting_event',
      'left join public.manager_portal_accounts a on a.manager_id=gm.manager_id and a.game_world_id=top100_world_id and a.active=true',
      'left join public.manager_portal_accounts a on a.manager_id=gm.manager_id and a.active=true and public.manager_in_world(a.manager_id, top100_world_id)'
    ],
    [
      'send_manager_broadcast',
      'and (p_game_world_id is null or account.game_world_id = p_game_world_id)',
      'and (p_game_world_id is null or public.manager_in_world(account.manager_id, p_game_world_id))'
    ]
  ];
  i integer;
  v_oid oid;
  v_ddl text;
begin
  for i in 1 .. array_length(patches, 1) loop
    select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = patches[i][1];
    if v_oid is null then
      raise exception '% was not found', patches[i][1];
    end if;
    v_ddl := pg_get_functiondef(v_oid);
    if (length(v_ddl) - length(replace(v_ddl, patches[i][2], ''))) / length(patches[i][2]) <> 1 then
      raise exception '% anchor was not found exactly once; refusing an unsafe migration', patches[i][1];
    end if;
    execute replace(v_ddl, patches[i][2], patches[i][3]);
  end loop;
end;
$migration$;
