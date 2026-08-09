-- Allow managers to submit provisional forfeit rulings from the Manager Portal.
-- Admins remain the final authority; prize-draw forfeits are recorded only when
-- the provisional ruling is approved/finalised.

alter table public.manager_result_submissions
  add column if not exists submission_ruling text not null default 'played',
  add column if not exists forfeit_reason text,
  add column if not exists forfeiting_entry_id bigint references public.tournament_entries(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.manager_result_submissions'::regclass
      and conname = 'manager_result_submissions_ruling_check'
  ) then
    alter table public.manager_result_submissions
      add constraint manager_result_submissions_ruling_check
      check (submission_ruling in ('played','home_forfeit_win','away_forfeit_win'));
  end if;
end;
$$;

create or replace function public.submit_manager_result_with_ruling(
  target_match_id bigint,
  target_home_score integer,
  target_away_score integer,
  target_ruling text default 'played',
  target_reason text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.manager_portal_accounts%rowtype;
  match_row public.matches%rowtype;
  submitter_entry public.tournament_entries%rowtype;
  opponent_entry public.tournament_entries%rowtype;
  opponent_account public.manager_portal_accounts%rowtype;
  submission_id bigint;
  winner_id bigint;
  loser_id bigint;
  forfeiting_id bigint;
  provisional_status text;
begin
  if target_home_score < 0 or target_away_score < 0 then
    raise exception 'Scores cannot be negative';
  end if;
  if target_ruling not in ('played','home_forfeit_win','away_forfeit_win') then
    raise exception 'Unknown result ruling';
  end if;
  if target_ruling <> 'played' and nullif(trim(target_reason), '') is null then
    raise exception 'A reason is required when reporting a forfeit';
  end if;
  if target_ruling = 'home_forfeit_win'
     and (target_home_score <= target_away_score or target_home_score - target_away_score < 3) then
    raise exception 'An away-team forfeit must give the home team at least a three-goal advantage';
  end if;
  if target_ruling = 'away_forfeit_win'
     and (target_away_score <= target_home_score or target_away_score - target_home_score < 3) then
    raise exception 'A home-team forfeit must give the away team at least a three-goal advantage';
  end if;

  select * into account_row
  from public.manager_portal_accounts
  where auth_user_id = auth.uid() and active = true;
  if not found then raise exception 'Manager Portal account not found'; end if;

  select * into match_row from public.matches where id = target_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if match_row.status in ('forfeit','voided') then
    raise exception 'This fixture already has a terminal ruling';
  end if;

  select * into submitter_entry
  from public.tournament_entries
  where manager_id = account_row.manager_id
    and id in (match_row.home_entry_id, match_row.away_entry_id)
  limit 1;
  if not found then raise exception 'You are not a manager in this fixture'; end if;

  select * into opponent_entry
  from public.tournament_entries
  where id = case
    when submitter_entry.id = match_row.home_entry_id then match_row.away_entry_id
    else match_row.home_entry_id
  end;

  select * into opponent_account
  from public.manager_portal_accounts
  where manager_id = opponent_entry.manager_id and active = true
  limit 1;

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
  forfeiting_id := case
    when target_ruling = 'home_forfeit_win' then match_row.away_entry_id
    when target_ruling = 'away_forfeit_win' then match_row.home_entry_id
    else null
  end;
  provisional_status := case when target_ruling = 'played' then 'played' else 'forfeit' end;

  insert into public.manager_result_submissions (
    match_id, submitted_by_user_id, submitted_by_manager_id,
    submitted_home_score, submitted_away_score,
    opponent_user_id, opponent_manager_id, status,
    submission_ruling, forfeit_reason, forfeiting_entry_id, updated_at
  ) values (
    target_match_id, auth.uid(), account_row.manager_id,
    target_home_score, target_away_score,
    opponent_account.auth_user_id, opponent_entry.manager_id,
    'pending_admin_check', target_ruling,
    nullif(trim(target_reason), ''), forfeiting_id, now()
  )
  on conflict (match_id) do update set
    submitted_by_user_id = excluded.submitted_by_user_id,
    submitted_by_manager_id = excluded.submitted_by_manager_id,
    submitted_home_score = excluded.submitted_home_score,
    submitted_away_score = excluded.submitted_away_score,
    opponent_user_id = excluded.opponent_user_id,
    opponent_manager_id = excluded.opponent_manager_id,
    opponent_response_note = null,
    status = 'pending_admin_check',
    submission_ruling = excluded.submission_ruling,
    forfeit_reason = excluded.forfeit_reason,
    forfeiting_entry_id = excluded.forfeiting_entry_id,
    confirmed_at = null,
    disputed_at = null,
    resolved_by = null,
    resolved_home_score = null,
    resolved_away_score = null,
    resolution_note = null,
    resolved_at = null,
    updated_at = now()
  returning id into submission_id;

  insert into public.match_result_revisions (
    match_id, submission_id, changed_by, action,
    previous_status, previous_home_score, previous_away_score,
    new_status, new_home_score, new_away_score, reason
  ) values (
    target_match_id, submission_id, auth.uid(), 'manager_submission',
    match_row.status, match_row.home_score, match_row.away_score,
    provisional_status, target_home_score, target_away_score,
    case when target_ruling = 'played'
      then 'Provisionally published from Manager Portal submission.'
      else 'Provisional manager-reported forfeit: ' || trim(target_reason)
    end
  );

  update public.matches
  set home_score = target_home_score,
      away_score = target_away_score,
      winner_entry_id = winner_id,
      loser_entry_id = loser_id,
      status = provisional_status,
      played_at = coalesce(played_at, now())
  where id = target_match_id;

  return submission_id;
end;
$$;

grant execute on function public.submit_manager_result_with_ruling(bigint, integer, integer, text, text)
  to authenticated;

-- Keep the permanent forfeit register in sync only when an administrator
-- finalises/amends a forfeit. Provisional manager claims do not affect prize-draw
-- eligibility until they are approved.
create or replace function public.admin_amend_match_result(
  target_match_id bigint,
  target_home_score integer default null,
  target_away_score integer default null,
  target_status text default 'played',
  note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.matches%rowtype;
  submission_row public.manager_result_submissions%rowtype;
  winner_id bigint;
  loser_id bigint;
  revision_action text;
  forfeiting_manager_id bigint;
  forfeit_source text;
  forfeit_reason_text text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if nullif(trim(note), '') is null then raise exception 'A reason is required for retrospective result changes'; end if;
  if target_status not in ('played','forfeit','voided') then raise exception 'Status must be played, forfeit or voided'; end if;
  if target_status <> 'voided' and (target_home_score is null or target_away_score is null or target_home_score < 0 or target_away_score < 0) then
    raise exception 'Valid scores are required unless the match is voided';
  end if;

  select * into match_row from public.matches where id = target_match_id for update;
  if not found then raise exception 'Match not found'; end if;

  select * into submission_row
  from public.manager_result_submissions
  where match_id = target_match_id
  limit 1;

  if target_status = 'voided' then
    winner_id := null;
    loser_id := null;
    revision_action := 'voided';
  else
    winner_id := case when target_home_score > target_away_score then match_row.home_entry_id when target_away_score > target_home_score then match_row.away_entry_id else null end;
    loser_id := case when target_home_score > target_away_score then match_row.away_entry_id when target_away_score > target_home_score then match_row.home_entry_id else null end;
    revision_action := case when target_status = 'forfeit' then 'forfeit' else 'admin_corrected' end;
  end if;

  if target_status = 'forfeit' and winner_id is null then
    raise exception 'A forfeit result must have a winning team';
  end if;

  insert into public.match_result_revisions (
    match_id, changed_by, action,
    previous_status, previous_home_score, previous_away_score,
    new_status, new_home_score, new_away_score, reason
  ) values (
    match_row.id, auth.uid(), revision_action,
    match_row.status, match_row.home_score, match_row.away_score,
    target_status, target_home_score, target_away_score, note
  );

  update public.matches set
    home_score = case when target_status = 'voided' then null else target_home_score end,
    away_score = case when target_status = 'voided' then null else target_away_score end,
    winner_entry_id = winner_id,
    loser_entry_id = loser_id,
    status = target_status,
    played_at = case when target_status = 'voided' then null else coalesce(played_at, now()) end
  where id = target_match_id;

  delete from public.forfeits where match_id = target_match_id;
  if target_status = 'forfeit' then
    select manager_id into forfeiting_manager_id
    from public.tournament_entries where id = loser_id;

    forfeit_source := case
      when submission_row.id is not null and submission_row.submission_ruling <> 'played' then 'manager_portal'
      else 'admin'
    end;
    forfeit_reason_text := coalesce(nullif(trim(submission_row.forfeit_reason), ''), trim(note));

    insert into public.forfeits (
      match_id, forfeiting_entry_id, manager_id, reason,
      penalty, affects_prize_draw, source
    ) values (
      target_match_id, loser_id, forfeiting_manager_id, forfeit_reason_text,
      'Match forfeit', true, forfeit_source
    );
  end if;

  update public.manager_result_submissions set
    status = 'final',
    resolved_by = auth.uid(),
    resolved_home_score = case when target_status = 'voided' then null else target_home_score end,
    resolved_away_score = case when target_status = 'voided' then null else target_away_score end,
    resolution_note = note,
    resolved_at = now(),
    updated_at = now()
  where match_id = target_match_id;
end;
$$;

grant execute on function public.admin_amend_match_result(bigint, integer, integer, text, text)
  to authenticated;
