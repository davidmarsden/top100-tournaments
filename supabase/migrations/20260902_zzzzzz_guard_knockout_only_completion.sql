-- PR #73 completion invariant hardening.
-- Knockout-only tournaments may only move to completed/archived after a real
-- Final has a resolved winner and any manager result submission for that Final
-- has reached a terminal review state.

create or replace function public.guard_knockout_only_tournament_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  final_ready boolean;
  final_under_review boolean;
begin
  if new.status not in ('completed', 'archived')
     or new.status is not distinct from old.status
     or new.tournament_structure <> 'knockout_only' then
    return new;
  end if;

  select exists (
    select 1
    from public.matches m
    where m.tournament_id = new.id
      and m.stage = 'knockout'
      and m.round = 'Final'
      and m.status in ('played', 'forfeit')
      and m.winner_entry_id is not null
  ) into final_ready;

  if not final_ready then
    raise exception 'Knockout-only tournaments cannot be completed before the Final has a resolved winner';
  end if;

  select exists (
    select 1
    from public.manager_result_submissions s
    join public.matches m on m.id = s.match_id
    where m.tournament_id = new.id
      and m.stage = 'knockout'
      and m.round = 'Final'
      and s.status in (
        'pending_confirmation',
        'disputed',
        'pending_admin_check',
        'opponent_confirmed',
        'appealed'
      )
  ) into final_under_review;

  if final_under_review then
    raise exception 'Knockout-only tournaments cannot be completed while the Final result is still under review';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_knockout_only_tournament_completion() from public, anon, authenticated;
grant execute on function public.guard_knockout_only_tournament_completion() to service_role;

drop trigger if exists guard_knockout_only_tournament_completion on public.tournaments;
create trigger guard_knockout_only_tournament_completion
before update on public.tournaments
for each row execute function public.guard_knockout_only_tournament_completion();
