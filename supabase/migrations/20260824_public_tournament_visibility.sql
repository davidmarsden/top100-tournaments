-- Make tournament publication state authoritative across the public Data API.
-- Draft tournaments stay private; groups_approved/published/completed/archived
-- tournaments are public only when is_public = true.

alter table public.tournaments
  alter column is_public set default false;

update public.tournaments
set is_public = false
where status = 'draft'
  and is_public is distinct from false;

create or replace function public.tournament_is_public(tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.tournaments t
    where t.id = tournament_id
      and t.is_public = true
      and t.status in ('groups_approved', 'published', 'completed', 'archived')
  );
$$;

revoke all on function public.tournament_is_public(bigint) from public;
grant execute on function public.tournament_is_public(bigint) to anon, authenticated, service_role;

-- Tournament visibility ------------------------------------------------------

drop policy if exists "Public read tournaments" on public.tournaments;
drop policy if exists "Anonymous read public tournaments" on public.tournaments;
drop policy if exists "Authenticated read public tournaments and admins read all" on public.tournaments;

create policy "Anonymous read public tournaments"
on public.tournaments
for select
to anon
using (public.tournament_is_public(id));

create policy "Authenticated read public tournaments and admins read all"
on public.tournaments
for select
to authenticated
using (public.tournament_is_public(id) or public.is_admin());

-- Direct tournament children ------------------------------------------------

drop policy if exists "Public read groups" on public.groups;
drop policy if exists "Anonymous read public groups" on public.groups;
drop policy if exists "Authenticated read public groups and admins read all" on public.groups;
create policy "Anonymous read public groups"
on public.groups for select to anon
using (public.tournament_is_public(tournament_id));
create policy "Authenticated read public groups and admins read all"
on public.groups for select to authenticated
using (public.tournament_is_public(tournament_id) or public.is_admin());

drop policy if exists "Public read tournament_entries" on public.tournament_entries;
drop policy if exists "Anonymous read public tournament entries" on public.tournament_entries;
drop policy if exists "Authenticated read public tournament entries and admins read all" on public.tournament_entries;
create policy "Anonymous read public tournament entries"
on public.tournament_entries for select to anon
using (public.tournament_is_public(tournament_id));
create policy "Authenticated read public tournament entries and admins read all"
on public.tournament_entries for select to authenticated
using (public.tournament_is_public(tournament_id) or public.is_admin());

drop policy if exists "Public read matches" on public.matches;
drop policy if exists "Anonymous read public matches" on public.matches;
drop policy if exists "Authenticated read public matches and admins read all" on public.matches;
create policy "Anonymous read public matches"
on public.matches for select to anon
using (public.tournament_is_public(tournament_id));
create policy "Authenticated read public matches and admins read all"
on public.matches for select to authenticated
using (public.tournament_is_public(tournament_id) or public.is_admin());

drop policy if exists "Public read tournament_round_dates" on public.tournament_round_dates;
drop policy if exists "Anonymous read public tournament round dates" on public.tournament_round_dates;
drop policy if exists "Authenticated read public tournament round dates and admins read all" on public.tournament_round_dates;
create policy "Anonymous read public tournament round dates"
on public.tournament_round_dates for select to anon
using (public.tournament_is_public(tournament_id));
create policy "Authenticated read public tournament round dates and admins read all"
on public.tournament_round_dates for select to authenticated
using (public.tournament_is_public(tournament_id) or public.is_admin());

drop policy if exists "Public read honours" on public.honours;
drop policy if exists "Anonymous read public honours" on public.honours;
drop policy if exists "Authenticated read public honours and admins read all" on public.honours;
create policy "Anonymous read public honours"
on public.honours for select to anon
using (public.tournament_is_public(tournament_id));
create policy "Authenticated read public honours and admins read all"
on public.honours for select to authenticated
using (public.tournament_is_public(tournament_id) or public.is_admin());

-- Forfeits inherit visibility through their parent match ---------------------

drop policy if exists "Public read forfeits" on public.forfeits;
drop policy if exists "Anonymous read public forfeits" on public.forfeits;
drop policy if exists "Authenticated read public forfeits and admins read all" on public.forfeits;

create policy "Anonymous read public forfeits"
on public.forfeits
for select
to anon
using (
  exists (
    select 1
    from public.matches m
    where m.id = forfeits.match_id
      and public.tournament_is_public(m.tournament_id)
  )
);

create policy "Authenticated read public forfeits and admins read all"
on public.forfeits
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.matches m
    where m.id = forfeits.match_id
      and public.tournament_is_public(m.tournament_id)
  )
);

-- Match comments: visible content is public only for public tournaments -------

-- Drop both the original press-room policies and the later hardened variants.
-- Postgres combines permissive policies with OR, so leaving either generation
-- in place would bypass the tournament publication boundary.
drop policy if exists "Public read visible match comments" on public.match_comments;
drop policy if exists "Public publish visible match comments" on public.match_comments;
drop policy if exists "Anonymous read visible match comments" on public.match_comments;
drop policy if exists "Authenticated read visible comments and admins read all" on public.match_comments;
drop policy if exists "Anonymous publish visible match comments" on public.match_comments;
drop policy if exists "Authenticated publish comments and admins insert" on public.match_comments;

