alter table public.tournaments
  add column if not exists tournament_structure text not null default 'group_knockout';

alter table public.tournaments
  drop constraint if exists tournaments_tournament_structure_check;

alter table public.tournaments
  add constraint tournaments_tournament_structure_check
  check (tournament_structure in ('group_knockout', 'knockout_only'));

update public.tournaments t
set tournament_structure = 'knockout_only',
    group_count = null,
    teams_per_group = null,
    secondary_bracket_name = null
from public.game_worlds gw,
     public.competition_types ct
where t.game_world_id = gw.id
  and t.competition_type_id = ct.id
  and gw.slug = 'regen'
  and ct.slug = 'regen-tournament'
  and t.season_number = 4;
