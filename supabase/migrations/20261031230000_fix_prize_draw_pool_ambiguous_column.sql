-- prize_draw_pool: its OUT column manager_id clashed with the unqualified
-- manager_id in the people CTE (42702 ambiguous column). Qualify it.

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
    select e.manager_id, e.id as entry_id, e.team_id, e.prize_draw_eligible
    from public.tournament_entries e
    where e.tournament_id = p_tournament_id and e.manager_id is not null
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
         t.name,
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
  left join public.teams t on t.id = cm.team_id
  order by 9 desc, 2;
end;
$$;

revoke all on function public.prize_draw_pool(bigint) from public;
grant execute on function public.prize_draw_pool(bigint) to anon, authenticated, service_role;
