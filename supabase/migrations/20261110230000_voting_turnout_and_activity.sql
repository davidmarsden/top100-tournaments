-- How many managers have voted, for everyone to see, and voting as part of manager activity.
--
-- voting_turnout(target_event_id) (public, signed in or not): for each awards vote and poll that is
-- open or closed, its title and deadline, how many ballots have been cast and how many managers
-- can vote (the awards site shows this before anyone signs in). Counts only:
-- who has voted stays with the administrators (get_voting_participants), and choices stay secret.
--
-- appointment_manager_inputs: adds the manager's voting record over the last 12 months, scored as
-- part of activity (rule 3.2): votesEligible is the awards and polls they could vote in that have
-- closed (or that they have already voted in, so an early vote counts at once and a vote still
-- open never counts against anyone), votesCast how many of those they voted in, and votingPercent
-- the share. No eligible votes leaves it out (half marks).

create or replace function public.voting_turnout(target_event_id bigint default null)
returns table(event_id bigint, title text, event_type text, status text, closes_at timestamptz, ballots_cast integer, electorate_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select event.id, event.title, event.event_type, event.status, event.closes_at,
    (select count(*)::integer from public.voting_ballots ballot where ballot.event_id = event.id),
    (select count(*)::integer from public.voting_electorate voter where voter.event_id = event.id)
  from public.voting_events event
  where event.status in ('open', 'closed') and event.event_type in ('awards', 'poll')
    and (target_event_id is null or event.id = target_event_id)
  order by event.id;
$$;
revoke all on function public.voting_turnout(bigint) from public;
grant execute on function public.voting_turnout(bigint) to anon, authenticated;

create or replace function public.appointment_manager_inputs(p_world_id bigint, p_season integer, p_manager_ids bigint[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with spells as materialized (select public.appointment_manager_spells(p_world_id, p_season, p_manager_ids) as by_manager)
  select coalesce(jsonb_object_agg(ids.manager_id::text, jsonb_strip_nulls(jsonb_build_object(
    -- The Manager List badge decides Gold. When the profile has shown no days left since a date now
    -- past but the badge is still on, it is unclear (run out, or in Soccer Manager's renewal grace):
    -- flagged for an administrator to check, not counted against the manager.
    'gold', signal.gold,
    'goldUnclearSince', case when signal.gold is true then signal.gold_ended_on end,
    'goldDaysLeft', signal.gold_days_left,
    'gameWorlds', signal.game_worlds,
    'running', case when official.manager_id is not null then 3 else 0 end,
    'competitions', (select count(distinct entry.tournament_id) from public.tournament_entries entry
                       join public.tournaments tournament on tournament.id = entry.tournament_id
                       join public.seasons season on season.id = tournament.season_id
                      where entry.manager_id = ids.manager_id and season.number between p_season - 1 and p_season
                        and not coalesce(entry.withdrawn, false)),
    'topManagerDeals', (select count(*) from public.soccer_manager_transfers transfer
                         where transfer.game_world_id = p_world_id
                           and transfer.from_manager_id is not null and transfer.to_manager_id is not null
                           and transfer.from_manager_id <> transfer.to_manager_id
                           and ids.manager_id in (transfer.from_manager_id, transfer.to_manager_id)
                           and transfer.first_seen_at >= now() - interval '120 days'),
    'votesEligible', nullif(voting.eligible, 0),
    'votesCast', case when voting.eligible > 0 then voting.cast_count end,
    'votingPercent', case when voting.eligible > 0 then round(100.0 * voting.cast_count / voting.eligible) end,
    'forfeits', (select count(*) from public.forfeits forfeit
                   join public.tournament_entries entry on entry.id = forfeit.forfeiting_entry_id
                   join public.tournaments tournament on tournament.id = entry.tournament_id
                   join public.seasons season on season.id = tournament.season_id
                  where entry.manager_id = ids.manager_id and season.number = p_season
                    and (spell.started_on is null or forfeit.created_at >= spell.started_on)),
    'spell', spells.by_manager -> ids.manager_id::text,
    'openSanction', (select string_agg(coalesce(ban.terms, 'transfer ban') || ' until ' || to_char(ban.ends_on, 'FMDD Mon YYYY'), '; ')
                       from public.club_transfer_bans ban
                       join public.appointment_world_managers(p_world_id) club on club.club_name = ban.club_name
                      where club.manager_id = ids.manager_id and ban.ends_on >= current_date)
  ))), '{}'::jsonb)
  from spells cross join unnest(p_manager_ids) ids(manager_id)
  left join lateral (select case when ((spells.by_manager -> ids.manager_id::text) ->> 'confirmed')::boolean
                                 then ((spells.by_manager -> ids.manager_id::text) ->> 'startedOn')::date end as started_on) spell on true
  left join lateral (
    select count(*) as eligible, count(ballot.id) as cast_count
    from public.voting_electorate voter
    join public.voting_events event on event.id = voter.event_id
    left join public.voting_ballots ballot on ballot.event_id = voter.event_id and ballot.manager_id = voter.manager_id
    where voter.manager_id = ids.manager_id
      and event.event_type in ('awards', 'poll') and event.status in ('open', 'closed')
      and event.opens_at >= now() - interval '12 months'
      and (event.status = 'closed' or (event.closes_at is not null and event.closes_at <= now()) or ballot.id is not null)
  ) voting on true
  left join lateral (
    select snapshot.gold, snapshot.gold_days_left, snapshot.game_worlds,
      (select expiry.expires_on from public.manager_gold_expiry(snapshot.source_world_id) expiry
        where expiry.source_club_id = snapshot.source_club_id and expiry.sm_manager_id = snapshot.sm_manager_id
          and expiry.expires_on < (now() at time zone 'UTC')::date) as gold_ended_on
    from public.manager_signal_snapshots snapshot
    where snapshot.game_world_id = p_world_id and snapshot.manager_id = ids.manager_id
    order by snapshot.captured_at desc limit 1
  ) signal on true
  left join public.top100_officials official on official.manager_id = ids.manager_id;
$$;

revoke all on function public.appointment_manager_inputs(bigint, integer, bigint[]) from public, anon, authenticated;
