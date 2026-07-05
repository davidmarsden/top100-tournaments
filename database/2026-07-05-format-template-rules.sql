-- Template/rules layer for database-driven tournament generation.
-- IDs follow the existing project convention: bigint identity, not uuid.

create table if not exists tournament_round_templates (
  id bigint generated always as identity primary key,
  format_id bigint not null references tournament_formats(id) on delete cascade,
  bracket text not null,
  round_name text not null,
  round_order integer not null,
  round_type text not null default 'knockout',
  legs integer not null default 1,
  away_goals boolean not null default true,
  fictional_extra_time boolean not null default true,
  penalties boolean not null default false,
  loser_to_bracket text,
  notes text,
  created_at timestamptz default now(),
  unique (format_id, bracket, round_name)
);

create table if not exists fixture_templates (
  id bigint generated always as identity primary key,
  round_template_id bigint not null references tournament_round_templates(id) on delete cascade,
  leg integer not null default 1,
  day_offset integer not null default 0,
  home_away_flip boolean not null default false,
  notes text,
  created_at timestamptz default now(),
  unique (round_template_id, leg)
);

create table if not exists qualification_rules (
  id bigint generated always as identity primary key,
  format_id bigint not null references tournament_formats(id) on delete cascade,
  bracket text not null,
  source_stage text not null default 'group',
  group_position integer,
  rank_order integer not null,
  slots integer,
  destination_round text not null,
  drop_from_bracket text,
  notes text,
  created_at timestamptz default now(),
  unique (format_id, bracket, rank_order)
);

create index if not exists tournament_round_templates_format_idx
  on tournament_round_templates (format_id, bracket, round_order);

create index if not exists fixture_templates_round_idx
  on fixture_templates (round_template_id, leg);

create index if not exists qualification_rules_format_idx
  on qualification_rules (format_id, bracket, rank_order);

-- Seed / update the Youth Cup format.
insert into tournament_formats (
  name,
  description,
  has_group_stage,
  has_knockout_stage,
  has_secondary_bracket,
  group_size,
  legs_group_stage,
  legs_knockout_stage,
  notes
)
select
  'Youth Cup Template',
  'Group stage followed by Cup and Shield knockouts. Cup R32 is one leg; Cup R16 onwards is two legs. Shield R32/R16 are one leg; Shield QF onwards is two legs.',
  true,
  true,
  true,
  4,
  2,
  2,
  'Seeded from average rating; knockout qualifiers seeded from group table performance.'
where not exists (
  select 1 from tournament_formats where name = 'Youth Cup Template'
);

with fmt as (
  select id from tournament_formats where name = 'Youth Cup Template' order by id limit 1
), round_seed as (
  select * from (values
    ('Cup'::text,    'R32'::text,   1::integer, 'knockout'::text, 1::integer, true::boolean, true::boolean, false::boolean, 'Shield'::text, 'Cup R32 losers drop into Shield R32'::text),
    ('Cup'::text,    'R16'::text,   2::integer, 'knockout'::text, 2::integer, true::boolean, true::boolean, false::boolean, null::text,     null::text),
    ('Cup'::text,    'QF'::text,    3::integer, 'knockout'::text, 2::integer, true::boolean, true::boolean, false::boolean, null::text,     null::text),
    ('Cup'::text,    'SF'::text,    4::integer, 'knockout'::text, 2::integer, true::boolean, true::boolean, false::boolean, null::text,     null::text),
    ('Cup'::text,    'Final'::text, 5::integer, 'knockout'::text, 2::integer, true::boolean, true::boolean, false::boolean, null::text,     null::text),
    ('Shield'::text, 'R32'::text,   1::integer, 'knockout'::text, 1::integer, true::boolean, true::boolean, false::boolean, null::text,     'Third-placed group teams host Cup R32 losers'::text),
    ('Shield'::text, 'R16'::text,   2::integer, 'knockout'::text, 1::integer, true::boolean, true::boolean, false::boolean, null::text,     null::text),
    ('Shield'::text, 'QF'::text,    3::integer, 'knockout'::text, 2::integer, true::boolean, true::boolean, false::boolean, null::text,     null::text),
    ('Shield'::text, 'SF'::text,    4::integer, 'knockout'::text, 2::integer, true::boolean, true::boolean, false::boolean, null::text,     null::text),
    ('Shield'::text, 'Final'::text, 5::integer, 'knockout'::text, 2::integer, true::boolean, true::boolean, false::boolean, null::text,     null::text)
  ) as r(bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes)
)
insert into tournament_round_templates (
  format_id,
  bracket,
  round_name,
  round_order,
  round_type,
  legs,
  away_goals,
  fictional_extra_time,
  penalties,
  loser_to_bracket,
  notes
)
select
  fmt.id,
  round_seed.bracket,
  round_seed.round_name,
  round_seed.round_order,
  round_seed.round_type,
  round_seed.legs,
  round_seed.away_goals,
  round_seed.fictional_extra_time,
  round_seed.penalties,
  round_seed.loser_to_bracket,
  round_seed.notes
