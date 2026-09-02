-- Prevent organisers/direct API callers from deleting a knockout-only predecessor
-- match once a later Cup round has been generated from its winner.

create or replace function public.guard_knockout_predecessor_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.stage = 'knockout'
     and public.is_knockout_only_tournament(old.tournament_id)
     and exists (
       select 1
       from public.matches later
       where later.tournament_id = old.tournament_id
         and later.stage = 'knockout'
         and coalesce(later.bracket, 'Cup') = coalesce(old.bracket, 'Cup')
         and public.knockout_round_rank(later.round) > public.knockout_round_rank(old.round)
     ) then
    raise exception 'Cannot delete an earlier knockout match after a later round has been generated';
  end if;

  return old;
end;
$$;

revoke all on function public.guard_knockout_predecessor_delete() from public, anon, authenticated;
grant execute on function public.guard_knockout_predecessor_delete() to service_role;

drop trigger if exists guard_knockout_predecessor_delete_trigger on public.matches;
create trigger guard_knockout_predecessor_delete_trigger
before delete on public.matches
for each row execute function public.guard_knockout_predecessor_delete();
