-- League-phase tournaments beyond the World Club Cup: the Youth Cup.
--
--   * league_matchday_weekday: 3 (Wednesday, the World Club Cup) or 6 (Saturday,
--     the Youth Cup). The draw's first matchday must fall on it.
--   * league_single_leg_rounds: knockout rounds played as one match, higher-placed
--     club at home (Youth Cup: play-off, Shield last 32, last 16); the rest are two legs.
--   * The draw may have seven matchdays: an odd field (59) is drawn with a rest
--     week, so each club plays six matches and rests once. The save checks every
--     club has the same number of matches (six), half at home, at most one a
--     matchday, and no repeated pairing, rather than one match per matchday.
--   * set_league_pots_by_rating: pots from the registered ratings (no Divisions in
--     the Youth Cup): highest rated in pot 1, pots of ceil(clubs / pots); with 59
--     clubs and 5 pots that is 12, 12, 12, 12, 11.

alter table public.tournaments add column if not exists league_matchday_weekday smallint not null default 3;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_league_matchday_weekday_check') then
    alter table public.tournaments add constraint tournaments_league_matchday_weekday_check check (league_matchday_weekday in (3, 6));
  end if;
end;
$$;
alter table public.tournaments add column if not exists league_single_leg_rounds text[] not null default '{}';

