-- Follow-up to PR #73 Codex review.
-- Keep knockout-only field sizes internally consistent and let assigned
-- assistants perform ordinary matchday updates on knockout-only fixtures
-- without granting draw/structural control.

alter table public.tournaments
  drop constraint if exists tournaments_knockout_only_field_consistency;

alter table public.tournaments
  add constraint tournaments_knockout_only_field_consistency
  check (
    tournament_structure <> 'knockout_only'
    or (max_entries is null and knockout_teams is null)
    or (
      max_entries is not null
      and knockout_teams is not null
      and max_entries = knockout_teams
    )
  );

create or replace function public.is_knockout_only_tournament(target_tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tournaments t
    where t.id = target_tournament_id
      and t.tournament_structure = 'knockout_only'
  );
$$;

revoke all on function public.is_knockout_only_tournament(bigint) from public, anon;
grant execute on function public.is_knockout_only_tournament(bigint) to authenticated, service_role;

drop policy if exists "Tournament staff update existing group matches" on public.matches;
drop policy if exists "Tournament staff update existing matchday matches" on public.matches;
create policy "Tournament staff update existing matchday matches"
  on public.matches for update to authenticated
  using (
    (select public.can_manage_tournament(tournament_id))
    or (
      (select public.can_assist_tournament(tournament_id))
      and (
        stage = 'group'
        or (
          stage = 'knockout'
          and (select public.is_knockout_only_tournament(tournament_id))
        )
      )
    )
  )
  with check (
    (select public.can_manage_tournament(tournament_id))
    or (
      (select public.can_assist_tournament(tournament_id))
      and (
        stage = 'group'
        or (
          stage = 'knockout'
          and (select public.is_knockout_only_tournament(tournament_id))
        )
      )
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

  if not public.can_assist_tournament(old.tournament_id) then
    raise exception 'Tournament staff access required';
  end if;

  -- Assistants may edit ordinary group matches, plus knockout matches only
  -- where the tournament itself is explicitly knockout-only.
  if not (
    old.stage = 'group'
    or (
      old.stage = 'knockout'
      and public.is_knockout_only_tournament(old.tournament_id)
    )
  ) then
    raise exception 'Assistants cannot alter this knockout or structural match';
  end if;

  if new.stage is distinct from old.stage
     or new.tournament_id is distinct from old.tournament_id
     or new.group_id is distinct from old.group_id
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