from fmt cross join round_seed
on conflict (format_id, bracket, round_name) do update set
  round_order = excluded.round_order,
  round_type = excluded.round_type,
  legs = excluded.legs,
  away_goals = excluded.away_goals,
  fictional_extra_time = excluded.fictional_extra_time,
  penalties = excluded.penalties,
  loser_to_bracket = excluded.loser_to_bracket,
  notes = excluded.notes;

insert into fixture_templates (round_template_id, leg, day_offset, home_away_flip, notes)
select id, 1, 0, false, 'Single fixture or first leg'
from tournament_round_templates
where format_id = (select id from tournament_formats where name = 'Youth Cup Template' order by id limit 1)
on conflict (round_template_id, leg) do update set
  day_offset = excluded.day_offset,
  home_away_flip = excluded.home_away_flip,
  notes = excluded.notes;

insert into fixture_templates (round_template_id, leg, day_offset, home_away_flip, notes)
select id, 2, 7, true, 'Second leg exactly seven days after first leg'
from tournament_round_templates
where format_id = (select id from tournament_formats where name = 'Youth Cup Template' order by id limit 1)
  and legs = 2
on conflict (round_template_id, leg) do update set
  day_offset = excluded.day_offset,
  home_away_flip = excluded.home_away_flip,
  notes = excluded.notes;

with fmt as (
  select id from tournament_formats where name = 'Youth Cup Template' order by id limit 1
), rule_seed as (
  select * from (values
    ('Cup'::text,    'group'::text, 1::integer,    1::integer, null::integer, 'R32'::text, null::text, 'All group winners qualify first and are ranked by table performance'::text),
    ('Cup'::text,    'group'::text, 2::integer,    2::integer, null::integer, 'R32'::text, null::text, 'All runners-up qualify after group winners and are ranked by table performance'::text),
    ('Shield'::text, 'group'::text, 3::integer,    1::integer, null::integer, 'R32'::text, null::text, 'Third-placed teams enter Shield R32 as home teams'::text),
    ('Shield'::text, 'drop'::text,  null::integer, 2::integer, null::integer, 'R32'::text, 'Cup'::text, 'Cup R32 losers enter Shield R32 as away teams'::text)
  ) as q(bracket, source_stage, group_position, rank_order, slots, destination_round, drop_from_bracket, notes)
)
insert into qualification_rules (
  format_id,
  bracket,
  source_stage,
  group_position,
  rank_order,
  slots,
  destination_round,
  drop_from_bracket,
  notes
)
select
  fmt.id,
  rule_seed.bracket,
  rule_seed.source_stage,
  rule_seed.group_position,
  rule_seed.rank_order,
  rule_seed.slots,
  rule_seed.destination_round,
  rule_seed.drop_from_bracket,
  rule_seed.notes
from fmt cross join rule_seed
on conflict (format_id, bracket, rank_order) do update set
  source_stage = excluded.source_stage,
  group_position = excluded.group_position,
  slots = excluded.slots,
  destination_round = excluded.destination_round,
  drop_from_bracket = excluded.drop_from_bracket,
  notes = excluded.notes;
