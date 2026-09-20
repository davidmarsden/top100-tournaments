-- Add configurable one-leg / two-leg knockout-only ties.
-- Existing tournaments remain one-leg by default. The leg format is structural and
-- becomes immutable once a knockout draw exists.

alter table public.tournaments
  add column if not exists knockout_leg_count smallint not null default 1;

alter table public.tournaments
  drop constraint if exists tournaments_knockout_leg_count_check;
alter table public.tournaments
  add constraint tournaments_knockout_leg_count_check
  check (knockout_leg_count in (1, 2));

create or replace function public.guard_knockout_leg_count_after_draw()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.knockout_leg_count is distinct from old.knockout_leg_count
     and exists (
       select 1 from public.matches m
       where m.tournament_id = old.id
         and m.stage = 'knockout'
     ) then
    raise exception 'Knockout leg format cannot change after the draw has been generated';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_knockout_leg_count_after_draw() from public, anon, authenticated;
grant execute on function public.guard_knockout_leg_count_after_draw() to service_role;

drop trigger if exists guard_knockout_leg_count_after_draw on public.tournaments;
create trigger guard_knockout_leg_count_after_draw
before update of knockout_leg_count on public.tournaments
for each row execute function public.guard_knockout_leg_count_after_draw();

-- Knockout-only result invariants now understand two-leg ties. Leg 1 records only
-- the fixture result; leg 2 stores the resolved tie winner after aggregate,
-- away goals, or FET.
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
  first_leg public.matches%rowtype;
  first_id bigint;
  second_id bigint;
  first_agg integer;
  second_agg integer;
  first_away integer;
  second_away integer;
  expected_winner bigint;
  expected_loser bigint;
  first_home integer;
  first_away_score integer;
  second_home integer;
  second_away_score integer;
  home_fet integer;
  away_fet integer;
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
        select m.* into first_leg
        from public.matches m
        where m.tournament_id = new.tournament_id
          and m.stage = 'knockout'
          and coalesce(m.bracket, 'Cup') = coalesce(new.bracket, 'Cup')
          and m.round = new.round
          and m.match_order = new.match_order
          and m.leg = 1
          and m.id <> new.id
        limit 1;

        if not found
           or first_leg.status not in ('played', 'forfeit')
           or first_leg.home_score is null
           or first_leg.away_score is null then
          raise exception 'Complete the first leg before recording the second leg';
        end if;

        first_id := first_leg.home_entry_id;
        second_id := first_leg.away_entry_id;
        first_home := coalesce(first_leg.home_normal_time_score, first_leg.home_score);
        first_away_score := coalesce(first_leg.away_normal_time_score, first_leg.away_score);
        second_home := coalesce(new.home_normal_time_score, new.home_score);
        second_away_score := coalesce(new.away_normal_time_score, new.away_score);

        first_agg := first_home;
        second_agg := first_away_score;
        first_away := 0;
        second_away := first_away_score;

        if new.home_entry_id = first_id then
          first_agg := first_agg + second_home;
          second_agg := second_agg + second_away_score;
          second_away := second_away + second_away_score;
        elsif new.away_entry_id = first_id then
          first_agg := first_agg + second_away_score;
          second_agg := second_agg + second_home;
          first_away := first_away + second_away_score;
        else
          raise exception 'Second-leg entrants do not match the first leg';
        end if;

        expected_winner := null;
        expected_loser := null;
        if first_agg > second_agg then
          expected_winner := first_id;
          expected_loser := second_id;
        elsif second_agg > first_agg then
          expected_winner := second_id;
          expected_loser := first_id;
        elsif first_away > second_away then
          expected_winner := first_id;
          expected_loser := second_id;
        elsif second_away > first_away then
          expected_winner := second_id;
          expected_loser := first_id;
        else
          if new.decided_by not in ('fictional_extra_time', 'manual') then
            raise exception 'A level two-leg tie requires Fictional Extra Time or a manual FET decider';
          end if;
          home_fet := coalesce(new.home_extra_time_score, 0);
          away_fet := coalesce(new.away_extra_time_score, 0);
          if home_fet = away_fet then
            raise exception 'FET must resolve the level two-leg tie';
          end if;
          expected_winner := case when home_fet > away_fet then new.home_entry_id else new.away_entry_id end;
          expected_loser := case when home_fet > away_fet then new.away_entry_id else new.home_entry_id end;
        end if;

        if new.winner_entry_id is distinct from expected_winner
           or new.loser_entry_id is distinct from expected_loser then
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
     and old.stage = 'knockout'
     and public.is_knockout_only_tournament(old.tournament_id) then
    result_changed :=
      new.home_score is distinct from old.home_score
      or new.away_score is distinct from old.away_score
      or new.winner_entry_id is distinct from old.winner_entry_id
      or new.loser_entry_id is distinct from old.loser_entry_id
      or new.status is distinct from old.status
      or new.decided_by is distinct from old.decided_by
      or new.played_at is distinct from old.played_at;

    if result_changed then
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
  end if;

  return new;
