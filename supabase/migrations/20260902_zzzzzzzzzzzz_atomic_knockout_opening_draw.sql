-- Serialize knockout-only roster mutations with opening-draw generation.
-- The opening draw is generated in one transaction while holding the same
-- tournament-scoped advisory lock used by entrant roster writes.

create or replace function public.knockout_roster_lock_key(p_tournament_id bigint)
returns bigint
language sql
immutable
security invoker
as $$
  select hashtextextended('knockout-roster:' || p_tournament_id::text, 0);
$$;

create or replace function public.guard_knockout_only_entry_roster()
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

  -- Use the same transaction-scoped lock as opening-draw generation. When a
  -- row moves between tournaments, acquire locks in id order to avoid a
  -- cross-tournament deadlock.
  if source_tournament_id is not null and target_tournament_id is not null
     and source_tournament_id is distinct from target_tournament_id then
    if source_tournament_id < target_tournament_id then
      perform pg_advisory_xact_lock(public.knockout_roster_lock_key(source_tournament_id));
      perform pg_advisory_xact_lock(public.knockout_roster_lock_key(target_tournament_id));
    else
      perform pg_advisory_xact_lock(public.knockout_roster_lock_key(target_tournament_id));
      perform pg_advisory_xact_lock(public.knockout_roster_lock_key(source_tournament_id));
    end if;
  else
    perform pg_advisory_xact_lock(public.knockout_roster_lock_key(coalesce(source_tournament_id, target_tournament_id)));
  end if;

  if tg_op = 'INSERT' then
    if public.knockout_only_roster_is_locked(new.tournament_id) then
      raise exception 'Knockout entrant roster is locked after the draw has been generated';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if public.knockout_only_roster_is_locked(old.tournament_id) then
      raise exception 'Knockout entrant roster is locked after the draw has been generated';
    end if;
    return old;
  end if;

  if new.tournament_id is distinct from old.tournament_id then
    if public.knockout_only_roster_is_locked(old.tournament_id)
       or public.knockout_only_roster_is_locked(new.tournament_id) then
      raise exception 'Knockout entrant roster is locked after the draw has been generated';
    end if;
  elsif public.knockout_only_roster_is_locked(old.tournament_id)
        and (
          new.team_id is distinct from old.team_id
          or new.manager_id is distinct from old.manager_id
          or new.seed is distinct from old.seed
        ) then
    raise exception 'Knockout entrant identity and seed are locked after the draw has been generated';
  end if;

  return new;
end;
$$;

create or replace function public.knockout_seed_order(p_size integer)
returns integer[]
language plpgsql
immutable
security invoker
as $$
declare
  previous_order integer[];
  result_order integer[] := '{}';
  seed_value integer;
begin
  if p_size = 2 then
    return array[1, 2];
  end if;
  if p_size < 2 or p_size > 64 or (p_size & (p_size - 1)) <> 0 then
    raise exception 'Knockout bracket size must be a power of two from 2 to 64';
  end if;

  previous_order := public.knockout_seed_order(p_size / 2);
  foreach seed_value in array previous_order loop
    result_order := result_order || seed_value || (p_size + 1 - seed_value);
  end loop;
  return result_order;
end;
$$;

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
  match_count integer := 0;
  bye_count integer := 0;
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

  -- Normalization now happens while the roster lock is held, so no entrant can
  -- be added or removed between the seed snapshot and match insertion.
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

    if home_entry is null and away_entry is null then
      continue;
    end if;

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
    match_count := match_count + 1;
    if is_bye then
      bye_count := bye_count + 1;
    end if;

    insert into public.matches (
      tournament_id, stage, bracket, round, leg, match_order,
      home_entry_id, away_entry_id, home_placeholder, away_placeholder,
      home_seed, away_seed, home_score, away_score,
      winner_entry_id, loser_entry_id, status, decided_by
    ) values (
      p_tournament_id, 'knockout', 'Cup', opening_round, 1, match_count,
      home_entry, away_entry, home_name, case when is_bye then 'BYE' else away_name end,
      home_seed_value, case when is_bye then null else away_seed_value end,
      case when is_bye then 3 else null end,
      case when is_bye then 0 else null end,
      case when is_bye then home_entry else null end,
      null,
      case when is_bye then 'played' else 'scheduled' end,
      case when is_bye then 'bye' else null end
    );
  end loop;

  return jsonb_build_object(
    'round', opening_round,
    'ties', match_count,
    'byes', bye_count,
    'entrants', entrant_count
  );
end;
$$;

revoke all on function public.generate_knockout_opening_round_atomic(bigint) from public;
grant execute on function public.generate_knockout_opening_round_atomic(bigint) to authenticated;
