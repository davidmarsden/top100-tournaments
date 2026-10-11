-- Follow-up for environments where 20260809_manager_forfeit_submissions.sql
-- was applied before the provisional/permanent distinction was tightened.

create or replace function public.sync_match_forfeit_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  forfeiting_entry bigint;
  responsible_manager bigint;
  provisional_manager_forfeit boolean;
begin
  if new.status = 'forfeit' then
    select exists (
      select 1
      from public.manager_result_submissions s
      where s.match_id = new.id
        and s.submission_ruling <> 'played'
        and s.status in ('pending_admin_check','opponent_confirmed','appealed')
    ) into provisional_manager_forfeit;

    if provisional_manager_forfeit then
      delete from public.forfeits
      where match_id = new.id
        and source = 'match_ruling';
      return new;
    end if;

    forfeiting_entry := new.loser_entry_id;
    if forfeiting_entry is null then
      if new.home_score is not null and new.away_score is not null and new.home_score < new.away_score then
        forfeiting_entry := new.home_entry_id;
      elsif new.home_score is not null and new.away_score is not null and new.away_score < new.home_score then
        forfeiting_entry := new.away_entry_id;
      end if;
    end if;

    if forfeiting_entry is null then
      raise exception using
        errcode = '23514',
        message = 'Cannot record forfeit: the responsible losing entrant could not be determined.',
        hint = 'Supply loser_entry_id and a decisive official score before setting the match status to forfeit.';
    end if;

    select manager_id into responsible_manager
    from public.tournament_entries
    where id = forfeiting_entry;

    if responsible_manager is null then
      raise exception using
        errcode = '23514',
        message = 'Cannot record forfeit: the responsible entrant has no manager.',
        hint = 'Assign the responsible manager to the tournament entrant before recording the forfeit.';
    end if;

    insert into public.forfeits (
      match_id, forfeiting_entry_id, manager_id, reason,
      penalty, affects_prize_draw, source
    ) values (
      new.id, forfeiting_entry, responsible_manager,
      'Match recorded as a forfeit', 'Match forfeiture', true, 'match_ruling'
    )
    on conflict (match_id) where match_id is not null
    do update set
      forfeiting_entry_id = excluded.forfeiting_entry_id,
      manager_id = excluded.manager_id,
      source = 'match_ruling';
  else
    delete from public.forfeits
    where match_id = new.id
      and source = 'match_ruling';
  end if;
  return new;
end;
$$;

delete from public.forfeits f
using public.manager_result_submissions s
where f.match_id = s.match_id
  and f.source = 'match_ruling'
  and s.submission_ruling <> 'played'
  and s.status in ('pending_admin_check','opponent_confirmed','appealed');

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

    if submission_row.id is not null
       and submission_row.submission_ruling <> 'played'
       and submission_row.forfeiting_entry_id = loser_id then
      forfeit_source := 'manager_portal';
      forfeit_reason_text := coalesce(nullif(trim(submission_row.forfeit_reason), ''), trim(note));
    else
      forfeit_source := 'admin';
      forfeit_reason_text := trim(note);
    end if;

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

revoke all on function public.sync_match_forfeit_record() from public, anon, authenticated;
revoke all on function public.admin_amend_match_result(bigint, integer, integer, text, text) from public, anon;
grant execute on function public.admin_amend_match_result(bigint, integer, integer, text, text) to authenticated;