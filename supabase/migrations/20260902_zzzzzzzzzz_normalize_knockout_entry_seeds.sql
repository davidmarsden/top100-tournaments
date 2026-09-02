create or replace function public.normalize_knockout_entry_seeds(target_tournament_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  if not public.can_manage_tournament(target_tournament_id) then
    raise exception 'You do not have permission to manage this tournament';
  end if;

  if not exists (
    select 1
    from public.tournaments
    where id = target_tournament_id
      and tournament_structure = 'knockout_only'
  ) then
    raise exception 'Seed normalization is only available for knockout-only tournaments';
  end if;

  if exists (
    select 1
    from public.matches
    where tournament_id = target_tournament_id
      and stage = 'knockout'
  ) then
    raise exception 'Entrant seeds are locked after the knockout draw has been generated';
  end if;

  with ranked as (
    select
      id,
      row_number() over (
        order by seed asc nulls last, rating desc nulls last, id asc
      )::integer as normalized_seed
    from public.tournament_entries
    where tournament_id = target_tournament_id
  ), updated as (
    update public.tournament_entries te
    set seed = ranked.normalized_seed
    from ranked
    where te.id = ranked.id
      and te.seed is distinct from ranked.normalized_seed
    returning te.id
  )
  select count(*)::integer into updated_count from updated;

  return updated_count;
end;
$$;

revoke all on function public.normalize_knockout_entry_seeds(bigint) from public;
revoke all on function public.normalize_knockout_entry_seeds(bigint) from anon;
grant execute on function public.normalize_knockout_entry_seeds(bigint) to authenticated;
