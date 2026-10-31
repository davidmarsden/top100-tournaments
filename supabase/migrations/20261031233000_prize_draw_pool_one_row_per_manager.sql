-- prize_draw_pool: a manager running more than one entrant appeared once per
-- entry, so the draw's candidate list held duplicate keys and run_prize_draw
-- rejected it. Aggregate entries per manager.

create or replace function public.prize_draw_pool(p_tournament_id bigint)
returns table (
  manager_id bigint, manager_name text, team_name text, entry_id bigint,
  is_current_manager boolean, forfeit_count int, draw_forfeit_count int,
  entry_flag boolean, eligible boolean, reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.tournament_is_public(p_tournament_id) or public.can_assist_tournament(p_tournament_id)) then
    raise exception 'Tournament not found';
  end if;

  return query
  with current_managers as (
    -- One row per manager even when they run several entrants: any entry
    -- the organiser excluded excludes the manager.
    select e.manager_id,
           min(e.id) as entry_id,
           string_agg(tm.name, ' / ' order by tm.name) as team_names,
           case when bool_or(e.prize_draw_eligible = false) then false
                when bool_or(e.prize_draw_eligible) then true
           end as prize_draw_eligible
    from public.tournament_entries e
    left join public.teams tm on tm.id = e.team_id
    where e.tournament_id = p_tournament_id and e.manager_id is not null
    group by e.manager_id
  ), forfeit_rows as (
    select f.manager_id, count(*)::int as total,
           count(*) filter (where f.affects_prize_draw is distinct from false)::int as draw_total
    from public.forfeits f join public.matches m on m.id = f.match_id
    where m.tournament_id = p_tournament_id and f.manager_id is not null
    group by f.manager_id
  ), people as (
    select cm0.manager_id from current_managers cm0 union select fr0.manager_id from forfeit_rows fr0
  )
  select p.manager_id,
         coalesce(mg.display_name, mg.name, 'Unknown manager'),
         cm.team_names,
         cm.entry_id,
         cm.entry_id is not null,
         coalesce(fr.total, 0),
         coalesce(fr.draw_total, 0),
         cm.prize_draw_eligible,
         (cm.entry_id is not null and coalesce(fr.draw_total, 0) = 0 and cm.prize_draw_eligible is distinct from false),
         case
           when coalesce(fr.draw_total, 0) > 0 then format('%s forfeit%s', fr.draw_total, case when fr.draw_total = 1 then '' else 's' end)
           when cm.prize_draw_eligible = false then 'Excluded by organiser'
           when cm.entry_id is null then 'No longer managing an entrant'
           else null
         end
  from people p
  left join current_managers cm on cm.manager_id = p.manager_id
  left join forfeit_rows fr on fr.manager_id = p.manager_id
  left join public.managers mg on mg.id = p.manager_id
  order by 9 desc, 2;
end;
$$;

revoke all on function public.prize_draw_pool(bigint) from public;
grant execute on function public.prize_draw_pool(bigint) to anon, authenticated, service_role;
