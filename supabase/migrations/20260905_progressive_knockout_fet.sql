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

-- A double-forfeit ruling replaces any previously recorded sporting result.
-- Clear all normal-time, FET, penalty and source-stat evidence on the selected
-- fixture and every sibling leg so stale FET data can never survive the ruling.
create or replace function public.admin_record_double_forfeit(
  target_match_id bigint,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.matches%rowtype;
  penalty_text text;
  sibling_ids bigint[];
begin
  if nullif(trim(note), '') is null then raise exception 'A reason is required for a double forfeit'; end if;

  select * into match_row
  from public.matches
  where id = target_match_id
  for update;

  if not found then raise exception 'Match not found'; end if;
  if not public.can_manage_tournament(match_row.tournament_id) then
    raise exception 'Tournament organiser access required';
  end if;
  if match_row.stage not in ('group', 'knockout') then
    raise exception 'Double forfeits are supported only for group-stage and knockout matches';
  end if;
  if match_row.home_entry_id is null or match_row.away_entry_id is null then
    raise exception 'Both entrants are required';
  end if;

  penalty_text := case
    when match_row.stage = 'knockout' then 'Double forfeit — both teams eliminated'
    else 'Double forfeit — 0 points'
  end;

  insert into public.match_result_revisions (
    match_id, changed_by, action,
    previous_status, previous_home_score, previous_away_score,
    new_status, new_home_score, new_away_score, reason
  ) values (
    match_row.id, auth.uid(), 'forfeit',
    match_row.status, match_row.home_score, match_row.away_score,
    'forfeit', 0, 0, trim(note)
  );

  update public.manager_result_submissions
  set status = 'final',
      resolved_by = auth.uid(),
      resolved_home_score = 0,
      resolved_away_score = 0,
      resolution_note = trim(note),
      resolved_at = now(),
      updated_at = now()
  where match_id = target_match_id;

  if match_row.stage = 'knockout' then
    select array_agg(m.id)
      into sibling_ids
    from public.matches m
    where m.tournament_id = match_row.tournament_id
      and m.stage = 'knockout'
      and coalesce(m.bracket, 'Cup') = coalesce(match_row.bracket, 'Cup')
      and m.round = match_row.round
      and m.match_order = match_row.match_order
      and m.id <> target_match_id;

    update public.matches
    set home_score = 0,
        away_score = 0,
        home_normal_time_score = null,
        away_normal_time_score = null,
        home_extra_time_score = null,
        away_extra_time_score = null,
        home_penalty_score = null,
        away_penalty_score = null,
        home_possession = null,
        away_possession = null,
        home_shots_on_target = null,
        away_shots_on_target = null,
        winner_entry_id = null,
        loser_entry_id = null,
        status = 'forfeit',
        decided_by = 'double_forfeit',
        played_at = coalesce(played_at, now())
    where id = any(coalesce(sibling_ids, array[]::bigint[]));

    update public.manager_result_submissions
    set status = 'final',
        resolved_by = auth.uid(),
        resolved_home_score = 0,
        resolved_away_score = 0,
        resolution_note = trim(note),
        resolved_at = now(),
        updated_at = now()
    where match_id = any(coalesce(sibling_ids, array[]::bigint[]));
  end if;

  update public.matches
  set home_score = 0,
      away_score = 0,
      home_normal_time_score = null,
      away_normal_time_score = null,
      home_extra_time_score = null,
      away_extra_time_score = null,
      home_penalty_score = null,
      away_penalty_score = null,
      home_possession = null,
      away_possession = null,
      home_shots_on_target = null,
      away_shots_on_target = null,
      winner_entry_id = null,
      loser_entry_id = null,
      status = 'forfeit',
      decided_by = case when match_row.stage = 'knockout' then 'double_forfeit' else null end,
      played_at = coalesce(played_at, now())
  where id = target_match_id;

  update public.forfeits
  set reason = trim(note),
      penalty = penalty_text,
      affects_prize_draw = true,
      source = 'admin'
  where match_id = target_match_id;

  if match_row.stage = 'knockout' and sibling_ids is not null then
    delete from public.forfeits where match_id = any(sibling_ids);
  end if;
end;
$$;

revoke all on function public.admin_record_double_forfeit(bigint, text) from public, anon;
grant execute on function public.admin_record_double_forfeit(bigint, text) to authenticated;
