-- compliance_obligation_overview: qualify the game world columns. Its result has its own "id"
-- column, so an unqualified "id" in the body was ambiguous, and the alerts page's required
-- sales list failed with 'column reference "id" is ambiguous'.

create or replace function public.compliance_obligation_overview(p_world_slug text default 'top-100')
returns table (
  id bigint,
  club_name text,
  source_club_id text,
  player_name text,
  source_player_id text,
  requirement text,
  no_rebid boolean,
  reason text,
  status text,
  resolved_transfer jsonb,
  sellable_from timestamptz,
  player_banned boolean,
  checked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can view required sales.'; end if;
  return query
  select obligation.id, obligation.club_name, obligation.source_club_id, obligation.player_name, obligation.source_player_id,
    obligation.requirement, obligation.no_rebid, obligation.reason, obligation.status, obligation.resolved_transfer,
    case when latest.fields->>'tbraw' ~ '^[0-9]+$' then to_timestamp((latest.fields->>'tbraw')::bigint) end,
    coalesce((latest.fields->>'tban')::boolean, false),
    latest.captured_at
  from public.compliance_obligations obligation
  cross join (select game_world.id, game_world.external_world_id from public.game_worlds game_world where game_world.slug = p_world_slug) world
  left join lateral (
    select snapshot.source_data->'sourceFields' as fields, snapshot.captured_at
    from public.soccer_manager_player_snapshots snapshot
    where snapshot.game_world_id = world.id and snapshot.source_data->>'playerDataId' = obligation.source_player_id
    order by snapshot.captured_at desc limit 1
  ) latest on true
  where obligation.source_world_id = world.external_world_id
  order by obligation.status = 'open' desc, 11 nulls last, obligation.club_name;
end;
$$;

revoke all on function public.compliance_obligation_overview(text) from public, anon;
grant execute on function public.compliance_obligation_overview(text) to authenticated;
