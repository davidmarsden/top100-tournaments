-- Complete provisional-result rejection, final-score protection and void handling.

-- Add a genuine terminal `voided` status to matches. Drop the existing status
-- check dynamically because older environments may have generated a different
-- constraint name.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.matches'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.matches drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

alter table public.matches
  add constraint matches_status_check
  check (status in ('scheduled','played','forfeit','postponed','cancelled','voided'));

-- A manager must never be able to move a finalised submission back into a live
-- state. This trigger protects the row even if the RPC is called directly.
create or replace function public.protect_final_manager_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'final'
     and new.status is distinct from old.status
     and not public.is_admin() then
    raise exception 'This result has been finalised. Only an administrator can reopen or amend it.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_final_manager_result_trigger
  on public.manager_result_submissions;

create trigger protect_final_manager_result_trigger
before update on public.manager_result_submissions
for each row execute function public.protect_final_manager_result();

create or replace function public.reject_manager_result(
  target_submission_id bigint,
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
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if nullif(trim(note), '') is null then raise exception 'A rejection reason is required'; end if;

  select * into submission_row from public.manager_result_submissions
  where id = target_submission_id for update;
  if not found then raise exception 'Result submission not found'; end if;
  if submission_row.status not in ('pending_confirmation','disputed','pending_admin_check','opponent_confirmed','appealed') then
    raise exception 'This submission is no longer awaiting review';
  end if;

  select * into match_row from public.matches where id = submission_row.match_id for update;

  insert into public.match_result_revisions (
    match_id, submission_id, changed_by, action,
    previous_status, previous_home_score, previous_away_score,
    new_status, new_home_score, new_away_score, reason
  ) values (
    match_row.id, submission_row.id, auth.uid(), 'reopened',
    match_row.status, match_row.home_score, match_row.away_score,
    'scheduled', null, null, note
  );

  update public.matches set
    home_score = null,
    away_score = null,
    winner_entry_id = null,
    loser_entry_id = null,
    status = 'scheduled',
    played_at = null
  where id = submission_row.match_id;

  update public.manager_result_submissions set
    status = 'withdrawn',
    resolved_by = auth.uid(),
    resolution_note = note,
    resolved_at = now(),
    updated_at = now()
  where id = target_submission_id;
end;
$$;

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
  winner_id bigint;
  loser_id bigint;
  revision_action text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if nullif(trim(note), '') is null then raise exception 'A reason is required for retrospective result changes'; end if;
  if target_status not in ('played','forfeit','voided') then raise exception 'Status must be played, forfeit or voided'; end if;
  if target_status <> 'voided' and (target_home_score is null or target_away_score is null or target_home_score < 0 or target_away_score < 0) then
    raise exception 'Valid scores are required unless the match is voided';
  end if;

  select * into match_row from public.matches where id = target_match_id for update;
  if not found then raise exception 'Match not found'; end if;

  if target_status = 'voided' then
    winner_id := null;
    loser_id := null;
    revision_action := 'voided';
  else
    winner_id := case when target_home_score > target_away_score then match_row.home_entry_id when target_away_score > target_home_score then match_row.away_entry_id else null end;
    loser_id := case when target_home_score > target_away_score then match_row.away_entry_id when target_away_score > target_home_score then match_row.home_entry_id else null end;
    revision_action := case when target_status = 'forfeit' then 'forfeit' else 'admin_corrected' end;
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
    played_at = coalesce(played_at, now())
  where id = target_match_id;

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

grant execute on function public.reject_manager_result(bigint, text) to authenticated;
grant execute on function public.admin_amend_match_result(bigint, integer, integer, text, text) to authenticated;