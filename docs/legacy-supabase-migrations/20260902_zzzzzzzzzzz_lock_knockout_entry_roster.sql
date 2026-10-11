-- Once a knockout-only draw exists, the entrant roster and saved seed identities
-- are part of the bracket structure. Prevent later registration promotion,
-- deletion or identity/seed edits from making the roster diverge from matches.

create or replace function public.knockout_only_roster_is_locked(p_tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tournaments t
    where t.id = p_tournament_id
      and t.tournament_structure = 'knockout_only'
      and exists (
        select 1
        from public.matches m
        where m.tournament_id = t.id
          and m.stage = 'knockout'
      )
  );
$$;

revoke all on function public.knockout_only_roster_is_locked(bigint) from public;
grant execute on function public.knockout_only_roster_is_locked(bigint) to authenticated, service_role;

create or replace function public.guard_knockout_only_entry_roster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if public.knockout_only_roster_is_locked(new.tournament_id) then
      raise exception 'Knockout entrant roster is locked after the draw has been generated';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if public.knockout_only_roster_is_locked(old.tournament_id) then
      raise exception 'Knockout entrant roster is locked after the draw has been generated';
    end if;
    return old;
  end if;

  -- Moving a row can affect either the source or destination roster.
  if new.tournament_id is distinct from old.tournament_id then
    if public.knockout_only_roster_is_locked(old.tournament_id)
       or public.knockout_only_roster_is_locked(new.tournament_id) then
      raise exception 'Knockout entrant roster is locked after the draw has been generated';
    end if;
  elsif public.knockout_only_roster_is_locked(old.tournament_id)
        and (
          new.team_id is distinct from old.team_id
          or new.manager_id is distinct from old.manager_id
          or new.seed is distinct from old.seed
        ) then
    raise exception 'Knockout entrant identity and seed are locked after the draw has been generated';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_knockout_only_entry_roster_trigger on public.tournament_entries;
create trigger guard_knockout_only_entry_roster_trigger
before insert or update or delete on public.tournament_entries
for each row execute function public.guard_knockout_only_entry_roster();
