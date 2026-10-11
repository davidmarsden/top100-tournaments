-- Follow-up hardening for PR #73.
-- Once knockout matches exist, the tournament structure itself is structural
-- and cannot be switched in either direction until those matches are removed.

create or replace function public.guard_knockout_tournament_format_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
       select 1
       from public.matches m
       where m.tournament_id = old.id
         and m.stage = 'knockout'
     ) then
    if new.tournament_structure is distinct from old.tournament_structure then
      raise exception 'Tournament structure cannot change after the knockout draw has been generated';
    end if;

    if old.tournament_structure = 'knockout_only'
       and (
         new.max_entries is distinct from old.max_entries
         or new.knockout_teams is distinct from old.knockout_teams
       ) then
      raise exception 'Knockout field size cannot change after the draw has been generated';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_knockout_tournament_format_update() from public, anon, authenticated;
grant execute on function public.guard_knockout_tournament_format_update() to service_role;
