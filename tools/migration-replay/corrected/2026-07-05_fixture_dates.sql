-- Run this once in Supabase SQL Editor before using fixture date tools.

alter table matches
  add column if not exists fixture_date date;

-- [F10] index matches_tournament_stage_round_fixture_date_idx omitted: absent from production.
