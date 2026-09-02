-- PR #73 hardening follow-up.
-- 1. Knockout-only BYEs are auto-resolved structural matches and their result
--    identity cannot be corrupted by organisers, assistants or direct API paths.
-- 2. A completed/archived knockout-only tournament automatically reopens if its
--    Final ceases to satisfy the completion invariant or its Final review reopens.
-- 3. Knockout round slots are unique at the database boundary so concurrent draw
--    generation from multiple tabs cannot create duplicate rounds.

create or replace function public.guard_knockout_only_bye_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.stage <> 'knockout'
     or not public.is_knockout_only_tournament(old.tournament_id)
     or old.away_entry_id is not null
     or old.decided_by is distinct from 'bye' then
    return new;
  end if;

  if new.home_entry_id is distinct from old.home_entry_id
     or new.away_entry_id is not null then
    raise exception 'A knockout BYE cannot change its sole entrant';
  end if;

  if new.status is distinct from 'played'
     or new.home_score is distinct from 3
     or new.away_score is distinct from 0
     or new.winner_entry_id is distinct from old.home_entry_id
     or new.loser_entry_id is not null
     or new.decided_by is distinct from 'bye' then
    raise exception 'A knockout BYE result is automatic and cannot be changed';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_knockout_only_bye_invariant() from public, anon, authenticated;
grant execute on function public.guard_knockout_only_bye_invariant() to service_role;

drop trigger if exists guard_knockout_only_bye_invariant on public.matches;
create trigger guard_knockout_only_bye_invariant
before update on public.matches
for each row execute function public.guard_knockout_only_bye_invariant();

create or replace function public.reopen_knockout_only_tournament_if_final_invalid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_id_value bigint;
  tournament_status text;
  knockout_only boolean;
  final_ready boolean;
  final_under_review boolean;
begin
  tournament_id_value := coalesce(new.tournament_id, old.tournament_id);

  if not (
    (tg_op = 'DELETE' and old.stage = 'knockout' and old.round = 'Final')
    or
    (tg_op = 'UPDATE' and (
      (old.stage = 'knockout' and old.round = 'Final')
      or (new.stage = 'knockout' and new.round = 'Final')
    ))
  ) then
    return coalesce(new, old);
  end if;

  select t.status, t.tournament_structure = 'knockout_only'
    into tournament_status, knockout_only
  from public.tournaments t
  where t.id = tournament_id_value;

  if not coalesce(knockout_only, false)
     or tournament_status not in ('completed', 'archived') then
    return coalesce(new, old);
  end if;

  select exists (
    select 1
    from public.matches m
    where m.tournament_id = tournament_id_value
      and m.stage = 'knockout'
      and m.round = 'Final'
      and m.status in ('played', 'forfeit')
      and m.winner_entry_id is not null
  ) into final_ready;

  select exists (
    select 1
    from public.manager_result_submissions s
    join public.matches m on m.id = s.match_id
    where m.tournament_id = tournament_id_value
      and m.stage = 'knockout'
      and m.round = 'Final'
      and s.status in (
        'pending_confirmation',
        'disputed',
        'pending_admin_check',
        'opponent_confirmed',
        'appealed'
      )
  ) into final_under_review;

  if not final_ready or final_under_review then
    update public.tournaments
    set status = 'published',
        archived_at = null
    where id = tournament_id_value
      and status in ('completed', 'archived');
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.reopen_knockout_only_tournament_if_final_invalid() from public, anon, authenticated;
grant execute on function public.reopen_knockout_only_tournament_if_final_invalid() to service_role;

drop trigger if exists reopen_knockout_only_after_final_change on public.matches;
create trigger reopen_knockout_only_after_final_change
after update or delete on public.matches
for each row execute function public.reopen_knockout_only_tournament_if_final_invalid();

create or replace function public.reopen_knockout_only_tournament_if_final_review_reopens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  final_tournament_id bigint;
begin
  if new.status not in (
    'pending_confirmation',
    'disputed',
    'pending_admin_check',
    'opponent_confirmed',
    'appealed'
  ) then
    return new;
  end if;

  select m.tournament_id
    into final_tournament_id
  from public.matches m
  join public.tournaments t on t.id = m.tournament_id
  where m.id = new.match_id
    and m.stage = 'knockout'
    and m.round = 'Final'
    and t.tournament_structure = 'knockout_only'
    and t.status in ('completed', 'archived');

  if final_tournament_id is not null then
    update public.tournaments
    set status = 'published',
        archived_at = null
    where id = final_tournament_id
      and status in ('completed', 'archived');
  end if;

  return new;
end;
$$;

revoke all on function public.reopen_knockout_only_tournament_if_final_review_reopens() from public, anon, authenticated;
grant execute on function public.reopen_knockout_only_tournament_if_final_review_reopens() to service_role;

drop trigger if exists reopen_knockout_only_after_final_review on public.manager_result_submissions;
create trigger reopen_knockout_only_after_final_review
after insert or update of status on public.manager_result_submissions
for each row execute function public.reopen_knockout_only_tournament_if_final_review_reopens();

create unique index if not exists matches_knockout_round_slot_unique
on public.matches (
  tournament_id,
  coalesce(bracket, 'Cup'),
  round,
  leg,
  match_order
)
where stage = 'knockout';
