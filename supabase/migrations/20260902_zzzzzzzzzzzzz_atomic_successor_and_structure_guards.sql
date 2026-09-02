-- Final concurrency/structure hardening for knockout-only tournaments.
-- Successor rounds are generated from a fresh locked predecessor snapshot,
-- knockout-only match mutations share that lock, and tournament structure is
-- immutable once either group or match structure exists.

create or replace function public.guard_knockout_match_mutation_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_tournament_id bigint;
  target_tournament_id bigint;
begin
  source_tournament_id := case when tg_op in ('UPDATE', 'DELETE') then old.tournament_id else null end;
  target_tournament_id := case when tg_op in ('INSERT', 'UPDATE') then new.tournament_id else null end;

  if source_tournament_id is not null
     and public.is_knockout_only_tournament(source_tournament_id) then
    perform pg_advisory_xact_lock(public.knockout_roster_lock_key(source_tournament_id));
  end if;

  if target_tournament_id is not null
     and target_tournament_id is distinct from source_tournament_id
     and public.is_knockout_only_tournament(target_tournament_id) then
    perform pg_advisory_xact_lock(public.knockout_roster_lock_key(target_tournament_id));
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_knockout_match_mutation_lock_trigger on public.matches;
create trigger guard_knockout_match_mutation_lock_trigger
before insert or update or delete on public.matches
for each row execute function public.guard_knockout_match_mutation_lock();

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
  winner_ids bigint[];
  winner_count integer;
  index_value integer;
  home_id bigint;
  away_id bigint;
  home_seed_value integer;
  away_seed_value integer;
  home_name text;
  away_name text;
  tie_count integer := 0;
begin
  if not public.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have organiser access to this tournament';
  end if;

  perform pg_advisory_xact_lock(public.knockout_roster_lock_key(p_tournament_id));

  select * into tournament_row
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament not found';
  end if;
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

  if source_round is null then
    raise exception 'Generate the opening knockout round first';
  end if;
  if source_round = 'Final' then
    raise exception 'The Final is already the last round';
  end if;

  if exists (
    select 1
    from public.matches m
    where m.tournament_id = p_tournament_id
      and m.stage = 'knockout'
      and coalesce(m.bracket, 'Cup') = 'Cup'
      and m.round = source_round
      and (m.status not in ('played', 'forfeit') or m.winner_entry_id is null)
  ) then
    raise exception 'Finish every % tie with a resolved winner before generating the next round', source_round;
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

  if next_round is null then
    raise exception 'Could not determine the next knockout round after %', source_round;
  end if;

  if exists (
    select 1 from public.matches m
    where m.tournament_id = p_tournament_id
      and m.stage = 'knockout'
      and coalesce(m.bracket, 'Cup') = 'Cup'
      and m.round = next_round
  ) then
    raise exception '% already exists', next_round;
  end if;

  select array_agg(m.winner_entry_id order by m.match_order), count(*)::integer
  into winner_ids, winner_count
  from public.matches m
  where m.tournament_id = p_tournament_id
    and m.stage = 'knockout'
    and coalesce(m.bracket, 'Cup') = 'Cup'
    and m.round = source_round;

  if winner_count < 2 or winner_count % 2 <> 0 then
    raise exception 'The % round produced an invalid number of winners', source_round;
  end if;

  for index_value in 1..winner_count by 2 loop
    home_id := winner_ids[index_value];
    away_id := winner_ids[index_value + 1];

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

    tie_count := tie_count + 1;
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
    'ties', tie_count
  );
end;
$$;

revoke all on function public.generate_knockout_successor_round_atomic(bigint) from public;
grant execute on function public.generate_knockout_successor_round_atomic(bigint) to authenticated;

create or replace function public.guard_knockout_tournament_format_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tournament_structure is distinct from old.tournament_structure
     and (
       exists (select 1 from public.groups g where g.tournament_id = old.id)
       or exists (select 1 from public.matches m where m.tournament_id = old.id)
     ) then
    raise exception 'Tournament structure cannot change after groups or fixtures have been generated';
  end if;

  if old.tournament_structure = 'knockout_only'
     and exists (
       select 1 from public.matches m
       where m.tournament_id = old.id and m.stage = 'knockout'
     )
     and (
       new.max_entries is distinct from old.max_entries
       or new.knockout_teams is distinct from old.knockout_teams
     ) then
    raise exception 'Knockout field size cannot change after the draw has been generated';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_knockout_tournament_format_update() from public, anon, authenticated;
grant execute on function public.guard_knockout_tournament_format_update() to service_role;
