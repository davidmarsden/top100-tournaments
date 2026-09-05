-- Progressive knockout result entry and fictional extra time (FET).
-- home_score/away_score remain the official FINAL match score, preserving all
-- existing bracket consumers. For FET matches, the score at 90 minutes is
-- stored separately and FET goals are stored in the existing extra-time fields.
-- Raw possession/SOT figures provide an auditable derivation of those FET goals.

alter table public.matches
  add column if not exists home_normal_time_score integer,
  add column if not exists away_normal_time_score integer,
  add column if not exists home_possession numeric(5,2),
  add column if not exists away_possession numeric(5,2),
  add column if not exists home_shots_on_target integer,
  add column if not exists away_shots_on_target integer;

alter table public.matches
  drop constraint if exists matches_normal_time_scores_nonnegative,
  add constraint matches_normal_time_scores_nonnegative
    check (
      (home_normal_time_score is null or home_normal_time_score >= 0)
      and (away_normal_time_score is null or away_normal_time_score >= 0)
    ),
  drop constraint if exists matches_home_possession_range,
  add constraint matches_home_possession_range
    check (home_possession is null or (home_possession >= 0 and home_possession <= 100)),
  drop constraint if exists matches_away_possession_range,
  add constraint matches_away_possession_range
    check (away_possession is null or (away_possession >= 0 and away_possession <= 100)),
  drop constraint if exists matches_home_shots_on_target_nonnegative,
  add constraint matches_home_shots_on_target_nonnegative
    check (home_shots_on_target is null or home_shots_on_target >= 0),
  drop constraint if exists matches_away_shots_on_target_nonnegative,
  add constraint matches_away_shots_on_target_nonnegative
    check (away_shots_on_target is null or away_shots_on_target >= 0),
  drop constraint if exists matches_fet_scores_nonnegative,
  add constraint matches_fet_scores_nonnegative
    check (
      (home_extra_time_score is null or home_extra_time_score >= 0)
      and (away_extra_time_score is null or away_extra_time_score >= 0)
    );

comment on column public.matches.home_normal_time_score is 'Score at the end of normal time when FET is used; home_score remains the final score.';
comment on column public.matches.away_normal_time_score is 'Score at the end of normal time when FET is used; away_score remains the final score.';
comment on column public.matches.home_possession is 'Possession percentage used to derive fictional extra time (FET).';
comment on column public.matches.away_possession is 'Possession percentage used to derive fictional extra time (FET).';
comment on column public.matches.home_shots_on_target is 'Shots on target used to derive fictional extra time (FET).';
comment on column public.matches.away_shots_on_target is 'Shots on target used to derive fictional extra time (FET).';
comment on column public.matches.home_extra_time_score is 'Additional fictional-extra-time goals, added to home_normal_time_score to produce home_score.';
comment on column public.matches.away_extra_time_score is 'Additional fictional-extra-time goals, added to away_normal_time_score to produce away_score.';

-- Keep delegated assistants compatible with the richer result editor. Structural
-- fields remain protected; these additions are result evidence only.
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
    'home_normal_time_score',
    'away_normal_time_score',
    'home_extra_time_score',
    'away_extra_time_score',
    'home_penalty_score',
    'away_penalty_score',
    'home_possession',
    'away_possession',
    'home_shots_on_target',
    'away_shots_on_target',
    'winner_entry_id',
    'loser_entry_id',
    'decided_by',
    'status',
    'notes',
    'played_at'
  ];
begin
  if public.can_manage_tournament(old.tournament_id) then return new; end if;
  if not public.can_assist_tournament(old.tournament_id) then return new; end if;

  if not (
    (old.stage = 'group' and new.stage = 'group')
    or (old.stage = 'knockout' and new.stage = 'knockout' and public.is_knockout_only_tournament(old.tournament_id))
  ) then
    raise exception 'Assistants cannot alter this knockout or structural match';
  end if;

  if (to_jsonb(new) - allowed_columns) is distinct from (to_jsonb(old) - allowed_columns) then
    raise exception 'Assistants can only change scheduling, result and FET evidence fields';
  end if;

  if new.status is null or new.status not in ('scheduled', 'postponed', 'played', 'forfeit') then
    raise exception 'Assistants cannot set this match status';
  end if;

  if new.home_score is not null and new.home_score < 0 then raise exception 'Home score cannot be negative'; end if;
  if new.away_score is not null and new.away_score < 0 then raise exception 'Away score cannot be negative'; end if;
  if new.home_normal_time_score is not null and new.home_normal_time_score < 0 then raise exception 'Home normal-time score cannot be negative'; end if;
  if new.away_normal_time_score is not null and new.away_normal_time_score < 0 then raise exception 'Away normal-time score cannot be negative'; end if;
  if new.home_extra_time_score is not null and new.home_extra_time_score < 0 then raise exception 'Home FET score cannot be negative'; end if;
  if new.away_extra_time_score is not null and new.away_extra_time_score < 0 then raise exception 'Away FET score cannot be negative'; end if;

  if new.winner_entry_id is not null and new.winner_entry_id not in (old.home_entry_id, old.away_entry_id) then
    raise exception 'Winner must be one of the fixture entrants';
  end if;
  if new.loser_entry_id is not null and new.loser_entry_id not in (old.home_entry_id, old.away_entry_id) then
    raise exception 'Loser must be one of the fixture entrants';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_assistant_match_update() from public, anon, authenticated;
grant execute on function public.guard_assistant_match_update() to service_role;
