-- Follow-up to #58 Codex review.
-- Assistants can help with existing group-stage fixtures/results, but cannot
-- create/delete matches or alter structural match fields. They also receive
-- complete read-only access to datasets used by Reports & Exports.

-- Inserts/deletes remain organiser-only. Assistants may only update existing
-- group-stage matches, with a trigger below protecting structural columns.
drop policy if exists "Tournament staff insert matches" on public.matches;
create policy "Tournament managers insert matches"
  on public.matches for insert to authenticated
  with check ((select public.can_manage_tournament(tournament_id)));

drop policy if exists "Tournament staff delete matches" on public.matches;
create policy "Tournament managers delete matches"
  on public.matches for delete to authenticated
  using ((select public.can_manage_tournament(tournament_id)));

drop policy if exists "Tournament staff update matches" on public.matches;
create policy "Tournament staff update existing group matches"
  on public.matches for update to authenticated
  using (
    (select public.can_manage_tournament(tournament_id))
    or (
      stage = 'group'
      and (select public.can_assist_tournament(tournament_id))
    )
  )
  with check (
    (select public.can_manage_tournament(tournament_id))
    or (
      stage = 'group'
      and (select public.can_assist_tournament(tournament_id))
    )
  );

create or replace function public.guard_assistant_match_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Platform admins and organisers retain full tournament match control.
  if public.can_manage_tournament(old.tournament_id) then
    return new;
  end if;

  -- Anyone else reaching this trigger must be an assigned assistant and may
  -- only edit ordinary result/scheduling fields on an existing group match.
  if not public.can_assist_tournament(old.tournament_id) then
    raise exception 'Tournament staff access required';
  end if;

  if old.stage <> 'group' or new.stage <> 'group' then
    raise exception 'Assistants cannot alter knockout or structural matches';
  end if;

  if new.tournament_id is distinct from old.tournament_id
     or new.group_id is distinct from old.group_id
     or new.stage is distinct from old.stage
     or new.round is distinct from old.round
     or new.leg is distinct from old.leg
     or new.match_order is distinct from old.match_order
     or new.home_entry_id is distinct from old.home_entry_id
     or new.away_entry_id is distinct from old.away_entry_id
     or new.bracket is distinct from old.bracket
     or new.stage_id is distinct from old.stage_id
     or new.round_id is distinct from old.round_id
     or new.home_seed is distinct from old.home_seed
     or new.away_seed is distinct from old.away_seed
     or new.home_placeholder is distinct from old.home_placeholder
     or new.away_placeholder is distinct from old.away_placeholder
     or new.published is distinct from old.published then
    raise exception 'Assistants cannot change match structure or publication state';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_assistant_match_update() from public, anon, authenticated;
grant execute on function public.guard_assistant_match_update() to service_role;

drop trigger if exists guard_assistant_match_update on public.matches;
create trigger guard_assistant_match_update
before update on public.matches
for each row execute function public.guard_assistant_match_update();

-- Reports & Exports reads these datasets. Assistants get read-only access for
-- their assigned private tournaments; mutation remains organiser-only.
drop policy if exists "Authenticated read public round dates and assigned organisers" on public.tournament_round_dates;
create policy "Authenticated read public round dates and assigned staff"
  on public.tournament_round_dates for select to authenticated
  using (
    (select public.tournament_is_public(tournament_id))
    or (select public.can_assist_tournament(tournament_id))
  );

drop policy if exists "Authenticated read public honours and admins read all" on public.honours;
create policy "Authenticated read public honours and assigned staff"
  on public.honours for select to authenticated
  using (
    public.tournament_is_public(tournament_id)
    or (select public.can_assist_tournament(tournament_id))
  );

drop policy if exists "Authenticated read public comments and admins read all" on public.match_comments;
create policy "Authenticated read public comments and assigned staff"
  on public.match_comments for select to authenticated
  using (
    ((status = 'visible') and public.tournament_is_public(tournament_id))
    or (select public.can_assist_tournament(tournament_id))
  );
