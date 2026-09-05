-- Extend the existing double-forfeit workflow to knockout matches.
-- A knockout double forfeit is recorded 0-0 with no winner and no loser:
-- both entrants are eliminated, both managers are added to the forfeits register,
-- and bracket generation treats the vacated place as a BYE for the paired winner.

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

  -- Finalise any open manager submission before changing the match. This means
  -- the match trigger sees the organiser ruling, not an open provisional allegation,
  -- and can safely create both permanent forfeit rows in the same transaction.
  update public.manager_result_submissions
  set status = 'final',
      resolved_by = auth.uid(),
      resolved_home_score = 0,
      resolved_away_score = 0,
      resolution_note = trim(note),
      resolved_at = now(),
      updated_at = now()
  where match_id = target_match_id;

  -- Null winner/loser is intentional. In a knockout tie this means neither team
  -- advances and there is no loser eligible to drop into a consolation bracket.
  update public.matches
  set home_score = 0,
      away_score = 0,
      winner_entry_id = null,
      loser_entry_id = null,
      status = 'forfeit',
      played_at = coalesce(played_at, now())
  where id = target_match_id;

  update public.forfeits
  set reason = trim(note),
      penalty = penalty_text,
      affects_prize_draw = true,
      source = 'admin'
  where match_id = target_match_id;
end;
$$;

revoke all on function public.admin_record_double_forfeit(bigint, text) from public, anon;
grant execute on function public.admin_record_double_forfeit(bigint, text) to authenticated;
