-- Repair existing Challonge imports whose match rows have participant placeholders
-- but null home_entry_id / away_entry_id.
-- Safe to run repeatedly.

with entry_aliases as (
  select
    te.id as entry_id,
    te.tournament_id,
    trim(alias) as alias
  from tournament_entries te
  cross join lateral regexp_split_to_table(
    coalesce(
      nullif(substring(te.notes from 'aliases:([^;]+)'), ''),
      nullif(substring(te.notes from 'challonge_participant_id:([^;]+)'), ''),
      ''
    ),
    '\|'
  ) alias
  where coalesce(te.notes, '') like '%challonge_participant_id:%'
),
primary_aliases as (
  select
    te.id as entry_id,
    te.tournament_id,
    substring(te.notes from 'challonge_participant_id:([^;]+)') as alias
  from tournament_entries te
  where coalesce(te.notes, '') like '%challonge_participant_id:%'
),
all_aliases as (
  select * from entry_aliases where alias <> ''
  union
  select * from primary_aliases where alias is not null and alias <> ''
),
home_repairs as (
  update matches m
  set
    home_entry_id = a.entry_id,
    home_placeholder = null
  from all_aliases a
  where m.tournament_id = a.tournament_id
    and m.home_entry_id is null
    and coalesce(m.home_placeholder, '') ~* ('(^|[^0-9])' || regexp_replace(a.alias, '[^0-9]', '', 'g') || '([^0-9]|$)')
    and regexp_replace(a.alias, '[^0-9]', '', 'g') <> ''
  returning m.id
),
away_repairs as (
  update matches m
  set
    away_entry_id = a.entry_id,
    away_placeholder = null
  from all_aliases a
  where m.tournament_id = a.tournament_id
    and m.away_entry_id is null
    and coalesce(m.away_placeholder, '') ~* ('(^|[^0-9])' || regexp_replace(a.alias, '[^0-9]', '', 'g') || '([^0-9]|$)')
    and regexp_replace(a.alias, '[^0-9]', '', 'g') <> ''
  returning m.id
)
select
  (select count(*) from home_repairs) as repaired_home_links,
  (select count(*) from away_repairs) as repaired_away_links;

-- Diagnostic: any unresolved Challonge match sides remaining.
select
  t.id as tournament_id,
  t.name as tournament,
  count(*) filter (where m.home_entry_id is null) as missing_home_links,
  count(*) filter (where m.away_entry_id is null) as missing_away_links
from tournaments t
join matches m on m.tournament_id = t.id
where t.source = 'challonge'
group by t.id, t.name
having count(*) filter (where m.home_entry_id is null) > 0
    or count(*) filter (where m.away_entry_id is null) > 0
order by t.name;
