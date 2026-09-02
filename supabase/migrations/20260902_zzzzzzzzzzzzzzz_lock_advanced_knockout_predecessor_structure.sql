create or replace function public.guard_advanced_knockout_predecessor_structure()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_knockout_only_tournament(old.tournament_id) then
    return new;
  end if;

  if old.stage is distinct from 'knockout'
     or coalesce(old.bracket, 'Cup') is distinct from 'Cup'
     or public.knockout_round_rank(old.round) <= 0 then
    return new;
  end if;

  if not (
    new.tournament_id is distinct from old.tournament_id
    or new.stage is distinct from old.stage
    or new.round is distinct from old.round
    or new.leg is distinct from old.leg
    or coalesce(new.bracket, 'Cup') is distinct from coalesce(old.bracket, 'Cup')
    or new.match_order is distinct from old.match_order
    or new.home_entry_id is distinct from old.home_entry_id
    or new.away_entry_id is distinct from old.away_entry_id
    or new.home_seed is distinct from old.home_seed
    or new.away_seed is distinct from old.away_seed
    or new.home_placeholder is distinct from old.home_placeholder
    or new.away_placeholder is distinct from old.away_placeholder
  ) then
    return new;
  end if;

  if exists (
    select 1
    from public.matches later
    where later.tournament_id = old.tournament_id
      and later.stage = 'knockout'
      and coalesce(later.bracket, 'Cup') = coalesce(old.bracket, 'Cup')
      and public.knockout_round_rank(later.round) > public.knockout_round_rank(old.round)
  ) then
    raise exception 'Knockout predecessor structure cannot change after a later round has been generated';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_advanced_knockout_predecessor_structure() from public, anon, authenticated;
grant execute on function public.guard_advanced_knockout_predecessor_structure() to service_role;

drop trigger if exists guard_advanced_knockout_predecessor_structure on public.matches;
create trigger guard_advanced_knockout_predecessor_structure
before update on public.matches
for each row execute function public.guard_advanced_knockout_predecessor_structure();
