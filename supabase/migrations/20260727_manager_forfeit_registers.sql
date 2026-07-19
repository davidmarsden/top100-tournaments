-- Manager-specific forfeit tracking and automatic synchronisation.

alter table public.forfeits
  add column if not exists manager_id bigint references public.managers(id) on delete set null,
  add column if not exists source text not null default 'legacy';

-- Preserve one authoritative forfeit record per match.
with duplicates as (
  select id,
         row_number() over (partition by match_id order by created_at desc nulls last, id desc) as rn
  from public.forfeits
  where match_id is not null
)
delete from public.forfeits f
using duplicates d
where f.id = d.id
  and d.rn > 1;

create unique index if not exists forfeits_match_id_unique
  on public.forfeits(match_id)
  where match_id is not null;

create index if not exists forfeits_manager_id_idx
  on public.forfeits(manager_id);

-- Snapshot the responsible manager from the entrant record. This means a later
-- club/manager replacement does not move an old forfeit to the incoming manager.
update public.forfeits f
set manager_id = e.manager_id
from public.tournament_entries e
where f.manager_id is null
  and f.forfeiting_entry_id = e.id;

create or replace function public.sync_match_forfeit_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  forfeiting_entry bigint;
  responsible_manager bigint;
begin
  if new.status = 'forfeit' then
    forfeiting_entry := new.loser_entry_id;

    if forfeiting_entry is null then
      if coalesce(new.home_score, 0) < coalesce(new.away_score, 0) then
        forfeiting_entry := new.home_entry_id;
      elsif coalesce(new.away_score, 0) < coalesce(new.home_score, 0) then
        forfeiting_entry := new.away_entry_id;
      end if;
    end if;

    select manager_id
      into responsible_manager
    from public.tournament_entries
    where id = forfeiting_entry;

    insert into public.forfeits (
      match_id,
      forfeiting_entry_id,
      manager_id,
      reason,
      penalty,
      affects_prize_draw,
      source
    ) values (
      new.id,
      forfeiting_entry,
      responsible_manager,
      'Match recorded as a forfeit',
      'Match forfeiture',
      true,
      'match_ruling'
    )
    on conflict (match_id) where match_id is not null
    do update set
      forfeiting_entry_id = excluded.forfeiting_entry_id,
      manager_id = excluded.manager_id,
      source = 'match_ruling';
  else
    delete from public.forfeits
    where match_id = new.id
      and source = 'match_ruling';
  end if;

  return new;
end;
$$;

drop trigger if exists sync_match_forfeit_record on public.matches;
create trigger sync_match_forfeit_record
after insert or update of status, home_score, away_score, home_entry_id, away_entry_id, loser_entry_id
on public.matches
for each row
execute function public.sync_match_forfeit_record();

-- Backfill current match rulings that pre-date the trigger.
insert into public.forfeits (
  match_id,
  forfeiting_entry_id,
  manager_id,
  reason,
  penalty,
  affects_prize_draw,
  source
)
select
  m.id,
  coalesce(
    m.loser_entry_id,
    case
      when coalesce(m.home_score, 0) < coalesce(m.away_score, 0) then m.home_entry_id
      when coalesce(m.away_score, 0) < coalesce(m.home_score, 0) then m.away_entry_id
      else null
    end
  ) as forfeiting_entry_id,
  e.manager_id,
  'Match recorded as a forfeit',
  'Match forfeiture',
  true,
  'match_ruling'
from public.matches m
left join public.tournament_entries e on e.id = coalesce(
  m.loser_entry_id,
  case
    when coalesce(m.home_score, 0) < coalesce(m.away_score, 0) then m.home_entry_id
    when coalesce(m.away_score, 0) < coalesce(m.home_score, 0) then m.away_entry_id
    else null
  end
)
where m.status = 'forfeit'
on conflict (match_id) where match_id is not null
  do update set
    forfeiting_entry_id = excluded.forfeiting_entry_id,
    manager_id = excluded.manager_id,
    source = 'match_ruling';

comment on column public.forfeits.manager_id is
  'Manager responsible at the time of the forfeit. This is a snapshot and does not change when a club appoints a replacement manager.';
