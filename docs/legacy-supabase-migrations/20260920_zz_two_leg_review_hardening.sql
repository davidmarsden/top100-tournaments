-- Review hardening for knockout-only two-leg ties.
-- - Manager Portal submissions understand leg 1 vs aggregate-deciding leg 2.
-- - Admin finalisation uses aggregate/away-goals resolution too.
-- - A completed leg 2 freezes leg 1 until leg 2 is reset.
-- - A level aggregate may remain unresolved until organiser FET is entered.

create or replace function public.resolve_knockout_two_leg_score(
  target_match_id bigint,
  target_home_score integer,
  target_away_score integer
)
returns table(winner_id bigint, loser_id bigint, needs_fet boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_match public.matches%rowtype;
  first_leg public.matches%rowtype;
  first_id bigint;
  second_id bigint;
  first_agg integer;
  second_agg integer;
  first_away integer := 0;
  second_away integer := 0;
  first_home integer;
  first_away_score integer;
begin
  select * into current_match
  from public.matches
  where id = target_match_id;

  if not found then raise exception 'Match not found'; end if;
  if current_match.stage <> 'knockout' or current_match.leg <> 2 then
    raise exception 'Two-leg resolution requires the second knockout leg';
  end if;

  select * into first_leg
  from public.matches m
  where m.tournament_id = current_match.tournament_id
    and m.stage = 'knockout'
    and coalesce(m.bracket, 'Cup') = coalesce(current_match.bracket, 'Cup')
    and m.round = current_match.round
    and m.match_order = current_match.match_order
    and m.leg = 1
    and m.id <> current_match.id
  limit 1;

  if not found
     or first_leg.status not in ('played', 'forfeit')
     or first_leg.home_score is null
     or first_leg.away_score is null then
    raise exception 'Complete the first leg before recording the second leg';
  end if;

  first_id := first_leg.home_entry_id;
  second_id := first_leg.away_entry_id;
  if first_id is null or second_id is null then
    raise exception 'A two-leg tie requires two entrants';
  end if;

  if not (
    (current_match.home_entry_id = first_id and current_match.away_entry_id = second_id)
    or
    (current_match.home_entry_id = second_id and current_match.away_entry_id = first_id)
  ) then
    raise exception 'Second-leg entrants do not match the first leg';
  end if;

  first_home := coalesce(first_leg.home_normal_time_score, first_leg.home_score);
  first_away_score := coalesce(first_leg.away_normal_time_score, first_leg.away_score);

  first_agg := first_home;
  second_agg := first_away_score;
  second_away := first_away_score;

  if current_match.home_entry_id = first_id then
    first_agg := first_agg + target_home_score;
    second_agg := second_agg + target_away_score;
    second_away := second_away + target_away_score;
  else
    first_agg := first_agg + target_away_score;
    second_agg := second_agg + target_home_score;
    first_away := first_away + target_away_score;
  end if;

  if first_agg > second_agg then
    winner_id := first_id; loser_id := second_id; needs_fet := false;
  elsif second_agg > first_agg then
    winner_id := second_id; loser_id := first_id; needs_fet := false;
  elsif first_away > second_away then
    winner_id := first_id; loser_id := second_id; needs_fet := false;
  elsif second_away > first_away then
    winner_id := second_id; loser_id := first_id; needs_fet := false;
  else
    winner_id := null; loser_id := null; needs_fet := true;
  end if;

  return next;
end;
$$;

revoke all on function public.resolve_knockout_two_leg_score(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.resolve_knockout_two_leg_score(bigint, integer, integer) to service_role;

create or replace function public.guard_knockout_round_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_changed boolean;
  has_successor boolean;
  canonical_double_forfeit boolean;
  configured_legs integer := 1;
  resolved record;
  home_fet integer;
  away_fet integer;
  fet_winner bigint;
  fet_loser bigint;
begin
  result_changed :=
    tg_op = 'UPDATE'
    and (
      new.home_score is distinct from old.home_score
      or new.away_score is distinct from old.away_score
      or new.home_normal_time_score is distinct from old.home_normal_time_score
      or new.away_normal_time_score is distinct from old.away_normal_time_score
      or new.home_extra_time_score is distinct from old.home_extra_time_score
      or new.away_extra_time_score is distinct from old.away_extra_time_score
      or new.winner_entry_id is distinct from old.winner_entry_id
      or new.loser_entry_id is distinct from old.loser_entry_id
      or new.status is distinct from old.status
      or new.decided_by is distinct from old.decided_by
      or new.played_at is distinct from old.played_at
    );

  if tg_op = 'UPDATE'
     and result_changed
     and old.stage = 'knockout'
     and old.leg = 1
     and public.is_knockout_only_tournament(old.tournament_id)
     and exists (
       select 1
       from public.matches sibling
       where sibling.tournament_id = old.tournament_id
         and sibling.stage = 'knockout'
         and coalesce(sibling.bracket, 'Cup') = coalesce(old.bracket, 'Cup')
         and sibling.round = old.round
         and sibling.match_order = old.match_order
         and sibling.leg = 2
         and sibling.status in ('played', 'forfeit')
     ) then
    raise exception 'Reset the completed second leg before changing the first-leg result';
  end if;

  canonical_double_forfeit :=
    new.status = 'forfeit'
    and new.home_score = 0
    and new.away_score = 0
    and new.winner_entry_id is null
    and new.loser_entry_id is null
    and new.decided_by = 'double_forfeit';

  if new.stage = 'knockout'
     and public.is_knockout_only_tournament(new.tournament_id)
     and new.away_entry_id is not null
     and new.status in ('played', 'forfeit')
     and not canonical_double_forfeit then

    select coalesce(t.knockout_leg_count, 1)
      into configured_legs
    from public.tournaments t
    where t.id = new.tournament_id;

    if new.home_score is null or new.away_score is null then
      raise exception 'Knockout results require both scores';
    end if;

    if configured_legs = 2 then
      if new.leg = 1 then
        if new.winner_entry_id is not null or new.loser_entry_id is not null then
          raise exception 'A two-leg tie winner is recorded only on the deciding second leg';
        end if;
      elsif new.leg = 2 then
        select * into resolved
        from public.resolve_knockout_two_leg_score(new.id,
          coalesce(new.home_normal_time_score, new.home_score),
          coalesce(new.away_normal_time_score, new.away_score));

        if resolved.needs_fet then
          if new.decided_by in ('fictional_extra_time', 'manual') then
            home_fet := coalesce(new.home_extra_time_score, 0);
            away_fet := coalesce(new.away_extra_time_score, 0);
            if home_fet = away_fet then
              raise exception 'FET must resolve the level two-leg tie';
            end if;
            fet_winner := case when home_fet > away_fet then new.home_entry_id else new.away_entry_id end;
            fet_loser := case when home_fet > away_fet then new.away_entry_id else new.home_entry_id end;
            if new.winner_entry_id is distinct from fet_winner
               or new.loser_entry_id is distinct from fet_loser then
              raise exception 'Winner and loser must agree with the FET resolution';
            end if;
          elsif new.winner_entry_id is not null or new.loser_entry_id is not null then
            raise exception 'A level aggregate has no winner until Fictional Extra Time is resolved';
          end if;
        elsif new.winner_entry_id is distinct from resolved.winner_id
           or new.loser_entry_id is distinct from resolved.loser_id then
          raise exception 'Winner and loser must agree with the resolved two-leg tie';
        end if;
      else
        raise exception 'Two-leg knockout ties may only contain leg 1 and leg 2';
      end if;
    else
      if new.home_score = new.away_score then
        raise exception 'Knockout-only ties must have a decisive score';
      end if;
      if new.home_score > new.away_score then
        if new.winner_entry_id is distinct from new.home_entry_id
           or new.loser_entry_id is distinct from new.away_entry_id then
          raise exception 'Winner and loser must agree with the knockout score';
        end if;
      else
        if new.winner_entry_id is distinct from new.away_entry_id
           or new.loser_entry_id is distinct from new.home_entry_id then
          raise exception 'Winner and loser must agree with the knockout score';
        end if;
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and result_changed
     and old.stage = 'knockout'
     and public.is_knockout_only_tournament(old.tournament_id) then
    select exists (
      select 1
      from public.matches successor
      where successor.tournament_id = old.tournament_id
        and successor.stage = 'knockout'
        and coalesce(successor.bracket, 'Cup') = coalesce(old.bracket, 'Cup')
        and public.knockout_round_rank(successor.round) > public.knockout_round_rank(old.round)
    ) into has_successor;

    if has_successor then
      raise exception 'This knockout result is locked because a later round has already been generated';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_knockout_round_dependency() from public, anon, authenticated;
grant execute on function public.guard_knockout_round_dependency() to service_role;

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
  configured_legs integer := 1;
  two_leg_knockout boolean := false;
  resolved record;
begin
  if target_home_score < 0 or target_away_score < 0 then raise exception 'Scores cannot be negative'; end if;
  if target_ruling not in ('played','home_forfeit_win','away_forfeit_win') then raise exception 'Unknown result ruling'; end if;
  if target_ruling <> 'played' and nullif(trim(target_reason), '') is null then raise exception 'A reason is required when reporting a forfeit'; end if;
  if target_ruling = 'home_forfeit_win' and (target_home_score <= target_away_score or target_home_score - target_away_score < 3) then raise exception 'An away-team forfeit must give the home team at least a three-goal advantage'; end if;
  if target_ruling = 'away_forfeit_win' and (target_away_score <= target_home_score or target_away_score - target_home_score < 3) then raise exception 'A home-team forfeit must give the away team at least a three-goal advantage'; end if;

  select * into account_row from public.manager_portal_accounts where auth_user_id = auth.uid() and active = true;
  if not found then raise exception 'Manager Portal account not found'; end if;

  select * into match_row from public.matches where id = target_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if match_row.status in ('forfeit','voided') then raise exception 'This fixture already has a terminal ruling'; end if;

  select coalesce(t.knockout_leg_count, 1)
    into configured_legs
  from public.tournaments t
  where t.id = match_row.tournament_id;
  two_leg_knockout := match_row.stage = 'knockout'
    and public.is_knockout_only_tournament(match_row.tournament_id)
    and configured_legs = 2;

  select * into submitter_entry from public.tournament_entries
  where manager_id = account_row.manager_id and id in (match_row.home_entry_id, match_row.away_entry_id) limit 1;
  if not found then raise exception 'You are not a manager in this fixture'; end if;

  select * into opponent_entry from public.tournament_entries
  where id = case when submitter_entry.id = match_row.home_entry_id then match_row.away_entry_id else match_row.home_entry_id end;

  select * into opponent_account from public.manager_portal_accounts
  where manager_id = opponent_entry.manager_id and active = true limit 1;

  if two_leg_knockout and match_row.leg = 1 then
    winner_id := null;
    loser_id := null;
  elsif two_leg_knockout and match_row.leg = 2 then
    select * into resolved
    from public.resolve_knockout_two_leg_score(target_match_id, target_home_score, target_away_score);
    winner_id := resolved.winner_id;
    loser_id := resolved.loser_id;
  else
    winner_id := case when target_home_score > target_away_score then match_row.home_entry_id when target_away_score > target_home_score then match_row.away_entry_id else null end;
    loser_id := case when target_home_score > target_away_score then match_row.away_entry_id when target_away_score > target_home_score then match_row.home_entry_id else null end;
  end if;

  forfeiting_id := case when target_ruling = 'home_forfeit_win' then match_row.away_entry_id when target_ruling = 'away_forfeit_win' then match_row.home_entry_id else null end;
  provisional_status := case when target_ruling = 'played' then 'played' else 'forfeit' end;

  insert into public.manager_result_submissions (
    match_id, submitted_by_user_id, submitted_by_manager_id, submitted_home_score, submitted_away_score,
    opponent_user_id, opponent_manager_id, status, submission_ruling, forfeit_reason, forfeiting_entry_id, updated_at
  ) values (
    target_match_id, auth.uid(), account_row.manager_id, target_home_score, target_away_score,
    opponent_account.auth_user_id, opponent_entry.manager_id, 'pending_admin_check', target_ruling,
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
    match_id, submission_id, changed_by, action, previous_status, previous_home_score, previous_away_score,
    new_status, new_home_score, new_away_score, reason
  ) values (
    target_match_id, submission_id, auth.uid(), 'manager_submission', match_row.status, match_row.home_score, match_row.away_score,
    provisional_status, target_home_score, target_away_score,
    case when target_ruling = 'played' then 'Provisionally published from Manager Portal submission.' else 'Provisional manager-reported forfeit: ' || trim(target_reason) end
  );

  update public.matches set
    home_score = target_home_score,
    away_score = target_away_score,
    home_normal_time_score = case when two_leg_knockout then target_home_score else home_normal_time_score end,
    away_normal_time_score = case when two_leg_knockout then target_away_score else away_normal_time_score end,
    winner_entry_id = winner_id,
    loser_entry_id = loser_id,
    status = provisional_status,
    played_at = coalesce(played_at, now())
  where id = target_match_id;

  return submission_id;
end;
$$;

revoke all on function public.submit_manager_result_with_ruling(bigint, integer, integer, text, text) from public, anon;
grant execute on function public.submit_manager_result_with_ruling(bigint, integer, integer, text, text) to authenticated, service_role;

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
  forfeiting_entry_id bigint;
  forfeit_source text;
  forfeit_reason_text text;
  configured_legs integer := 1;
  two_leg_knockout boolean := false;
  resolved record;
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

  select coalesce(t.knockout_leg_count, 1)
    into configured_legs
  from public.tournaments t
  where t.id = match_row.tournament_id;
  two_leg_knockout := match_row.stage = 'knockout'
    and public.is_knockout_only_tournament(match_row.tournament_id)
    and configured_legs = 2;

  if target_status = 'voided' then
    winner_id := null;
    loser_id := null;
    revision_action := 'voided';
  elsif two_leg_knockout and match_row.leg = 1 then
    winner_id := null;
    loser_id := null;
    revision_action := case when target_status = 'forfeit' then 'forfeit' else 'admin_corrected' end;
  elsif two_leg_knockout and match_row.leg = 2 then
    select * into resolved
    from public.resolve_knockout_two_leg_score(target_match_id, target_home_score, target_away_score);
    winner_id := resolved.winner_id;
    loser_id := resolved.loser_id;
    revision_action := case when target_status = 'forfeit' then 'forfeit' else 'admin_corrected' end;
  else
    winner_id := case when target_home_score > target_away_score then match_row.home_entry_id when target_away_score > target_home_score then match_row.away_entry_id else null end;
    loser_id := case when target_home_score > target_away_score then match_row.away_entry_id when target_away_score > target_home_score then match_row.home_entry_id else null end;
    revision_action := case when target_status = 'forfeit' then 'forfeit' else 'admin_corrected' end;
  end if;

  if target_status = 'forfeit' then
    forfeiting_entry_id := submission_row.forfeiting_entry_id;
    if forfeiting_entry_id is null then
      forfeiting_entry_id := case
        when target_home_score < target_away_score then match_row.home_entry_id
        when target_away_score < target_home_score then match_row.away_entry_id
        else null
      end;
    end if;
    if forfeiting_entry_id is null then
      raise exception 'A forfeit result must identify the forfeiting team';
    end if;
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
    home_normal_time_score = case when two_leg_knockout and target_status <> 'voided' then target_home_score else home_normal_time_score end,
    away_normal_time_score = case when two_leg_knockout and target_status <> 'voided' then target_away_score else away_normal_time_score end,
    home_extra_time_score = case when two_leg_knockout then null else home_extra_time_score end,
    away_extra_time_score = case when two_leg_knockout then null else away_extra_time_score end,
    home_possession = case when two_leg_knockout then null else home_possession end,
    away_possession = case when two_leg_knockout then null else away_possession end,
    home_shots_on_target = case when two_leg_knockout then null else home_shots_on_target end,
    away_shots_on_target = case when two_leg_knockout then null else away_shots_on_target end,
    decided_by = case when two_leg_knockout then null else decided_by end,
    winner_entry_id = winner_id,
    loser_entry_id = loser_id,
    status = target_status,
    played_at = case when target_status = 'voided' then null else coalesce(played_at, now()) end
  where id = target_match_id;

  delete from public.forfeits where match_id = target_match_id;
  if target_status = 'forfeit' then
    select manager_id into forfeiting_manager_id
    from public.tournament_entries where id = forfeiting_entry_id;

    if submission_row.id is not null
       and submission_row.submission_ruling <> 'played'
       and submission_row.forfeiting_entry_id = forfeiting_entry_id then
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
      target_match_id, forfeiting_entry_id, forfeiting_manager_id, forfeit_reason_text,
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

revoke all on function public.admin_amend_match_result(bigint, integer, integer, text, text) from public, anon;
grant execute on function public.admin_amend_match_result(bigint, integer, integer, text, text) to authenticated, service_role;
