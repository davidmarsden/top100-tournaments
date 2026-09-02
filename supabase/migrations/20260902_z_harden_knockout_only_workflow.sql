-- Follow-up to PR #73 Codex review.
-- Runs after the knockout-only structure migration on fresh installs.
-- Keeps knockout-only field sizes consistent and lets assigned assistants
-- perform only explicitly allowed matchday updates on knockout-only fixtures,
-- while preserving trusted SECURITY DEFINER result RPCs and service-role work.

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
declare
  allowed_columns text[] := array[
    'scheduled_at',
    'fixture_date',
    'home_score',
    'away_score',
    'winner_entry_id',
    'loser_entry_id',
    'status',
    'notes',
    'played_at'
  ];
begin
  -- Platform admins and tournament organisers retain full match control.
  if public.can_manage_tournament(old.tournament_id) then
    return new;
  end if;

  -- This trigger only constrains delegated assistants. Ordinary managers may
  -- reach it through already-authorized SECURITY DEFINER result RPCs, and
  -- service-role maintenance may have no auth.uid(); preserve those paths.
  if not public.can_assist_tournament(old.tournament_id) then
    return new;
  end if;

  -- Assistants may edit group-stage matchday data, plus knockout matchday data
  -- only when the tournament itself is explicitly knockout-only.
  if not (
    (old.stage = 'group' and new.stage = 'group')
    or (
      old.stage = 'knockout'
      and new.stage = 'knockout'
      and public.is_knockout_only_tournament(old.tournament_id)
    )
  ) then
    raise exception 'Assistants cannot alter this knockout or structural match';
  end if;

  -- Protect every current and future column by default; assistants may change
  -- only the operational fields above.
  if (to_jsonb(new) - allowed_columns) is distinct from (to_jsonb(old) - allowed_columns) then
    raise exception 'Assistants can only change scheduling and result fields';
  end if;

  if new.status is null or new.status not in ('scheduled', 'postponed', 'played', 'forfeit') then
    raise exception 'Assistants cannot set this match status';
  end if;

  if new.home_score is not null and new.home_score < 0 then
    raise exception 'Home score cannot be negative';
  end if;
  if new.away_score is not null and new.away_score < 0 then
    raise exception 'Away score cannot be negative';
  end if;

  if new.winner_entry_id is not null
     and new.winner_entry_id not in (old.home_entry_id, old.away_entry_id) then
    raise exception 'Winner must be one of the fixture entrants';
  end if;
  if new.loser_entry_id is not null
     and new.loser_entry_id not in (old.home_entry_id, old.away_entry_id) then
    raise exception 'Loser must be one of the fixture entrants';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_assistant_match_update() from public, anon, authenticated;
grant execute on function public.guard_assistant_match_update() to service_role;
