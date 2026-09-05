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

  -- In a two-legged knockout tie, a double forfeit on either leg eliminates both
  -- entrants from the tie. Mark every sibling leg with the same canonical 0-0
  -- double-forfeit representation so aggregate resolution cannot revive either team.
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
      winner_entry_id = null,
      loser_entry_id = null,
      status = 'forfeit',
      decided_by = case when match_row.stage = 'knockout' then 'double_forfeit' else decided_by end,
      played_at = coalesce(played_at, now())
  where id = target_match_id;

  update public.forfeits
  set reason = trim(note),
      penalty = penalty_text,
      affects_prize_draw = true,
      source = 'admin'
  where match_id = target_match_id;

  -- Sibling legs are structural consequences of one tie-level disciplinary event,
  -- not additional forfeits. Keep only the two register rows for the selected match.
  if match_row.stage = 'knockout' and sibling_ids is not null then
    delete from public.forfeits where match_id = any(sibling_ids);
  end if;
end;
$$;

revoke all on function public.admin_record_double_forfeit(bigint, text) from public, anon;
grant execute on function public.admin_record_double_forfeit(bigint, text) to authenticated;

-- Knockout-only tournaments are normally decisive, but a canonical 0-0 double
-- forfeit is the deliberate exception: no winner and no loser because both exit.
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
begin
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
    if new.home_score is null or new.away_score is null or new.home_score = new.away_score then
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

  if tg_op <> 'UPDATE'
     or old.stage <> 'knockout'
     or not public.is_knockout_only_tournament(old.tournament_id) then
    return new;
  end if;

  result_changed :=
    new.home_score is distinct from old.home_score
    or new.away_score is distinct from old.away_score
    or new.winner_entry_id is distinct from old.winner_entry_id
    or new.loser_entry_id is distinct from old.loser_entry_id
    or new.status is distinct from old.status
    or new.decided_by is distinct from old.decided_by
    or new.played_at is distinct from old.played_at;

  if not result_changed then return new; end if;

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

  return new;
end;
$$;

revoke all on function public.guard_knockout_round_dependency() from public, anon, authenticated;
grant execute on function public.guard_knockout_round_dependency() to service_role;

