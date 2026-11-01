-- Game World honours from Soccer Manager (club-ajax-mobile.php?action=GWHistory):
-- every competition's winning club and manager per season (divisions, play-offs,
-- Charity Shield, Top 100 Cup and Shield, SMFA cups). Collected by Sync
-- everything and saved here; the archive's Honours tab reads them through
-- public_game_world_honours() in place of the winners sheet.

create table if not exists public.soccer_manager_world_honours (
  game_world_id bigint not null references public.game_worlds(id) on delete cascade,
  season_num integer not null check (season_num between 1 and 9999),
  competition text not null,
  display_order integer not null default 0,
  season_source_id text,
  club_source_id text,
  club_name text,
  manager_source_id text,
  manager_name text,
  captured_at timestamptz not null default now(),
  primary key (game_world_id, season_num, competition)
);

comment on table public.soccer_manager_world_honours is
  'Competition winners per season from Soccer Manager GWHistory. Written only by save_soccer_manager_world_honours(); read publicly through public_game_world_honours().';

alter table public.soccer_manager_world_honours enable row level security;
revoke all on public.soccer_manager_world_honours from anon, authenticated;

drop policy if exists "Admins read world honours" on public.soccer_manager_world_honours;
create policy "Admins read world honours" on public.soccer_manager_world_honours
  for select to authenticated using ((select public.is_admin()));
grant select on public.soccer_manager_world_honours to authenticated;

-- Saves the honours of the seasons given. Each season's list replaces what was
-- stored for it (competitions are decided during a season, and the game's list
-- is authoritative); a season sent with no honours leaves its stored rows alone.
create or replace function public.save_soccer_manager_world_honours(
  target_setup_id text,
  target_seasons jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_id text := nullif(trim(target_setup_id), '');
  v_world_id bigint;
  v_season jsonb;
  v_season_num integer;
  v_rows integer := 0;
  v_seasons integer := 0;
  v_inserted integer;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if setup_id is null or setup_id !~ '^[0-9]+$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;
  if jsonb_typeof(target_seasons) is distinct from 'array' then
    raise exception 'target_seasons must be an array';
  end if;
  if jsonb_array_length(target_seasons) > 60 then
    raise exception 'Save at most 60 seasons per call';
  end if;

  select id into v_world_id from public.game_worlds where external_world_id = setup_id::bigint order by id limit 1;
  if v_world_id is null then
    raise exception 'No archived Soccer Manager world %', setup_id;
  end if;

  for v_season in select value from jsonb_array_elements(target_seasons) loop
    v_season_num := case when coalesce(v_season->>'seasonNum', '') ~ '^[0-9]{1,4}$' then (v_season->>'seasonNum')::integer end;
    if v_season_num is null or v_season_num < 1 then continue; end if;
    if jsonb_typeof(v_season->'honours') is distinct from 'array' or jsonb_array_length(v_season->'honours') = 0 then continue; end if;
    if jsonb_array_length(v_season->'honours') > 60 then
      raise exception 'Season % has more than 60 honours', v_season_num;
    end if;

    delete from public.soccer_manager_world_honours where game_world_id = v_world_id and season_num = v_season_num;

    insert into public.soccer_manager_world_honours
      (game_world_id, season_num, competition, display_order, season_source_id, club_source_id, club_name, manager_source_id, manager_name, captured_at)
    select distinct on (competition)
      v_world_id, v_season_num, competition, display_order,
      nullif(trim(v_season->>'seasonId'), ''),
      club_source_id, club_name, manager_source_id, manager_name, now()
    from (
      select
        left(nullif(trim(item.value->>'competition'), ''), 120) as competition,
        item.ordinality::integer as display_order,
        case when coalesce(item.value->>'clubId', '') ~ '^[0-9]{1,20}$' then item.value->>'clubId' end as club_source_id,
        left(nullif(trim(item.value->>'clubName'), ''), 160) as club_name,
        case when coalesce(item.value->>'managerId', '') ~ '^[0-9]{1,20}$' then item.value->>'managerId' end as manager_source_id,
        left(nullif(trim(item.value->>'managerName'), ''), 160) as manager_name
      from jsonb_array_elements(v_season->'honours') with ordinality item
    ) parsed
    where competition is not null and (club_name is not null or manager_name is not null)
    order by competition, display_order;

    get diagnostics v_inserted = row_count;
    v_rows := v_rows + v_inserted;
    v_seasons := v_seasons + 1;
  end loop;

  return jsonb_build_object('seasons', v_seasons, 'honours', v_rows);
end;
$$;

revoke all on function public.save_soccer_manager_world_honours(text, jsonb) from public, anon;
grant execute on function public.save_soccer_manager_world_honours(text, jsonb) to authenticated, service_role;

create or replace function public.public_game_world_honours(p_world_slug text default 'top-100')
returns table (
  season_num integer,
  competition text,
  display_order integer,
  club_name text,
  manager_name text,
  club_source_id text,
  manager_source_id text,
  captured_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select h.season_num, h.competition, h.display_order, h.club_name, h.manager_name,
         h.club_source_id, h.manager_source_id, h.captured_at
  from public.soccer_manager_world_honours h
  join public.game_worlds w on w.id = h.game_world_id
  where w.slug = coalesce(nullif(trim(p_world_slug), ''), 'top-100')
  order by h.season_num desc, h.display_order;
$$;

revoke all on function public.public_game_world_honours(text) from public;
grant execute on function public.public_game_world_honours(text) to anon, authenticated, service_role;
