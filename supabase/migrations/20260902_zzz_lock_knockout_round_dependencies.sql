-- Follow-up to PR #73 Codex review.
-- A generated successor round copies its participants from the previous round's
-- winners. Once that successor exists, result edits in the predecessor must be
-- locked or the bracket can retain stale participants. Knockout-only one-leg
-- ties must also have a resolved winner before they can be completed.

create or replace function public.knockout_round_rank(round_name text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case round_name
    when 'R64' then 1
    when 'R32' then 2
    when 'R16' then 3
    when 'QF' then 4
    when 'SF' then 5
    when 'Final' then 6
    else null
  end;
$$;

revoke all on function public.knockout_round_rank(text) from public, anon, authenticated;
grant execute on function public.knockout_round_rank(text) to service_role;

create or replace function public.guard_knockout_round_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_changed boolean;
  has_successor boolean;
  knockout_only boolean;
begin
  knockout_only := new.stage = 'knockout'
    and public.is_knockout_only_tournament(new.tournament_id);

  -- Knockout-only tournaments use one-leg ties, so every completed non-bye tie
  -- must have a resolved winner. Do not apply this to the existing group +
  -- knockout format, where an individual leg may legitimately finish level.
  if knockout_only
     and new.status in ('played', 'forfeit')
     and new.away_entry_id is not null
     and new.winner_entry_id is null then
    raise exception 'Knockout-only matches cannot be completed without a resolved winner';
  end if;

  if tg_op <> 'UPDATE'
     or old.stage <> 'knockout'
     or not public.is_knockout_only_tournament(old.tournament_id) then
    return new;
  end if;

  result_changed :=
    new.home_score is distinct from old.home_score
    or new.away_score is distinct from old.away_score
    or new.winner_entry_id is distinct from old.winner_entry_id
    or new.loser_entry_id is distinct from old.loser_entry_id
    or new.status is distinct from old.status
    or new.played_at is distinct from old.played_at;

  if not result_changed then
    return new;
  end if;

  select exists (
    select 1
    from public.matches successor
    where successor.tournament_id = old.tournament_id
      and successor.stage = 'knockout'
      and coalesce(successor.bracket, 'Cup') = coalesce(old.bracket, 'Cup')
      and public.knockout_round_rank(successor.round) > public.knockout_round_rank(old.round)
  ) into has_successor;

  if has_successor then
    raise exception 'This knockout result is locked because a later round has already been generated';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_knockout_round_dependency() from public, anon, authenticated;
grant execute on function public.guard_knockout_round_dependency() to service_role;

drop trigger if exists guard_knockout_round_dependency on public.matches;
create trigger guard_knockout_round_dependency
before insert or update on public.matches
for each row execute function public.guard_knockout_round_dependency();
