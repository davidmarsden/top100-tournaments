-- Transfer-ban ladder (rule 4.1): each offence moves a manager up a level, 1 month, 3, 4, then 6;
-- six months clean after a ban ends moves them back down one level, and down another for each
-- further six months.
--
-- transfer_ban_history: every ban with its offence level, by manager. Seeded with the bans on the
-- Transfer Bans page from September 2023 (older ones can no longer affect a level) and this
-- autumn's bans. Every ban recorded from now on is added by a trigger, whichever form records it,
-- at the level the ladder gives on its start date.
-- transfer_ban_ladder(manager, name, as_of): officials only. The manager's last ban, the level
-- they're back to by as_of, and the suggested level and length for a new offence.
-- record_transfer_ban_level(ban, manager, level): officials only; sets a recorded ban's level.

create table if not exists public.transfer_ban_history (
  id bigint generated always as identity primary key,
  manager_id bigint references public.managers(id),
  manager_name text not null,
  club_name text,
  starts_on date not null,
  ends_on date not null,
  offence_level integer not null check (offence_level between 1 and 4),
  kind text not null default 'squad_limit' check (kind in ('squad_limit', 'cancelled_deal', 'other')),
  note text,
  ban_id bigint references public.club_transfer_bans(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (manager_name, starts_on)
);

alter table public.transfer_ban_history enable row level security;

drop policy if exists "Officials read transfer ban history" on public.transfer_ban_history;
create policy "Officials read transfer ban history" on public.transfer_ban_history
  for select to authenticated using (public.is_top100_official());

revoke all on public.transfer_ban_history from anon, authenticated;
grant select on public.transfer_ban_history to authenticated;

-- From the Transfer Bans page (smtop100.blog/2025/02/26/transfer-bans/), September 2023 on.
-- A manager is linked only where their record exists (a fresh database has none).
insert into public.transfer_ban_history (manager_id, manager_name, club_name, starts_on, ends_on, offence_level, kind, note)
select manager.id, v.manager_name, v.club_name, v.starts_on::date, v.ends_on::date, v.level, v.kind, v.note
from (values
  (480, 'Attilio Bonnici', 'Standard Liege', '2025-10-27', '2025-11-26', 1, 'squad_limit', 'Attilio Bonnici (Standard Liege) one month ban for first offence from 27 October 2025 to 26 November 2025, and sell Floyd SAMBA to external club 24 November 2025.'),
  (473, 'Alessio Tonato', 'Napoli', '2025-09-14', '2025-10-13', 1, 'squad_limit', 'Alessio Tonato (Napoli) one month ban for first offence from 14 September 2025 to 13 October 2025, and sell Montrell CULBREATH to external club 12 October 2025.'),
  (496, 'Golden Bear', 'Valencia', '2025-09-12', '2025-10-11', 1, 'squad_limit', 'Golden Bear (Valencia) one month ban for first offence from 12 September 2025 to 11 October 2025, and sell Miguelito TERCEROS to external club 10 October 2025.'),
  (525, 'Paulo Lopes', 'Fiorentina', '2025-07-01', '2025-07-31', 1, 'squad_limit', 'Paulo Lopes (Fiorentina) one month ban for first offence from 1 July 2025 to 31 July 2025, and sell Hayato INAMURA and Edoardo PIANA to external club 29 July 2025.'),
  (null, 'John McHugh', 'Basel', '2025-06-19', '2025-07-18', 1, 'squad_limit', 'John McHugh (Basel) one month ban for first offence from 19 June 2025 to 18 July 2025, and sell Kialonda GASPAR to external club 17 June 2025.'),
  (500, 'Jamie Alldridge', 'Schalke', '2025-03-31', '2025-04-30', 1, 'squad_limit', 'Jamie Alldridge (Schalke) one month ban for first offence from 31 March 2025 to 30 April 2025, and sell Rodrigo GOMES to external club 28 April 2025.'),
  (528, 'Rob Ryan', 'Real Madrid', '2025-03-12', '2025-04-11', 1, 'squad_limit', 'Rob Ryan (Real Madrid) one month ban for first offence (more than 6 months since last Level One offence) from 12 March 2025 to 11 April 2025, and sell Luca ERLEIN to external club 10 April 2025.'),
  (114, 'Carlos Miranda', 'Saint-Etienne', '2025-02-26', '2025-03-25', 1, 'squad_limit', 'Carlos Miranda (Saint-Etienne) one month ban for first offence from 26 February 2025 to 25 March 2025, and sell Cleiton SANTANA and Wesley ADEH to external clubs 26 March 2025.'),
  (526, 'Pedro Vilar', 'Tottenham Hotspur', '2025-02-25', '2025-03-24', 1, 'squad_limit', 'Pedro Vilar (Tottenham Hotspur) one month ban for first offence (more than 12 months since last Level Three offence) from 25 February 2025 to 24 March 2025, and sell Andrés DÁVILA to external club 25 March 2025.'),
  (117, 'Anthony Guardiola', 'Hoffenheim', '2025-02-01', '2025-02-28', 1, 'squad_limit', 'Anthony Guardiola (Hoffenheim) one month ban for first offence from 1 February 2025 to 28 February 2025, and sell Tom Ritzy HÜLSMANN external 1 March 2025.'),
  (null, 'Nick Wheels', 'Spartak Moscow', '2025-01-22', '2025-02-21', 1, 'squad_limit', 'Nick Wheels (Spartak Moscow) one month ban for first offence from 22 January 2025 to 21 February 2025, and sell Remy Cabella to external club 18 February 2025.'),
  (496, 'Golden Bear', 'AZ Alkmaar', '2024-12-02', '2025-01-01', 1, 'squad_limit', 'Golden Bear (AZ Alkmaar) one month ban for first offence from 2 December 2024 to 1 January 2025, and sell Tijn VAN INGELGOM to external club 31 December 2024.'),
  (512, 'Marc Ques', 'Partizan', '2024-09-14', '2024-10-13', 1, 'cancelled_deal', 'Marc Ques (Partizan) for cancelling an accepted deal. Banned from 14 September 2024 until 13 October 2024.'),
  (null, 'Daniel Wythe', 'Werder Bremen', '2024-07-22', '2024-08-21', 1, 'squad_limit', 'Daniel Wythe (Werder Bremen) – one month ban for first offence from 22 July 2024 to 21 August 2024, and sell Seamus COLEMAN to external club 30 September 2024. (Manager quit.)'),
  (528, 'Rob Ryan', 'Real Madrid', '2024-07-01', '2024-07-31', 1, 'squad_limit', 'Rob Ryan (Real Madrid) – one month ban for first offence from 1 July 2024 to 31 July 2024, and sell Srdjan KUZMIĆ to external club 9 September 2024.'),
  (532, 'Sheene Ralspunsky', 'Feyenoord', '2024-06-22', '2024-07-21', 1, 'squad_limit', 'Sheene Ralspunsky (Feyenoord) – one month ban for first offence from 22 June 2024 to 21 July 2024, and sell Marko STAMENIC to external club 31 August 2024. (Manager quit.)'),
  (104, 'Ricardo Alexandre', 'Crystal Palace', '2024-06-16', '2024-07-15', 1, 'squad_limit', 'Ricardo Alexandre (Crystal Palace) - one month ban for first offence from 16 June 2024 to 15 July 2024, and sell Jonathan JESUS to external club 25 August 2024.'),
  (null, 'J Walker', 'Zenit', '2024-01-18', '2024-02-17', 1, 'squad_limit', 'J Walker (Zenit) - one month ban for first offence from 18 January 2024 to 17 February 2024, and sell Ronald CARDOSO to external club 28 March 2024.'),
  (94, 'Stephen Beddows', 'Sampdoria', '2024-01-17', '2024-02-16', 1, 'squad_limit', 'Stephen Beddows (Sampdoria) - one month ban for first offence from 17 January 2024 to 16 February 2024, and sell Riccardo FOGLIATA to external club 27 March 2024.'),
  (null, 'Dave Oz Osbourne', 'Dnipro/Malaga', '2023-12-21', '2024-01-20', 1, 'squad_limit', 'Dave Oz Osbourne (Dnipro/Malaga) - one month ban for first offence from 21 December 2023 to 20 January 2024, and sell Juan Manuel SANABRIA to external club 29 February 2024 (no longer possible as Dave moved clubs).'),
  (138, 'Gursimran Brar', 'Koln', '2023-12-25', '2024-01-24', 1, 'squad_limit', 'Gursimran Brar (Koln) - one month ban for first offence from 25 December 2023 to 24 January 2024, and sell Igor IYONO to external club 5 March 2024.'),
  (526, 'Pedro', 'Tottenham Hotspur', '2023-12-02', '2024-01-01', 3, 'squad_limit', 'Pedro (Tottenham Hotspur) - one month ban (extenuating circumstances) from 2 December 2023 to 1 January 2024, sell Jordy MAKENGO to external club 10 February 2024, and a final warning for third offence: any more transgressions and Pedro will quit Spurs.'),
  (null, 'Andy Martin', 'Fiorentina', '2023-10-25', '2023-11-24', 1, 'squad_limit', 'Andy Martin (Fiorentina) - one month ban for first offence from 25 October 2023 to 24 November 2023, and sell Mattes HANSEN to external club 2 January 2024.'),
  (92, 'Ignazio Barracco', 'Marseille', '2023-10-07', '2023-11-06', 1, 'squad_limit', 'Ignazio Barracco (Marseille) - one month ban for first offence from 7 October 2023 to 6 November 2023, and sell Pau CUBARSÍ to external club 16 December 2023.'),
  (122, 'r cast', 'Villarreal', '2023-09-27', '2023-10-26', 1, 'squad_limit', 'r cast (Villarreal) - one month ban for first level offence from 27 September 2023 to 26 October 2023, and sell Michael OLAKIGBE to external club 6 December 2023.'),
  (102, 'Feargal Hickey', 'Atalanta', '2023-09-14', '2023-10-13', 1, 'squad_limit', 'Feargal Hickey (Atalanta) - one month ban for first level offence from 14 September 2023 to 13 October 2023, and sell Jack HENRY-FRANCIS and Mika BIERETH to external clubs 22 November 2023.'),
  (480, 'Attilio Bonicci', 'Lokomotiv Moskva', '2023-09-11', '2023-10-10', 1, 'squad_limit', 'Attilio Bonicci (Lokomotiv Moskva) - one month ban for first level offence from 11 September 2023 to 10 October 2023, and sell Nikola ĆETKOVIĆ to external club 20 November 2023.'),
  (526, 'Pedro', 'Feyenoord/Tottenham Hotspur', '2023-07-07', '2023-10-05', 2, 'squad_limit', 'Pedro (Feyenoord/Tottenham Hotspur) - three month ban for second level offence from 7 July 2023 to 5 October 2023, and and sell Tiziano FULVI to external club 15 September 2023 (no longer possible as Pedro moved clubs),')
) v(manager_id, manager_name, club_name, starts_on, ends_on, level, kind, note)
left join public.managers manager on manager.id = v.manager_id
on conflict (manager_name, starts_on) do nothing;

-- This autumn's bans, linked to their records.
insert into public.transfer_ban_history (manager_id, manager_name, club_name, starts_on, ends_on, offence_level, kind, note, ban_id)
select manager.id, v.manager_name, ban.club_name, ban.starts_on, ban.ends_on, v.level, 'squad_limit', ban.reason, ban.id
from (values
  (508::bigint, 'Luciano Catalano', '48507157', date '2026-10-08', 1),
  (482::bigint, 'Bruno Neto^^', '48506636', date '2026-10-20', 1),
  (508::bigint, 'Luciano Catalano', '48507157', date '2026-11-16', 2),
  (473::bigint, 'Alessio Tonato', '48507041', date '2026-11-09', 1)
) v(manager_id, manager_name, source_club_id, starts_on, level)
join public.club_transfer_bans ban on ban.source_club_id = v.source_club_id and ban.starts_on = v.starts_on
left join public.managers manager on manager.id = v.manager_id
on conflict (manager_name, starts_on) do nothing;

-- @permissions private public.transfer_ban_level_at(bigint,text,date): internal, used by transfer_ban_ladder() and the ban trigger
create or replace function public.transfer_ban_level_at(p_manager_id bigint, p_manager_name text, p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last public.transfer_ban_history;
  v_months integer;
  v_back_to integer := 0;
  v_level integer;
begin
  p_as_of := coalesce(p_as_of, current_date);
  select * into v_last from public.transfer_ban_history h
  where ((p_manager_id is not null and h.manager_id = p_manager_id)
      or lower(trim(h.manager_name)) = lower(trim(coalesce(p_manager_name, ''))))
    and h.starts_on < p_as_of
  order by h.ends_on desc, h.starts_on desc
  limit 1;

  if v_last.id is not null then
    -- A ban shortened since (e.g. after the rules check) counts from its new end.
    select coalesce((select ban.ends_on from public.club_transfer_bans ban where ban.id = v_last.ban_id), v_last.ends_on)
      into v_last.ends_on;
    v_months := greatest(0, (extract(year from age(p_as_of, v_last.ends_on)) * 12
      + extract(month from age(p_as_of, v_last.ends_on)))::integer);
    v_back_to := greatest(0, v_last.offence_level - v_months / 6);
  end if;
  v_level := least(4, v_back_to + 1);

  return jsonb_build_object(
    'lastBan', case when v_last.id is null then null else jsonb_build_object(
      'level', v_last.offence_level, 'startsOn', v_last.starts_on, 'endsOn', v_last.ends_on,
      'club', v_last.club_name, 'monthsClean', v_months) end,
    'backToLevel', v_back_to,
    'level', v_level,
    'months', case v_level when 1 then 1 when 2 then 3 when 3 then 4 else 6 end);
end;
$$;

revoke all on function public.transfer_ban_level_at(bigint, text, date) from public, anon, authenticated;

create or replace function public.transfer_ban_ladder(p_manager_id bigint, p_manager_name text, p_as_of date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can view transfer ban levels.'; end if;
  return public.transfer_ban_level_at(p_manager_id, p_manager_name, p_as_of);
end;
$$;

revoke all on function public.transfer_ban_ladder(bigint, text, date) from public, anon;
grant execute on function public.transfer_ban_ladder(bigint, text, date) to authenticated;

create or replace function public.record_transfer_ban_level(p_ban_id bigint, p_manager_id bigint, p_manager_name text, p_level integer)
returns public.transfer_ban_history
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ban public.club_transfer_bans;
  v_row public.transfer_ban_history;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can record transfer bans.'; end if;
  select * into v_ban from public.club_transfer_bans where id = p_ban_id;
  if not found then raise exception 'Transfer ban not found.'; end if;
  if p_level is null or p_level not between 1 and 4 then raise exception 'The offence level must be 1 to 4.'; end if;
  insert into public.transfer_ban_history (manager_id, manager_name, club_name, starts_on, ends_on, offence_level, kind, note, ban_id)
  values (p_manager_id, coalesce(nullif(trim(p_manager_name), ''), 'Unknown manager'), v_ban.club_name, v_ban.starts_on, v_ban.ends_on, p_level, 'squad_limit', v_ban.reason, v_ban.id)
  on conflict (manager_name, starts_on) do update set ends_on = excluded.ends_on, offence_level = excluded.offence_level, ban_id = excluded.ban_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.record_transfer_ban_level(bigint, bigint, text, integer) from public, anon;
grant execute on function public.record_transfer_ban_level(bigint, bigint, text, integer) to authenticated;

-- Every new ban goes into the history at the ladder's level, so a ban added with the plain
-- "Add ban" form counts towards the next offence too. The manager comes from the linked breach,
-- else from the club's current assignment.
create or replace function public.record_transfer_ban_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager_id bigint;
  v_manager_name text;
  v_level integer;
begin
  if exists (select 1 from public.transfer_ban_history h where h.ban_id = new.id) then return new; end if;

  select breach.manager_id, breach.manager_name into v_manager_id, v_manager_name
  from public.squad_cap_breaches breach where breach.id = new.breach_id;

  if v_manager_id is null and v_manager_name is null then
    select assignment.manager_id, coalesce(manager.display_name, manager.name, assignment.source_manager_name)
      into v_manager_id, v_manager_name
    from public.game_worlds world
    join public.soccer_manager_club_crosswalk crosswalk
      on crosswalk.source_world_id = new.source_world_id and crosswalk.source_club_id = new.source_club_id
    join public.soccer_manager_world_manager_assignments assignment
      on assignment.game_world_id = world.id and assignment.team_id = crosswalk.team_id
    left join public.managers manager on manager.id = assignment.manager_id
    where world.external_world_id = new.source_world_id
    limit 1;
  end if;

  v_manager_name := coalesce(nullif(trim(v_manager_name), ''), 'Unknown manager at ' || new.club_name);
  v_level := (public.transfer_ban_level_at(v_manager_id, v_manager_name, new.starts_on) ->> 'level')::integer;

  insert into public.transfer_ban_history (manager_id, manager_name, club_name, starts_on, ends_on, offence_level, kind, note, ban_id)
  values (v_manager_id, v_manager_name, new.club_name, new.starts_on, new.ends_on, v_level, 'squad_limit', new.reason, new.id)
  on conflict (manager_name, starts_on) do update set ban_id = coalesce(public.transfer_ban_history.ban_id, excluded.ban_id);
  return new;
end;
$$;

revoke all on function public.record_transfer_ban_history() from public, anon, authenticated;

drop trigger if exists record_transfer_ban_history on public.club_transfer_bans;
create trigger record_transfer_ban_history
  after insert on public.club_transfer_bans
  for each row execute function public.record_transfer_ban_history();