-- Atomic successor generation for knockout-only tournaments now preserves bracket
-- positions when a source tie has no winner because both teams forfeited.
create or replace function public.generate_knockout_successor_round_atomic(p_tournament_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  source_round text;
  next_round text;
  source_rows public.matches[];
  source_count integer;
  index_value integer;
  home_id bigint;
  away_id bigint;
  home_seed_value integer;
  away_seed_value integer;
  home_name text;
  away_name text;
  tie_count integer := 0;
  bye_count integer := 0;
  vacant_count integer := 0;
begin
  if not public.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have organiser access to this tournament';
  end if;

  perform pg_advisory_xact_lock(public.knockout_roster_lock_key(p_tournament_id));

  select * into tournament_row
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then raise exception 'Tournament not found'; end if;
  if tournament_row.tournament_structure is distinct from 'knockout_only' then
    raise exception 'Successor draw RPC is only available for knockout-only tournaments';
  end if;

  select m.round into source_round
  from public.matches m
  where m.tournament_id = p_tournament_id
    and m.stage = 'knockout'
    and coalesce(m.bracket, 'Cup') = 'Cup'
  order by public.knockout_round_rank(m.round) desc nulls last
  limit 1;

  if source_round is null then raise exception 'Generate the opening knockout round first'; end if;
  if source_round = 'Final' then raise exception 'The Final is already the last round'; end if;

  if exists (
    select 1
    from public.matches m
    where m.tournament_id = p_tournament_id
      and m.stage = 'knockout'
      and coalesce(m.bracket, 'Cup') = 'Cup'
      and m.round = source_round
      and not (
        (m.status in ('played', 'forfeit') and m.winner_entry_id is not null)
        or (
          m.status = 'forfeit' and m.home_score = 0 and m.away_score = 0
          and m.winner_entry_id is null and m.loser_entry_id is null
          and m.decided_by = 'double_forfeit'
        )
        or (
          m.status = 'voided' and m.home_entry_id is null and m.away_entry_id is null
          and m.decided_by = 'double_forfeit'
        )
      )
  ) then
    raise exception 'Finish every % tie before generating the next round', source_round;
  end if;

  if exists (
    select 1
    from public.manager_result_submissions s
    join public.matches m on m.id = s.match_id
    where m.tournament_id = p_tournament_id
      and m.stage = 'knockout'
      and coalesce(m.bracket, 'Cup') = 'Cup'
      and m.round = source_round
      and s.status in ('pending_confirmation', 'disputed', 'pending_admin_check', 'opponent_confirmed', 'appealed')
  ) then
    raise exception 'A % result is still awaiting confirmation, admin review or appeal resolution', source_round;
  end if;

  next_round := case source_round
    when 'R64' then 'R32'
    when 'R32' then 'R16'
    when 'R16' then 'QF'
    when 'QF' then 'SF'
    when 'SF' then 'Final'
    else null
  end;

  if next_round is null then raise exception 'Could not determine the next knockout round after %', source_round; end if;

  if exists (
    select 1 from public.matches m
    where m.tournament_id = p_tournament_id
      and m.stage = 'knockout'
      and coalesce(m.bracket, 'Cup') = 'Cup'
      and m.round = next_round
  ) then
    raise exception '% already exists', next_round;
  end if;

  select array_agg(m order by m.match_order), count(*)::integer
    into source_rows, source_count
  from public.matches m
  where m.tournament_id = p_tournament_id
    and m.stage = 'knockout'
    and coalesce(m.bracket, 'Cup') = 'Cup'
    and m.round = source_round;

  if source_count < 2 or source_count % 2 <> 0 then
    raise exception 'The % round produced an invalid number of bracket slots', source_round;
  end if;

  for index_value in 1..source_count by 2 loop
    home_id := source_rows[index_value].winner_entry_id;
    away_id := source_rows[index_value + 1].winner_entry_id;
    tie_count := tie_count + 1;

    if home_id is null and away_id is null then
      vacant_count := vacant_count + 1;
      insert into public.matches (
        tournament_id, stage, bracket, round, leg, match_order,
        home_entry_id, away_entry_id, home_placeholder, away_placeholder,
        status, decided_by
      ) values (
        p_tournament_id, 'knockout', 'Cup', next_round, 1, tie_count,
        null, null, 'NO QUALIFIER', 'NO QUALIFIER',
        'voided', 'double_forfeit'
      );
      continue;
    end if;

    if home_id is null or away_id is null then
      bye_count := bye_count + 1;
      home_id := coalesce(home_id, away_id);

      select te.seed, coalesce(tm.name, 'Unknown team')
        into home_seed_value, home_name
      from public.tournament_entries te
      left join public.teams tm on tm.id = te.team_id
      where te.id = home_id and te.tournament_id = p_tournament_id;

      if home_seed_value is null then
        raise exception 'Could not resolve the surviving entrant from %', source_round;
      end if;

      insert into public.matches (
        tournament_id, stage, bracket, round, leg, match_order,
        home_entry_id, away_entry_id, home_placeholder, away_placeholder,
        home_seed, away_seed, home_score, away_score,
        winner_entry_id, loser_entry_id, status, decided_by
      ) values (
        p_tournament_id, 'knockout', 'Cup', next_round, 1, tie_count,
        home_id, null, home_name, 'BYE',
        home_seed_value, null, 3, 0,
        home_id, null, 'played', 'bye'
      );
      continue;
    end if;

    select te.seed, coalesce(tm.name, 'Unknown team')
      into home_seed_value, home_name
    from public.tournament_entries te
    left join public.teams tm on tm.id = te.team_id
    where te.id = home_id and te.tournament_id = p_tournament_id;

    select te.seed, coalesce(tm.name, 'Unknown team')
      into away_seed_value, away_name
    from public.tournament_entries te
    left join public.teams tm on tm.id = te.team_id
    where te.id = away_id and te.tournament_id = p_tournament_id;

    if home_seed_value is null or away_seed_value is null then
      raise exception 'Could not resolve every winning entrant from %', source_round;
    end if;

    insert into public.matches (
      tournament_id, stage, bracket, round, leg, match_order,
      home_entry_id, away_entry_id, home_placeholder, away_placeholder,
      home_seed, away_seed, status
    ) values (
      p_tournament_id, 'knockout', 'Cup', next_round, 1, tie_count,
      home_id, away_id, home_name, away_name,
      home_seed_value, away_seed_value, 'scheduled'
    );
  end loop;

  return jsonb_build_object(
    'source_round', source_round,
    'round', next_round,
    'ties', tie_count,
    'byes', bye_count,
    'vacant_slots', vacant_count
  );
end;
$$;

revoke all on function public.generate_knockout_successor_round_atomic(bigint) from public;
grant execute on function public.generate_knockout_successor_round_atomic(bigint) to authenticated;

-- Internal vacancy markers are useful to organisers for deterministic bracket
-- propagation, but they must never appear as public fixtures or upcoming matches.
drop policy if exists "Anonymous read public matches" on public.matches;
create policy "Anonymous read public matches"
  on public.matches for select to anon
  using (
    status <> 'voided'
    and (select public.tournament_is_public(tournament_id))
  );

drop policy if exists "Authenticated read public matches and assigned staff" on public.matches;
create policy "Authenticated read public matches and assigned staff"
  on public.matches for select to authenticated
  using (
    ((status <> 'voided') and (select public.tournament_is_public(tournament_id)))
    or (select public.can_assist_tournament(tournament_id))
  );
