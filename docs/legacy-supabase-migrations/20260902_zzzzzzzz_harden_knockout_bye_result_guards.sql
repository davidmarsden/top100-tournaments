-- Follow-up hardening for PR #73.
-- PostgreSQL `NOT IN (..., NULL)` yields NULL rather than TRUE, so an assistant
-- could otherwise assign an unrelated winner to a knockout-only BYE. Use
-- NULL-safe participant checks and explicitly preserve the sole-entrant BYE
-- winner invariant.

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

  -- NULL-safe entrant membership checks. Do not use NOT IN here because a BYE
  -- has a NULL away_entry_id, which would make the predicate evaluate to NULL.
  if new.winner_entry_id is not null
     and new.winner_entry_id is distinct from old.home_entry_id
     and (old.away_entry_id is null or new.winner_entry_id is distinct from old.away_entry_id) then
    raise exception 'Winner must be one of the fixture entrants';
  end if;
  if new.loser_entry_id is not null
     and new.loser_entry_id is distinct from old.home_entry_id
     and (old.away_entry_id is null or new.loser_entry_id is distinct from old.away_entry_id) then
    raise exception 'Loser must be one of the fixture entrants';
  end if;

  if old.stage = 'knockout'
     and public.is_knockout_only_tournament(old.tournament_id)
     and old.away_entry_id is null then
    if new.winner_entry_id is distinct from old.home_entry_id then
      raise exception 'A knockout BYE winner must remain its sole entrant';
    end if;
    if new.loser_entry_id is not null then
      raise exception 'A knockout BYE cannot have a loser';
    end if;
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