create or replace function public.save_league_phase_draw(target_tournament_id bigint, draw_seed text, first_matchday date, fixtures jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t record;
  entry_count integer;
  fixture_count integer;
  games integer;
  bad text;
  saved integer;
begin
  if not public.can_manage_tournament(target_tournament_id) then
    raise exception 'Only tournament organisers can save the draw.';
  end if;
  select * into t from public.tournaments where id = target_tournament_id for update;
  if t.id is null then raise exception 'Tournament % not found.', target_tournament_id; end if;
  if t.tournament_structure <> 'league_knockout' then raise exception 'This tournament is not a league-phase tournament.'; end if;
  if coalesce(trim(draw_seed), '') = '' then raise exception 'A draw seed is required.'; end if;
  if first_matchday is null or extract(isodow from first_matchday) <> coalesce(t.league_matchday_weekday, 3) then
    raise exception 'The first matchday must be a %.', case coalesce(t.league_matchday_weekday, 3) when 6 then 'Saturday' else 'Wednesday' end;
  end if;
  if exists (
    select 1 from public.matches m
    where m.tournament_id = target_tournament_id and m.stage = 'league' and (m.status <> 'scheduled' or m.home_score is not null)
  ) then
    raise exception 'League results have been entered; the draw can no longer be replaced.';
  end if;

  drop table if exists pg_temp.draw_rows;
  create temporary table draw_rows on commit drop as
  select (f->>'matchday')::int matchday, (f->>'home_entry_id')::bigint home_id, (f->>'away_entry_id')::bigint away_id,
         row_number() over () ord
  from jsonb_array_elements(fixtures) f;

  select count(*) into entry_count from public.tournament_entries where tournament_id = target_tournament_id;
  if entry_count < 2 then raise exception 'Enter the clubs before the draw.'; end if;
  select count(*) into fixture_count from draw_rows;
  -- Every club plays the same number of matches: six with 5 pots, whether over 6 or 7 matchdays.
  if (fixture_count * 2) % entry_count <> 0 then raise exception 'The draw does not give every club the same number of matches.'; end if;
  games := (fixture_count * 2) / entry_count;
  if games % 2 <> 0 then raise exception 'Every club needs an even number of matches (half at home).'; end if;
  if exists (select 1 from draw_rows where matchday < 1 or matchday > games + 1) then
    raise exception 'Matchdays must run from 1 to %.', games + 1;
  end if;

  select string_agg(problem, '; ') into bad from (
    select 'unknown entrant ' || x.id problem
      from (select home_id id from draw_rows union select away_id from draw_rows) x
     where not exists (select 1 from public.tournament_entries e where e.id = x.id and e.tournament_id = target_tournament_id)
    union all
    select 'entrant ' || e.id || ' has ' || count(d.*) || ' matches'
      from public.tournament_entries e
      left join draw_rows d on d.home_id = e.id or d.away_id = e.id
     where e.tournament_id = target_tournament_id
     group by e.id having count(d.*) <> games
    union all
    select 'entrant ' || e.id || ' has ' || count(d.*) || ' home matches'
      from public.tournament_entries e
      left join draw_rows d on d.home_id = e.id
     where e.tournament_id = target_tournament_id
     group by e.id having count(d.*) * 2 <> games
    union all
    select 'entrant ' || c.id || ' plays twice on matchday ' || c.matchday
      from (select home_id id, matchday from draw_rows union all select away_id, matchday from draw_rows) c
     group by c.id, c.matchday having count(*) > 1
    union all
    select 'a pairing repeats: ' || least(home_id, away_id) || ' v ' || greatest(home_id, away_id)
      from draw_rows group by least(home_id, away_id), greatest(home_id, away_id) having count(*) > 1
    union all
    select 'a club plays itself' from draw_rows where home_id = away_id
    limit 10
  ) problems;
  if bad is not null then raise exception 'The draw breaks the rules: %', bad; end if;

  delete from public.matches where tournament_id = target_tournament_id and stage = 'league';

  insert into public.matches (tournament_id, stage, bracket, round, leg, match_order, home_entry_id, away_entry_id, status, fixture_date, match_code, published)
  select target_tournament_id, 'league', 'League Stage', 'Matchday ' || d.matchday, 1,
         d.matchday * 1000 + row_number() over (partition by d.matchday order by d.ord),
         d.home_id, d.away_id, 'scheduled', first_matchday + (d.matchday - 1) * 7,
         'L' || d.matchday || '-' || row_number() over (partition by d.matchday order by d.ord), true
  from draw_rows d;
  get diagnostics saved = row_count;

  update public.tournaments
     set league_draw_seed = draw_seed, league_draw_at = now(), league_first_matchday = first_matchday,
         status = case when status = 'draft' then 'published' else status end
   where id = target_tournament_id;

  insert into public.audit_log (action, entity_type, entity_id, new_data, changed_by, created_at)
  values ('league_phase_draw', 'tournament', target_tournament_id,
          jsonb_build_object('seed', draw_seed, 'fixtures', saved, 'first_matchday', first_matchday),
          (select auth.uid())::text, now());

  return saved;
end;
$function$;

-- Pots (and seeds) from the registered ratings, before the draw.
create or replace function public.set_league_pots_by_rating(target_tournament_id bigint, pot_count integer default 5)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  entry_count integer;
  pot_size integer;
  updated integer;
begin
  if not public.can_manage_tournament(target_tournament_id) then
    raise exception 'Only tournament organisers can set the pots.';
  end if;
  if pot_count is null or pot_count < 2 or pot_count > 8 then raise exception 'Choose between 2 and 8 pots.'; end if;
  if exists (select 1 from public.matches where tournament_id = target_tournament_id and stage = 'league') then
    raise exception 'The draw has been made; replace it before changing the pots.';
  end if;
  select count(*) into entry_count from public.tournament_entries
   where tournament_id = target_tournament_id and coalesce(withdrawn, false) = false and coalesce(disqualified, false) = false;
  if entry_count < pot_count * 2 then raise exception 'Not enough clubs for % pots.', pot_count; end if;
  pot_size := ceil(entry_count::numeric / pot_count);

  with ranked as (
    select e.id, row_number() over (order by e.rating desc nulls last, e.seed nulls last, tm.name, e.id) rnk
    from public.tournament_entries e
    left join public.teams tm on tm.id = e.team_id
    where e.tournament_id = target_tournament_id and coalesce(e.withdrawn, false) = false and coalesce(e.disqualified, false) = false
  )
  update public.tournament_entries e
     set seed = r.rnk, pot = ((r.rnk - 1) / pot_size) + 1
    from ranked r
   where e.id = r.id;
  get diagnostics updated = row_count;

  insert into public.audit_log (action, entity_type, entity_id, new_data, changed_by, created_at)
  values ('league_pots_by_rating', 'tournament', target_tournament_id,
          jsonb_build_object('pots', pot_count, 'pot_size', pot_size, 'clubs', updated), (select auth.uid())::text, now());
  return updated;
end;
$function$;

revoke all on function public.set_league_pots_by_rating(bigint, integer) from public;
grant execute on function public.set_league_pots_by_rating(bigint, integer) to authenticated;
