-- Optional cleanup for test/demo tournaments.
-- Review the SELECT first, then run the DELETE block only when you are happy with the list.

select id, name, status, created_at
from tournaments
where name ilike '%test%'
   or name ilike '%demo%'
   or name ilike '%preview%'
   or name ilike '%scratch%'
order by created_at desc;

-- DELETE BLOCK: uncomment only after checking the SELECT above.
-- This relies on foreign keys with cascade where configured. For safety, it explicitly removes dependent rows first.

-- with doomed as (
--   select id
--   from tournaments
--   where name ilike '%test%'
--      or name ilike '%demo%'
--      or name ilike '%preview%'
--      or name ilike '%scratch%'
-- )
-- delete from forfeits where match_id in (select id from matches where tournament_id in (select id from doomed));
--
-- with doomed as (
--   select id
--   from tournaments
--   where name ilike '%test%'
--      or name ilike '%demo%'
--      or name ilike '%preview%'
--      or name ilike '%scratch%'
-- )
-- delete from achievements where tournament_id in (select id from doomed);
--
-- with doomed as (
--   select id
--   from tournaments
--   where name ilike '%test%'
--      or name ilike '%demo%'
--      or name ilike '%preview%'
--      or name ilike '%scratch%'
-- )
-- delete from honours where tournament_id in (select id from doomed);
--
-- with doomed as (
--   select id
--   from tournaments
--   where name ilike '%test%'
--      or name ilike '%demo%'
--      or name ilike '%preview%'
--      or name ilike '%scratch%'
-- )
-- delete from tournament_round_dates where tournament_id in (select id from doomed);
--
-- with doomed as (
--   select id
--   from tournaments
--   where name ilike '%test%'
--      or name ilike '%demo%'
--      or name ilike '%preview%'
--      or name ilike '%scratch%'
-- )
-- delete from matches where tournament_id in (select id from doomed);
--
-- with doomed as (
--   select id
--   from tournaments
--   where name ilike '%test%'
--      or name ilike '%demo%'
--      or name ilike '%preview%'
--      or name ilike '%scratch%'
-- )
-- delete from groups where tournament_id in (select id from doomed);
--
-- with doomed as (
--   select id
--   from tournaments
--   where name ilike '%test%'
--      or name ilike '%demo%'
--      or name ilike '%preview%'
--      or name ilike '%scratch%'
-- )
-- delete from tournament_entries where tournament_id in (select id from doomed);
--
-- delete from tournaments
-- where name ilike '%test%'
--    or name ilike '%demo%'
--    or name ilike '%preview%'
--    or name ilike '%scratch%';
