-- Follow-up hardening for assistant match writes.
--
-- The match guard must police delegated assistants without blocking trusted
-- SECURITY DEFINER result RPCs executed on behalf of ordinary managers (or
-- service-role maintenance). RLS already prevents those ordinary managers from
-- updating matches directly. For assistants, use an explicit allowlist rather
-- than trying to enumerate every structural/provenance column that must remain
-- immutable.

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

  -- This trigger is an assistant-specific guard, not a second authorization
  -- layer for every match update. Ordinary managers cannot UPDATE matches via
  -- the Data API because the RLS policy rejects them, but authorised
  -- SECURITY DEFINER result RPCs still execute with that manager's auth.uid().
  -- Likewise, service-role maintenance may have no auth.uid(). Let those
  -- already-authorised paths proceed instead of breaking them here.
  if not public.can_assist_tournament(old.tournament_id) then
    return new;
  end if;

  -- At this point the caller is a delegated assistant (organisers returned
  -- above). Assistants operate group-stage matchday data only.
  if old.stage <> 'group' or new.stage <> 'group' then
    raise exception 'Assistants cannot alter knockout or structural matches';
  end if;

  -- Compare everything except the explicitly permitted operational fields.
  -- Any current or future match column is therefore protected by default.
  if (to_jsonb(new) - allowed_columns) is distinct from (to_jsonb(old) - allowed_columns) then
    raise exception 'Assistants can only change group-stage scheduling and result fields';
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
