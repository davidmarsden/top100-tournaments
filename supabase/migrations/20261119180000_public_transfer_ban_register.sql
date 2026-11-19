-- The public register of transfer bans, as listed on the blog's Transfer Bans page
-- (smtop100.blog/transfer-bans/), which is rebuilt from it every day.
--
-- public_transfer_ban_register(world, since): every ban in force or ended since `since`, newest
-- first: club, manager, dates, offence level, whether it was shortened after the rules check, and
-- its required sales with whether each has been made. A sale belongs to the ban recorded against
-- the same breach, else to the club's latest ban that started by the time the sale was required.
-- Readable without signing in: the Transfer Bans page has always published the same details.
-- The administrators' reason text and notes stay private.

-- The Sync tables come from Manager Lab's migrations, so SQL function bodies are not checked here.
set check_function_bodies = false;

create or replace function public.public_transfer_ban_register(p_world_slug text default 'top-100', p_since date default date '2026-09-01')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with world as (
    select id, external_world_id from public.game_worlds where slug = coalesce(nullif(trim(p_world_slug), ''), 'top-100')
  ),
  bans as (
    select ban.*, history.offence_level, history.manager_name as history_manager,
      coalesce(crosswalk.source_club_name, ban.club_name) as display_club,
      coalesce(manager.display_name, manager.name, assignment.source_manager_name) as current_manager
    from public.club_transfer_bans ban
    join world on world.external_world_id = ban.source_world_id
    left join public.transfer_ban_history history on history.ban_id = ban.id
    left join public.soccer_manager_club_crosswalk crosswalk
      on crosswalk.source_world_id = ban.source_world_id and crosswalk.source_club_id = ban.source_club_id
    left join public.soccer_manager_world_manager_assignments assignment
      on assignment.game_world_id = world.id and assignment.team_id = crosswalk.team_id
    left join public.managers manager on manager.id = assignment.manager_id
    where ban.ends_on >= coalesce(p_since, date '2026-09-01')
  ),
  sales as (
    select obligation.*,
      (select ban.id from bans ban
        where ban.source_club_id = obligation.source_club_id
          and ((obligation.breach_id is not null and ban.breach_id = obligation.breach_id)
            or ban.starts_on <= obligation.created_at::date + 2)
        order by (obligation.breach_id is not null and ban.breach_id = obligation.breach_id) desc, ban.starts_on desc
        limit 1) as ban_id
    from public.compliance_obligations obligation
    join world on world.external_world_id = obligation.source_world_id
  ),
  grouped as (
    -- An either-or ruling (sell one of several players) is one sale, made once any of them is sold.
    select ban_id,
      jsonb_build_object(
        'players', jsonb_agg(player_name order by player_name),
        'made', bool_or(status = 'met')
      ) as sale,
      min(created_at) as created_at
    from sales
    where ban_id is not null
    group by ban_id, coalesce(choice_group::text, id::text)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'club', ban.display_club,
      'manager', coalesce(ban.history_manager, ban.current_manager),
      'startsOn', ban.starts_on,
      'endsOn', ban.ends_on,
      'level', ban.offence_level,
      'shortened', ban.reduced_at is not null,
      'current', ban.ends_on >= current_date,
      'sales', coalesce((select jsonb_agg(grouped.sale order by grouped.created_at) from grouped where grouped.ban_id = ban.id), '[]'::jsonb)
    ) order by ban.ends_on >= current_date desc, ban.ends_on desc, ban.starts_on desc), '[]'::jsonb)
  from bans ban;
$$;

revoke all on function public.public_transfer_ban_register(text, date) from public;
grant execute on function public.public_transfer_ban_register(text, date) to anon, authenticated;
