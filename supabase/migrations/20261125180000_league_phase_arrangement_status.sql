-- Public tournament page: one arrangement status per unplayed fixture, for the
-- colour-coded badges on Fixtures & results.
--
--   arranged  the friendly is on Soccer Manager's fixture list (or swapped by agreement)
--   check     on SM's list, but home and away swapped without agreement, or on another date
--   problem   a manager has reported a problem arranging it
--   chased    the visiting club has chased the invite
--   received  the visiting club has received the invite
--   sent      the hosting club has sent the invite
--   null      nothing yet
--
-- Only the summary is public: who recorded what, evidence and history stay private.
-- Like the matches themselves, nothing is shown until the tournament's fixtures are
-- published (tournament_is_public), except to its staff.

create or replace function public.league_phase_arrangement_status(target_tournament_id bigint)
returns table (match_id bigint, arrangement_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id,
         case
           when sm.sm_status in ('arranged', 'swapped') then 'arranged'
           when p.problem then 'problem'
           when sm.sm_status in ('reversed', 'other_date') then 'check'
           when p.chased then 'chased'
           when p.received then 'received'
           when p.sent then 'sent'
         end
  from public.matches m
  join public.tournaments t on t.id = m.tournament_id
   and (public.tournament_is_public(t.id) or public.can_assist_tournament(t.id))
  left join public.league_phase_sm_arrangements(target_tournament_id) sm on sm.match_id = m.id
  left join lateral (
    select bool_or(a.status = 'problem') problem, bool_or(a.status = 'chased') chased,
           bool_or(a.status = 'received') received, bool_or(a.status = 'sent') sent
    from public.manager_match_arrangements a
    where a.match_id = m.id and a.status <> 'cleared'
  ) p on true
  where m.tournament_id = target_tournament_id
    and coalesce(lower(m.status), 'scheduled') not in ('played', 'forfeit', 'voided', 'cancelled');
$$;

revoke all on function public.league_phase_arrangement_status(bigint) from public;
grant execute on function public.league_phase_arrangement_status(bigint) to anon, authenticated;

-- league_phase_sm_arrangements: the same visibility as the fixtures (it checked is_public only).
do $$
declare
  v_ddl text;
  v_anchor constant text := 'where m.tournament_id = target_tournament_id and t.is_public = true;';
  v_patch constant text := 'where m.tournament_id = target_tournament_id and (public.tournament_is_public(t.id) or public.can_assist_tournament(t.id));';
begin
  v_ddl := pg_get_functiondef('public.league_phase_sm_arrangements(bigint)'::regprocedure);
  if position(v_patch in v_ddl) > 0 then return; end if;
  if (length(v_ddl) - length(replace(v_ddl, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'league_phase_sm_arrangements anchor not found exactly once; refusing an unsafe migration';
  end if;
  execute replace(v_ddl, v_anchor, v_patch);
end;
$$;
