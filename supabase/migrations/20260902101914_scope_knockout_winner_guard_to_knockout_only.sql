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