create or replace function public.manager_portal_claim_suggestions(target_claim_id bigint)
returns table(manager_id bigint, manager_name text, team_id bigint, team_name text, latest_season integer, seed integer, group_code text, score integer, confidence text, reasons text[])
language sql stable security definer
set search_path to 'public', 'extensions'
as $function$
with claim as (
  select c.game_world_id, c.claimed_manager_name, c.claimed_club_name,
    public.normalise_manager_claim_text(c.claimed_manager_name) as claim_manager_key,
    public.canonical_manager_claim_club(c.claimed_club_name) as claim_club_key,
    public.normalise_manager_claim_text(c.claimed_club_name) as claim_club_raw
  from public.manager_portal_claims c
  where c.id = target_claim_id and public.is_admin()
),
current_directory as (
  select m.id as manager_id, coalesce(m.display_name,m.name) as manager_name,
    t.id as team_id, gwc.club_name as team_name, 0 as latest_season,
    null::integer as seed, null::text as group_code,
    public.normalise_manager_claim_text(coalesce(m.display_name,m.name)) as manager_key,
    public.canonical_manager_claim_club(gwc.club_name) as team_key,
    public.normalise_manager_claim_text(gwc.club_name) as team_raw,
    false as alias_exact, cl.claim_manager_key, cl.claim_club_key, cl.claim_club_raw
  from claim cl
  join public.game_world_clubs gwc on gwc.game_world_id=cl.game_world_id and gwc.active and gwc.occupied
  join public.managers m on public.normalise_manager_claim_text(coalesce(m.display_name,m.name)) =
    public.normalise_manager_claim_text(gwc.current_manager_name)
  left join public.teams t on public.canonical_manager_claim_club(t.name)=public.canonical_manager_claim_club(gwc.club_name)
),
history as (
  select te.manager_id, coalesce(m.display_name,m.name) manager_name, te.team_id, t.name team_name,
    coalesce(tr.season_number,0) latest_season, te.seed, te.group_code,
    public.normalise_manager_claim_text(coalesce(m.display_name,m.name)) manager_key,
    public.canonical_manager_claim_club(t.name) team_key, public.normalise_manager_claim_text(t.name) team_raw,
    exists(select 1 from public.manager_team_aliases a where a.team_id=te.team_id and a.alias_key=cl.claim_club_raw) alias_exact,
    cl.claim_manager_key, cl.claim_club_key, cl.claim_club_raw
  from public.tournament_entries te
  join public.managers m on m.id=te.manager_id join public.teams t on t.id=te.team_id
  join public.tournaments tr on tr.id=te.tournament_id cross join claim cl
),
candidates as (select * from current_directory union all select * from history),
scored as (
 select *, (case when manager_key=claim_manager_key then 55 when manager_key like claim_manager_key||' %' then 45 else round(similarity(manager_key,claim_manager_key)*38)::int end)
 + (case when alias_exact then 42 when team_key=claim_club_key then 38 else round(greatest(similarity(team_key,claim_club_key),similarity(team_raw,claim_club_raw))*34)::int end) total_score
 from candidates
 where (manager_key=claim_manager_key or manager_key like claim_manager_key||' %' or similarity(manager_key,claim_manager_key)>=0.28)
 and (alias_exact or team_key=claim_club_key or greatest(similarity(team_key,claim_club_key),similarity(team_raw,claim_club_raw))>=0.28)
),
deduped as (
 select distinct on(manager_id,team_id) * from scored order by manager_id,team_id,total_score desc,latest_season desc
)
select d.manager_id,d.manager_name,d.team_id,d.team_name,d.latest_season,d.seed,d.group_code,
 least(d.total_score,100), case when d.total_score>=92 then 'Very strong' when d.total_score>=78 then 'Likely' else 'Possible' end,
 array_remove(array[
  case when d.manager_key=d.claim_manager_key then 'Exact manager name' end,
  case when d.manager_key like d.claim_manager_key||' %' and d.manager_key<>d.claim_manager_key then 'Shortened manager name' end,
  case when d.alias_exact then 'Known club alias' end,
  case when d.team_key=d.claim_club_key and not d.alias_exact then 'Matching club name' end,
  case when d.team_key<>d.claim_club_key and not d.alias_exact then 'Similar club name' end
 ],null)
from deduped d order by d.total_score desc,d.latest_season desc,d.seed asc nulls last limit 6;
$function$;