create policy "Anonymous read visible comments on public tournaments"
on public.match_comments
for select
to anon
using (
  status = 'visible'
  and public.tournament_is_public(tournament_id)
);

create policy "Authenticated read public comments and admins read all"
on public.match_comments
for select
to authenticated
using (
  public.is_admin()
  or (
    status = 'visible'
    and public.tournament_is_public(tournament_id)
  )
);

create policy "Anonymous publish comments on public tournaments"
on public.match_comments
for insert
to anon
with check (
  public.tournament_is_public(tournament_id)
  and status = 'visible'
  and coalesce(is_pinned, false) = false
  and coalesce(editor_pick, false) = false
  and comment_type in ('pre_match', 'post_match')
  and contribution_type in ('statement', 'question', 'comment')
  and length(trim(manager_name)) between 2 and 80
  and length(trim(comment)) between 3 and 500
);

create policy "Authenticated publish public comments and admins insert"
on public.match_comments
for insert
to authenticated
with check (
  public.is_admin()
  or (
    public.tournament_is_public(tournament_id)
    and status = 'visible'
    and coalesce(is_pinned, false) = false
    and coalesce(editor_pick, false) = false
    and comment_type in ('pre_match', 'post_match')
    and contribution_type in ('statement', 'question', 'comment')
    and length(trim(manager_name)) between 2 and 80
    and length(trim(comment)) between 3 and 500
  )
);

-- Anonymous SECURITY DEFINER RPCs must enforce the same publication boundary --

create or replace function public.get_public_youth_winners()
returns table(
  id bigint,
  honour text,
  honour_position integer,
  tournament_id bigint,
  tournament_name text,
  season_number integer,
  team_name text,
  manager_name text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    h.id,
    h.honour,
    h.position as honour_position,
    h.tournament_id,
    t.name as tournament_name,
    coalesce(t.season_number, 0) as season_number,
    tm.name as team_name,
    coalesce(m.display_name, m.name) as manager_name
  from public.honours h
  join public.tournaments t on t.id = h.tournament_id
  left join public.tournament_entries te on te.id = h.entry_id
  left join public.teams tm on tm.id = te.team_id
  left join public.managers m on m.id = te.manager_id
  where public.tournament_is_public(h.tournament_id)
    and lower(coalesce(h.honour, '')) like '%winner%'
    and (
      lower(coalesce(t.name, '')) like '%youth%'
      or lower(coalesce(h.honour, '')) like '%youth cup%'
      or lower(coalesce(h.honour, '')) like '%youth shield%'
      or lower(coalesce(h.honour, '')) like '%shield winner%'
      or lower(coalesce(h.honour, '')) like '%cup winner%'
    )
  order by coalesce(t.season_number, 0) desc, h.id desc;
$$;

revoke all on function public.get_public_youth_winners() from public;
grant execute on function public.get_public_youth_winners() to anon, authenticated, service_role;

create or replace function public.react_to_match_comment(comment_id bigint, reaction_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if reaction_key not in ('like', 'laugh', 'eyes', 'fire') then
    raise exception 'Invalid reaction';
  end if;

  update public.match_comments
  set reactions = jsonb_set(
    coalesce(reactions, '{}'::jsonb),
    array[reaction_key],
    to_jsonb(coalesce((reactions ->> reaction_key)::int, 0) + 1),
    true
  )
  where id = comment_id
    and status = 'visible'
    and public.tournament_is_public(tournament_id);
end;
$$;

revoke all on function public.react_to_match_comment(bigint, text) from public;
grant execute on function public.react_to_match_comment(bigint, text) to anon, authenticated, service_role;

-- Public route catalogue ------------------------------------------------------

create or replace view public.tournament_public_routes
with (security_invoker = true)
as
select
  t.id,
  t.name,
  t.status,
  t.season_number,
  t.slug,
  t.public_slug,
  t.is_public,
  t.registration_status,
  t.archive_quality,
  gw.name as game_world_name,
  gw.slug as game_world_slug,
  ct.name as competition_name,
  ct.slug as competition_slug,
  '/' || gw.slug || '/' || ct.slug ||
    case when t.public_slug is not null then '/' || t.public_slug else '' end as archive_path,
  '/' || gw.slug || '/' || ct.slug as live_path
from public.tournaments t
join public.game_worlds gw on gw.id = t.game_world_id
join public.competition_types ct on ct.id = t.competition_type_id
where public.tournament_is_public(t.id)
  and (
    t.status not in ('archived', 'completed')
    or t.archive_quality in ('partial', 'complete')
    or coalesce(t.source, '') = 'challonge'
  );

grant select on public.tournament_public_routes to anon, authenticated, service_role;