end;
$$;

revoke all on function public.guard_knockout_round_dependency() from public, anon, authenticated;
grant execute on function public.guard_knockout_round_dependency() to service_role;

create or replace function public.generate_knockout_opening_round_atomic(p_tournament_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  entrant_count integer;
  bracket_size integer := 2;
  opening_round text;
  seed_order_values integer[];
  entrant_ids bigint[];
  entrant_names text[];
  slot_index integer;
  home_seed_value integer;
  away_seed_value integer;
  home_entry bigint;
  away_entry bigint;
  home_name text;
  away_name text;
  temporary_seed integer;
  temporary_entry bigint;
  temporary_name text;
  is_bye boolean;
  tie_count integer := 0;
  bye_count integer := 0;
  fixture_count integer := 0;
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
    raise exception 'Opening knockout draw RPC is only available for knockout-only tournaments';
  end if;
  if tournament_row.knockout_teams is null or tournament_row.knockout_teams < 2 or tournament_row.knockout_teams > 64 then
    raise exception 'Set a knockout field from 2 to 64 entrants before generating the draw';
  end if;
  if exists (
    select 1 from public.matches
    where tournament_id = p_tournament_id and stage = 'knockout'
  ) then
    raise exception 'The knockout draw already exists';
  end if;

  select count(*)::integer into entrant_count
  from public.tournament_entries
  where tournament_id = p_tournament_id;

  if entrant_count <> tournament_row.knockout_teams then
    raise exception 'The format expects % entrants but % are currently saved', tournament_row.knockout_teams, entrant_count;
  end if;

  perform public.normalize_knockout_entry_seeds(p_tournament_id);

  select
    array_agg(te.id order by te.seed),
    array_agg(coalesce(tm.name, 'Unknown team') order by te.seed)
  into entrant_ids, entrant_names
  from public.tournament_entries te
  left join public.teams tm on tm.id = te.team_id
  where te.tournament_id = p_tournament_id;

  while bracket_size < entrant_count loop
    bracket_size := bracket_size * 2;
  end loop;

  opening_round := case bracket_size
    when 64 then 'R64'
    when 32 then 'R32'
    when 16 then 'R16'
    when 8 then 'QF'
    when 4 then 'SF'
    when 2 then 'Final'
  end;
  seed_order_values := public.knockout_seed_order(bracket_size);

  for slot_index in 1..array_length(seed_order_values, 1) by 2 loop
    home_seed_value := seed_order_values[slot_index];
    away_seed_value := seed_order_values[slot_index + 1];

    home_entry := case when home_seed_value <= entrant_count then entrant_ids[home_seed_value] else null end;
    away_entry := case when away_seed_value <= entrant_count then entrant_ids[away_seed_value] else null end;
    home_name := case when home_seed_value <= entrant_count then entrant_names[home_seed_value] else 'BYE' end;
    away_name := case when away_seed_value <= entrant_count then entrant_names[away_seed_value] else 'BYE' end;

    if home_entry is null and away_entry is null then continue; end if;

    if home_entry is null then
      temporary_seed := home_seed_value;
      home_seed_value := away_seed_value;
      away_seed_value := temporary_seed;
      temporary_entry := home_entry;
      home_entry := away_entry;
      away_entry := temporary_entry;
      temporary_name := home_name;
      home_name := away_name;
      away_name := temporary_name;
    end if;

    is_bye := away_entry is null;
    tie_count := tie_count + 1;

    if is_bye then
      bye_count := bye_count + 1;
      fixture_count := fixture_count + 1;
      insert into public.matches (
        tournament_id, stage, bracket, round, leg, match_order,
        home_entry_id, away_entry_id, home_placeholder, away_placeholder,
        home_seed, away_seed, home_score, away_score,
        winner_entry_id, loser_entry_id, status, decided_by
      ) values (
        p_tournament_id, 'knockout', 'Cup', opening_round, 1, tie_count,
        home_entry, null, home_name, 'BYE',
        home_seed_value, null, 3, 0,
        home_entry, null, 'played', 'bye'
      );
    else
      fixture_count := fixture_count + 1;
      insert into public.matches (
        tournament_id, stage, bracket, round, leg, match_order,
        home_entry_id, away_entry_id, home_placeholder, away_placeholder,
        home_seed, away_seed, status
      ) values (
        p_tournament_id, 'knockout', 'Cup', opening_round, 1, tie_count,
        home_entry, away_entry, home_name, away_name,
        home_seed_value, away_seed_value, 'scheduled'
      );

      if tournament_row.knockout_leg_count = 2 then
        fixture_count := fixture_count + 1;
        insert into public.matches (
          tournament_id, stage, bracket, round, leg, match_order,
          home_entry_id, away_entry_id, home_placeholder, away_placeholder,
          home_seed, away_seed, status
        ) values (
          p_tournament_id, 'knockout', 'Cup', opening_round, 2, tie_count,
          away_entry, home_entry, away_name, home_name,
          away_seed_value, home_seed_value, 'scheduled'
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'round', opening_round,
    'ties', tie_count,
    'fixtures', fixture_count,
    'byes', bye_count,
    'entrants', entrant_count,
    'legs', tournament_row.knockout_leg_count
  );
end;
$$;

revoke all on function public.generate_knockout_opening_round_atomic(bigint) from public, anon;
grant execute on function public.generate_knockout_opening_round_atomic(bigint) to authenticated, service_role;

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
  fixture_count integer := 0;
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
          tournament_row.knockout_leg_count = 2
          and m.leg = 1
          and m.away_entry_id is not null
          and m.status in ('played', 'forfeit')
          and m.home_score is not null and m.away_score is not null
          and m.winner_entry_id is null and m.loser_entry_id is null
        )
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

  select array_agg(decider order by decider.match_order), count(*)::integer
    into source_rows, source_count
  from (
    select distinct on (m.match_order) m.*
    from public.matches m
    where m.tournament_id = p_tournament_id
      and m.stage = 'knockout'
      and coalesce(m.bracket, 'Cup') = 'Cup'
      and m.round = source_round
    order by m.match_order, m.leg desc
  ) decider;

  if source_count < 2 or source_count % 2 <> 0 then
    raise exception 'The % round produced an invalid number of bracket slots', source_round;
  end if;

  for index_value in 1..source_count by 2 loop
    home_id := source_rows[index_value].winner_entry_id;
    away_id := source_rows[index_value + 1].winner_entry_id;
    tie_count := tie_count + 1;

    if home_id is null and away_id is null then
      vacant_count := vacant_count + 1;
      fixture_count := fixture_count + 1;
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

      fixture_count := fixture_count + 1;
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

    fixture_count := fixture_count + 1;
    insert into public.matches (
      tournament_id, stage, bracket, round, leg, match_order,
      home_entry_id, away_entry_id, home_placeholder, away_placeholder,
      home_seed, away_seed, status
    ) values (
      p_tournament_id, 'knockout', 'Cup', next_round, 1, tie_count,
      home_id, away_id, home_name, away_name,
      home_seed_value, away_seed_value, 'scheduled'
    );

    if tournament_row.knockout_leg_count = 2 then
      fixture_count := fixture_count + 1;
      insert into public.matches (
        tournament_id, stage, bracket, round, leg, match_order,
        home_entry_id, away_entry_id, home_placeholder, away_placeholder,
        home_seed, away_seed, status
      ) values (
        p_tournament_id, 'knockout', 'Cup', next_round, 2, tie_count,
        away_id, home_id, away_name, home_name,
        away_seed_value, home_seed_value, 'scheduled'
      );
    end if;
  end loop;

  return jsonb_build_object(
    'source_round', source_round,
    'round', next_round,
    'ties', tie_count,
    'fixtures', fixture_count,
    'byes', bye_count,
    'vacant_slots', vacant_count,
    'legs', tournament_row.knockout_leg_count
  );
