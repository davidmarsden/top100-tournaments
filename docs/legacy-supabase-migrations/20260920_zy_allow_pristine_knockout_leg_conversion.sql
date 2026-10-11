-- Allow an organiser to switch an already-generated opening draw between one
-- and two legs only while the draw is pristine: one round, no real results.
-- This is primarily for tournaments whose draw was created before the leg-format
-- setting existed.

create or replace function public.guard_knockout_leg_count_after_draw()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.knockout_leg_format_change', true) = 'on' then
    return new;
  end if;

  if new.knockout_leg_count is distinct from old.knockout_leg_count
     and exists (
       select 1 from public.matches m
       where m.tournament_id = old.id
         and m.stage = 'knockout'
     ) then
    raise exception 'Knockout leg format cannot change after the draw has been generated; use the controlled format change while the opening draw is still pristine';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_knockout_leg_count_after_draw() from public, anon, authenticated;
grant execute on function public.guard_knockout_leg_count_after_draw() to service_role;

create or replace function public.set_knockout_leg_count_atomic(
  p_tournament_id bigint,
  p_leg_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  round_count integer;
  real_fixture_count integer;
  added_count integer := 0;
  removed_count integer := 0;
begin
  if p_leg_count not in (1, 2) then
    raise exception 'Knockout ties must use one leg or two legs';
  end if;

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
    raise exception 'Leg format is only configurable here for knockout-only tournaments';
  end if;

  if tournament_row.knockout_leg_count = p_leg_count then
    return jsonb_build_object(
      'legs', p_leg_count,
      'added_fixtures', 0,
      'removed_fixtures', 0,
      'converted_existing_draw', false
    );
  end if;

  if not exists (
    select 1 from public.matches m
    where m.tournament_id = p_tournament_id and m.stage = 'knockout'
  ) then
    perform set_config('app.knockout_leg_format_change', 'on', true);
    update public.tournaments
    set knockout_leg_count = p_leg_count
    where id = p_tournament_id;

    return jsonb_build_object(
      'legs', p_leg_count,
      'added_fixtures', 0,
      'removed_fixtures', 0,
      'converted_existing_draw', false
    );
  end if;

  select count(distinct m.round)::integer
    into round_count
  from public.matches m
  where m.tournament_id = p_tournament_id
    and m.stage = 'knockout'
    and coalesce(m.bracket, 'Cup') = 'Cup';

  if round_count <> 1 then
    raise exception 'Leg format cannot change after a successor knockout round has been generated';
  end if;

  -- BYEs/void vacancy markers are structural and may already be resolved.
  -- Every real fixture must still be completely untouched.
  if exists (
    select 1
    from public.matches m
    where m.tournament_id = p_tournament_id
      and m.stage = 'knockout'
      and coalesce(m.bracket, 'Cup') = 'Cup'
      and m.away_entry_id is not null
      and (
        m.status <> 'scheduled'
        or m.home_score is not null
        or m.away_score is not null
        or m.winner_entry_id is not null
        or m.loser_entry_id is not null
        or m.decided_by is not null
        or m.played_at is not null
      )
  ) then
    raise exception 'Leg format is locked after a real knockout result or ruling has been recorded';
  end if;

  select count(*)::integer
    into real_fixture_count
  from public.matches m
  where m.tournament_id = p_tournament_id
    and m.stage = 'knockout'
    and coalesce(m.bracket, 'Cup') = 'Cup'
    and m.away_entry_id is not null;

  perform set_config('app.knockout_leg_format_change', 'on', true);

  if p_leg_count = 2 then
    if exists (
      select 1 from public.matches m
      where m.tournament_id = p_tournament_id
        and m.stage = 'knockout'
        and coalesce(m.bracket, 'Cup') = 'Cup'
        and m.leg = 2
    ) then
      raise exception 'The opening draw already contains second legs';
    end if;

    insert into public.matches (
      tournament_id, stage, bracket, round, leg, match_order,
      home_entry_id, away_entry_id, home_placeholder, away_placeholder,
      home_seed, away_seed, status, fixture_date
    )
    select
      m.tournament_id, m.stage, m.bracket, m.round, 2, m.match_order,
      m.away_entry_id, m.home_entry_id, m.away_placeholder, m.home_placeholder,
      m.away_seed, m.home_seed, 'scheduled',
      case when m.fixture_date is not null then m.fixture_date + 7 else null end
    from public.matches m
    where m.tournament_id = p_tournament_id
      and m.stage = 'knockout'
      and coalesce(m.bracket, 'Cup') = 'Cup'
      and m.leg = 1
      and m.away_entry_id is not null;
    get diagnostics added_count = row_count;

    if added_count <> real_fixture_count then
      raise exception 'Could not create every second leg safely';
    end if;
  else
    perform set_config('app.knockout_controlled_delete', 'on', true);
    delete from public.matches m
    where m.tournament_id = p_tournament_id
      and m.stage = 'knockout'
      and coalesce(m.bracket, 'Cup') = 'Cup'
      and m.leg = 2;
    get diagnostics removed_count = row_count;
  end if;

  update public.tournaments
  set knockout_leg_count = p_leg_count
  where id = p_tournament_id;

  return jsonb_build_object(
    'legs', p_leg_count,
    'added_fixtures', added_count,
    'removed_fixtures', removed_count,
    'converted_existing_draw', true
  );
end;
$$;

revoke all on function public.set_knockout_leg_count_atomic(bigint, integer) from public, anon;
grant execute on function public.set_knockout_leg_count_atomic(bigint, integer) to authenticated, service_role;
