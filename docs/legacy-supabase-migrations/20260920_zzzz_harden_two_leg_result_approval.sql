-- Harden the administrator approval path used by ResultSubmissionsPage
-- so two-leg knockout-only ties resolve consistently with manager submissions.

create or replace function public.resolve_manager_result(
  target_submission_id bigint,
  target_home_score integer,
  target_away_score integer,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  submission_row public.manager_result_submissions%rowtype;
  match_row public.matches%rowtype;
  winner_id bigint;
  loser_id bigint;
  revision_action text;
  configured_legs integer := 1;
  two_leg_knockout boolean := false;
  resolved record;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if target_home_score < 0 or target_away_score < 0 then
    raise exception 'Scores cannot be negative';
  end if;

  select * into submission_row
  from public.manager_result_submissions
  where id = target_submission_id
  for update;

  if not found then
    raise exception 'Result submission not found';
  end if;

  select * into match_row
  from public.matches
  where id = submission_row.match_id
  for update;

  if not found then
    raise exception 'Match not found';
  end if;

  select coalesce(t.knockout_leg_count, 1)
    into configured_legs
  from public.tournaments t
  where t.id = match_row.tournament_id;

  two_leg_knockout := match_row.stage = 'knockout'
    and public.is_knockout_only_tournament(match_row.tournament_id)
    and configured_legs = 2;

  if two_leg_knockout and match_row.leg = 1 then
    winner_id := null;
    loser_id := null;
  elsif two_leg_knockout and match_row.leg = 2 then
    select * into resolved
    from public.resolve_knockout_two_leg_score(
      match_row.id,
      target_home_score,
      target_away_score
    );
    winner_id := resolved.winner_id;
    loser_id := resolved.loser_id;
  else
    winner_id := case
      when target_home_score > target_away_score then match_row.home_entry_id
      when target_away_score > target_home_score then match_row.away_entry_id
      else null
    end;
    loser_id := case
      when target_home_score > target_away_score then match_row.away_entry_id
      when target_away_score > target_home_score then match_row.home_entry_id
      else null
    end;
  end if;

  revision_action := case
    when match_row.home_score is distinct from target_home_score
      or match_row.away_score is distinct from target_away_score
      then 'admin_corrected'
    else 'admin_finalised'
  end;

  insert into public.match_result_revisions (
    match_id,
    submission_id,
    changed_by,
    action,
    previous_status,
    previous_home_score,
    previous_away_score,
    new_status,
    new_home_score,
    new_away_score,
    reason
  ) values (
    match_row.id,
    submission_row.id,
    auth.uid(),
    revision_action,
    match_row.status,
    match_row.home_score,
    match_row.away_score,
    'played',
    target_home_score,
    target_away_score,
    note
  );

  update public.matches
  set home_score = target_home_score,
      away_score = target_away_score,
      home_normal_time_score = case when two_leg_knockout then target_home_score else home_normal_time_score end,
      away_normal_time_score = case when two_leg_knockout then target_away_score else away_normal_time_score end,
      winner_entry_id = winner_id,
      loser_entry_id = loser_id,
      status = 'played',
      played_at = coalesce(played_at, now())
  where id = submission_row.match_id;

  update public.manager_result_submissions
  set status = 'final',
      resolved_by = auth.uid(),
      resolved_home_score = target_home_score,
      resolved_away_score = target_away_score,
      resolution_note = note,
      resolved_at = now(),
      updated_at = now()
  where id = target_submission_id;
end;
$$;

revoke all on function public.resolve_manager_result(bigint, integer, integer, text) from public, anon;
grant execute on function public.resolve_manager_result(bigint, integer, integer, text) to authenticated, service_role;
