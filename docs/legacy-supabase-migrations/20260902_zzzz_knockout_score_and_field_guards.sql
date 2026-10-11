-- Final hardening follow-up for PR #73.
-- 1. A completed knockout-only one-leg tie must have a decisive score whose
--    winner/loser IDs match that score.
-- 2. Once a knockout-only draw exists, its configured field size is structural
--    and cannot be changed until those matches are removed.

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
  if public.can_manage_tournament(old.tournament_id) then
    return new;
  end if;

  if not public.can_assist_tournament(old.tournament_id) then
    return new;
  end if;

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

  if old.stage = 'knockout'
     and public.is_knockout_only_tournament(old.tournament_id)
     and new.away_entry_id is not null
     and new.status in ('played', 'forfeit') then
    if new.home_score is null or new.away_score is null or new.home_score = new.away_score then
      raise exception 'Knockout-only ties must have a decisive score';
    end if;
    if new.home_score > new.away_score then
      if new.winner_entry_id is distinct from old.home_entry_id
         or new.loser_entry_id is distinct from old.away_entry_id then
        raise exception 'Winner and loser must agree with the knockout score';
      end if;
    else
      if new.winner_entry_id is distinct from old.away_entry_id
         or new.loser_entry_id is distinct from old.home_entry_id then
        raise exception 'Winner and loser must agree with the knockout score';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_assistant_match_update() from public, anon, authenticated;
grant execute on function public.guard_assistant_match_update() to service_role;

create or replace function public.guard_knockout_round_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_changed boolean;
  has_successor boolean;
begin
  -- Knockout-only is single-leg. Any completed real tie must be decisive and
  -- the stored participant IDs must match the scoreline. BYEs have no away
  -- entrant and are intentionally excluded.
  if new.stage = 'knockout'
     and public.is_knockout_only_tournament(new.tournament_id)
     and new.away_entry_id is not null
     and new.status in ('played', 'forfeit') then
    if new.home_score is null or new.away_score is null or new.home_score = new.away_score then
      raise exception 'Knockout-only ties must have a decisive score';
    end if;
    if new.home_score > new.away_score then
      if new.winner_entry_id is distinct from new.home_entry_id
         or new.loser_entry_id is distinct from new.away_entry_id then
        raise exception 'Winner and loser must agree with the knockout score';
      end if;
    else
      if new.winner_entry_id is distinct from new.away_entry_id
         or new.loser_entry_id is distinct from new.home_entry_id then
        raise exception 'Winner and loser must agree with the knockout score';
      end if;
    end if;
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

create or replace function public.guard_knockout_tournament_format_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.tournament_structure = 'knockout_only'
     and new.tournament_structure = 'knockout_only'
     and (
       new.max_entries is distinct from old.max_entries
       or new.knockout_teams is distinct from old.knockout_teams
     )
     and exists (
       select 1
       from public.matches m
       where m.tournament_id = old.id
         and m.stage = 'knockout'
     ) then
    raise exception 'Knockout field size cannot change after the draw has been generated';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_knockout_tournament_format_update() from public, anon, authenticated;
grant execute on function public.guard_knockout_tournament_format_update() to service_role;

drop trigger if exists guard_knockout_tournament_format_update on public.tournaments;
create trigger guard_knockout_tournament_format_update
before update on public.tournaments
for each row execute function public.guard_knockout_tournament_format_update();