end;
$$;

revoke all on function public.generate_knockout_successor_round_atomic(bigint) from public, anon;
grant execute on function public.generate_knockout_successor_round_atomic(bigint) to authenticated, service_role;

-- Completion requires every Final leg to be complete and one authoritative tie
-- winner to exist. This works for both one-leg and two-leg Finals.
create or replace function public.guard_knockout_only_tournament_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  final_ready boolean;
  final_under_review boolean;
begin
  if new.status not in ('completed', 'archived')
     or new.status is not distinct from old.status
     or new.tournament_structure <> 'knockout_only' then
    return new;
  end if;

  perform pg_advisory_xact_lock(public.knockout_roster_lock_key(new.id));

  select
    exists (
      select 1 from public.matches m
      where m.tournament_id = new.id and m.stage = 'knockout' and m.round = 'Final'
    )
    and not exists (
      select 1 from public.matches m
      where m.tournament_id = new.id and m.stage = 'knockout' and m.round = 'Final'
        and m.status not in ('played', 'forfeit')
    )
    and exists (
      select 1 from public.matches m
      where m.tournament_id = new.id and m.stage = 'knockout' and m.round = 'Final'
        and m.winner_entry_id is not null
    )
  into final_ready;

  if not final_ready then
    raise exception 'Knockout-only tournaments cannot be completed before every Final leg has finished and the tie has a resolved winner';
  end if;

  select exists (
    select 1
    from public.manager_result_submissions s
    join public.matches m on m.id = s.match_id
    where m.tournament_id = new.id
      and m.stage = 'knockout'
      and m.round = 'Final'
      and s.status in ('pending_confirmation','disputed','pending_admin_check','opponent_confirmed','appealed')
  ) into final_under_review;

  if final_under_review then
    raise exception 'Knockout-only tournaments cannot be completed while the Final result is still under review';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_knockout_only_tournament_completion() from public, anon, authenticated;
