-- Follow-up review hardening for two-leg knockout ties.
-- 1. Aggregate resolution locks leg 1 so a concurrent correction cannot race a
--    leg-2 submission and leave a stale stored winner.
-- 2. The canonical tie-level double-forfeit operation is allowed to update leg 1
--    after it has marked leg 2 forfeited in the same transaction.

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

  -- Serialize aggregate resolution with any concurrent correction to leg 1.
  -- UPDATE already takes this same row lock before its trigger runs, so whichever
  -- transaction gets here second necessarily sees the committed first-leg score.
  select * into first_leg
  from public.matches m
  where m.tournament_id = current_match.tournament_id
    and m.stage = 'knockout'
    and coalesce(m.bracket, 'Cup') = coalesce(current_match.bracket, 'Cup')
    and m.round = current_match.round
    and m.match_order = current_match.match_order
    and m.leg = 1
    and m.id <> current_match.id
  for update
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
  canonical_double_forfeit :=
    new.status = 'forfeit'
    and new.home_score = 0
    and new.away_score = 0
    and new.winner_entry_id is null
    and new.loser_entry_id is null
    and new.decided_by = 'double_forfeit';

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
     and not canonical_double_forfeit
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
        from public.resolve_knockout_two_leg_score(
          new.id,
          coalesce(new.home_normal_time_score, new.home_score),
          coalesce(new.away_normal_time_score, new.away_score)
        );

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
