-- Support group matches where both teams forfeit: official score 0-0,
-- both teams receive a loss and zero points, and both managers are recorded.
-- A single match can therefore have two authoritative forfeit records.

-- The original model allowed only one forfeiting entrant per match. Replace that
-- with one row per match + forfeiting entrant so double forfeits can record both.
drop index if exists public.forfeits_match_id_unique;
create unique index if not exists forfeits_match_entry_unique
  on public.forfeits(match_id, forfeiting_entry_id)
  where match_id is not null and forfeiting_entry_id is not null;

-- Keep match rulings and the permanent forfeit register synchronised. A tied
-- 0-0 forfeit is the canonical double-forfeit representation.
create or replace function public.sync_match_forfeit_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  forfeiting_entry bigint;
  responsible_manager bigint;
  home_manager bigint;
  away_manager bigint;
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

    -- A non-provisional match ruling is authoritative. Clear any previous
    -- single/double-forfeit rows before rebuilding the register from the match.
    delete from public.forfeits
    where match_id = new.id;

    if new.home_score = 0 and new.away_score = 0 and new.winner_entry_id is null and new.loser_entry_id is null then
      if new.home_entry_id is null or new.away_entry_id is null then
        raise exception 'A double forfeit requires both tournament entrants';
      end if;

      select manager_id into home_manager from public.tournament_entries where id = new.home_entry_id;
      select manager_id into away_manager from public.tournament_entries where id = new.away_entry_id;
      if home_manager is null or away_manager is null then
        raise exception 'Both forfeiting entrants must have managers assigned';
      end if;

      insert into public.forfeits (
        match_id, forfeiting_entry_id, manager_id, reason,
        penalty, affects_prize_draw, source
      ) values
        (new.id, new.home_entry_id, home_manager, 'Both teams forfeited', 'Double forfeit — 0 points', true, 'match_ruling'),
        (new.id, new.away_entry_id, away_manager, 'Both teams forfeited', 'Double forfeit — 0 points', true, 'match_ruling');

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
        hint = 'Use a decisive score for a single-team forfeit, or 0-0 with no winner/loser for a double forfeit.';
    end if;

    select manager_id into responsible_manager
    from public.tournament_entries
    where id = forfeiting_entry;

    if responsible_manager is null then
      raise exception 'Cannot record forfeit: the responsible entrant has no manager';
    end if;

    insert into public.forfeits (
      match_id, forfeiting_entry_id, manager_id, reason,
      penalty, affects_prize_draw, source
    ) values (
      new.id, forfeiting_entry, responsible_manager,
      'Match recorded as a forfeit', 'Match forfeiture', true, 'match_ruling'
    );
  else
    -- Once a forfeit ruling is reversed/reset, no permanent disciplinary row for
    -- that match should survive regardless of whether it was created by trigger
    -- synchronisation or subsequently labelled as an admin ruling.
    delete from public.forfeits
    where match_id = new.id;
  end if;

  return new;
end;
$$;

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
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if nullif(trim(note), '') is null then raise exception 'A reason is required for a double forfeit'; end if;

  select * into match_row
  from public.matches
  where id = target_match_id
  for update;
  if not found then raise exception 'Match not found'; end if;
  if match_row.stage <> 'group' then raise exception 'Double forfeits are currently supported for group-stage matches only'; end if;
  if match_row.home_entry_id is null or match_row.away_entry_id is null then raise exception 'Both entrants are required'; end if;

  insert into public.match_result_revisions (
    match_id, changed_by, action,
    previous_status, previous_home_score, previous_away_score,
    new_status, new_home_score, new_away_score, reason
  ) values (
    match_row.id, auth.uid(), 'forfeit',
    match_row.status, match_row.home_score, match_row.away_score,
    'forfeit', 0, 0, trim(note)
  );

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
      penalty = 'Double forfeit — 0 points',
      affects_prize_draw = true,
      source = 'admin'
  where match_id = target_match_id;

  update public.manager_result_submissions
  set status = 'final',
      resolved_by = auth.uid(),
      resolved_home_score = 0,
      resolved_away_score = 0,
      resolution_note = trim(note),
      resolved_at = now(),
      updated_at = now()
  where match_id = target_match_id;
end;
$$;

revoke all on function public.sync_match_forfeit_record() from public, anon, authenticated;
revoke all on function public.admin_record_double_forfeit(bigint, text) from public, anon;
grant execute on function public.admin_record_double_forfeit(bigint, text) to authenticated;
