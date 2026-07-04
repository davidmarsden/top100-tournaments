-- Run this once in Supabase SQL Editor before using fixture date tools.

alter table matches
  add column if not exists fixture_date date;

create index if not exists matches_tournament_stage_round_fixture_date_idx
  on matches (tournament_id, stage, round, fixture_date);
