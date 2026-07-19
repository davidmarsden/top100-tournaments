-- Backfill tournament linkage for legacy press-room contributions.
-- Older or partially migrated match_comments rows may have gained tournament_id as NULL.
-- Derive it from the referenced match so those contributions and their reports remain
-- visible in the tournament-scoped admin moderation queue.

update public.match_comments as comments
set tournament_id = matches.tournament_id
from public.matches as matches
where comments.match_id = matches.id
  and comments.tournament_id is null
  and matches.tournament_id is not null;