grant execute on function public.guard_knockout_only_tournament_completion() to service_role;

create or replace function public.public_knockout_final_resolved(target_tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tournaments t
    where t.id = target_tournament_id
      and t.tournament_structure = 'knockout_only'
      and public.tournament_shell_is_public(t.id)
      and exists (
        select 1 from public.matches m
        where m.tournament_id = t.id and m.stage = 'knockout' and m.round = 'Final'
      )
      and not exists (
        select 1 from public.matches m
        where m.tournament_id = t.id and m.stage = 'knockout' and m.round = 'Final'
          and m.status not in ('played', 'forfeit')
      )
      and exists (
        select 1 from public.matches m
        where m.tournament_id = t.id and m.stage = 'knockout' and m.round = 'Final'
          and m.winner_entry_id is not null
      )
      and not exists (
        select 1
        from public.manager_result_submissions s
        join public.matches m on m.id = s.match_id
        where m.tournament_id = t.id
          and m.stage = 'knockout'
          and m.round = 'Final'
          and s.status in ('pending_confirmation','disputed','pending_admin_check','opponent_confirmed','appealed')
      )
  );
$$;

revoke all on function public.public_knockout_final_resolved(bigint) from public;
grant execute on function public.public_knockout_final_resolved(bigint) to anon, authenticated, service_role;

create or replace function public.reopen_knockout_only_tournament_if_final_invalid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_id_value bigint;
  tournament_status text;
  knockout_only boolean;
  final_ready boolean;
  final_under_review boolean;
begin
  if tg_op = 'DELETE' then tournament_id_value := old.tournament_id;
  else tournament_id_value := new.tournament_id;
  end if;

  if not (
    (tg_op = 'DELETE' and old.stage = 'knockout' and old.round = 'Final')
    or
    (tg_op = 'UPDATE' and (
      (old.stage = 'knockout' and old.round = 'Final')
      or (new.stage = 'knockout' and new.round = 'Final')
    ))
  ) then
    return null;
  end if;

  select t.status, t.tournament_structure = 'knockout_only'
    into tournament_status, knockout_only
  from public.tournaments t
  where t.id = tournament_id_value;

  if not coalesce(knockout_only, false)
     or tournament_status not in ('completed', 'archived') then
    return null;
  end if;

  select
    exists (
      select 1 from public.matches m
      where m.tournament_id = tournament_id_value and m.stage = 'knockout' and m.round = 'Final'
    )
    and not exists (
      select 1 from public.matches m
      where m.tournament_id = tournament_id_value and m.stage = 'knockout' and m.round = 'Final'
        and m.status not in ('played', 'forfeit')
    )
    and exists (
      select 1 from public.matches m
      where m.tournament_id = tournament_id_value and m.stage = 'knockout' and m.round = 'Final'
        and m.winner_entry_id is not null
    )
  into final_ready;

  select exists (
    select 1
    from public.manager_result_submissions s
    join public.matches m on m.id = s.match_id
    where m.tournament_id = tournament_id_value
      and m.stage = 'knockout'
      and m.round = 'Final'
      and s.status in ('pending_confirmation','disputed','pending_admin_check','opponent_confirmed','appealed')
  ) into final_under_review;

  if not final_ready or final_under_review then
    update public.tournaments
    set status = 'published',
        archived_at = null
    where id = tournament_id_value
      and status in ('completed', 'archived');
  end if;

  return null;
end;
$$;

revoke all on function public.reopen_knockout_only_tournament_if_final_invalid() from public, anon, authenticated;
grant execute on function public.reopen_knockout_only_tournament_if_final_invalid() to service_role;
