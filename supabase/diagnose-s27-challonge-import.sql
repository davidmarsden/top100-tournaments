-- Diagnose why imported S27 Challonge matches do not display team names.
-- Read-only. Safe to run.

-- 1. Identify candidate S27 Challonge tournaments.
select
  id,
  name,
  source,
  source_id,
  status,
  actual_entries,
  season_number,
  public_slug,
  is_public,
  archive_quality
from tournaments
where source = 'challonge'
  and (
    season_number = 27
    or public_slug = 's27'
    or name ilike '%S27%'
  )
order by created_at desc, id desc;

-- 2. Show imported entries and exactly what participant metadata was stored.
select
  t.id as tournament_id,
  t.name as tournament,
  te.id as entry_id,
  te.seed,
  tm.name as team_name,
  m.name as manager_name,
  te.notes,
  substring(te.notes from 'challonge_participant_id:([^;]+)') as stored_participant_id,
  substring(te.notes from 'aliases:([^;]+)') as stored_aliases
from tournaments t
join tournament_entries te on te.tournament_id = t.id
left join teams tm on tm.id = te.team_id
left join managers m on m.id = te.manager_id
where t.source = 'challonge'
  and (
    t.season_number = 27
    or t.public_slug = 's27'
    or t.name ilike '%S27%'
  )
order by t.id desc, te.seed nulls last, te.id;

-- 3. Show match-side linkage and placeholders.
select
  t.id as tournament_id,
  t.name as tournament,
  mt.id as match_id,
  mt.challonge_match_id,
  mt.source_id,
  mt.round,
  mt.match_order,
  mt.home_entry_id,
  htm.name as linked_home_team,
  mt.home_placeholder,
  mt.home_score,
  mt.away_score,
  mt.away_entry_id,
  atm.name as linked_away_team,
  mt.away_placeholder
from tournaments t
join matches mt on mt.tournament_id = t.id
left join tournament_entries he on he.id = mt.home_entry_id
left join teams htm on htm.id = he.team_id
left join tournament_entries ae on ae.id = mt.away_entry_id
left join teams atm on atm.id = ae.team_id
where t.source = 'challonge'
  and (
    t.season_number = 27
    or t.public_slug = 's27'
    or t.name ilike '%S27%'
  )
order by t.id desc, mt.match_order nulls last, mt.id;

-- 4. Compact summary of the failure mode.
select
  t.id as tournament_id,
  t.name as tournament,
  count(distinct te.id) as entries,
  count(distinct mt.id) as matches,
  count(distinct mt.id) filter (where mt.home_entry_id is null) as matches_missing_home_entry,
  count(distinct mt.id) filter (where mt.away_entry_id is null) as matches_missing_away_entry,
  count(distinct mt.id) filter (where mt.home_placeholder is not null) as matches_with_home_placeholder,
  count(distinct mt.id) filter (where mt.away_placeholder is not null) as matches_with_away_placeholder,
  count(distinct te.id) filter (where coalesce(te.notes, '') like '%challonge_participant_id:%') as entries_with_participant_id_notes
from tournaments t
left join tournament_entries te on te.tournament_id = t.id
left join matches mt on mt.tournament_id = t.id
where t.source = 'challonge'
  and (
    t.season_number = 27
    or t.public_slug = 's27'
    or t.name ilike '%S27%'
  )
group by t.id, t.name
order by t.id desc;
