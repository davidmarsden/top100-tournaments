create or replace function public.manager_lab_opponent_players(target_setup_id text default '239138')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Global admin access required';
  end if;
  if target_setup_id is null or target_setup_id !~ '^[0-9]+$' then
    raise exception 'Soccer Manager setup id must be numeric';
  end if;

  with world as (
    select id from public.game_worlds
    where external_world_id::text = target_setup_id
    limit 1
  ),
  rows as (
    select p.current_source_club_id as source_club_id, p.source_player_id, p.name, p.age, p.rating,
      p.position, p.main_position, p.appearances, p.substitute_appearances, p.average_performance,
      p.goals, p.assists, p.career_appearances, p.career_average_performance, p.career_goals,
      p.career_assists, p.rating_change, p.transfer_listed
    from public.soccer_manager_players p
    join world w on w.id = p.game_world_id
    where p.current_source_club_id is not null
  )
  select jsonb_build_object('players', coalesce(jsonb_agg(jsonb_build_object(
    'sourceClubId', source_club_id, 'sourcePlayerId', source_player_id, 'name', name, 'age', age,
    'rating', rating, 'position', position, 'mainPosition', main_position, 'appearances', appearances,
    'substituteAppearances', substitute_appearances, 'averagePerformance', average_performance,
    'goals', goals, 'assists', assists, 'careerAppearances', career_appearances,
    'careerAveragePerformance', career_average_performance, 'careerGoals', career_goals,
    'careerAssists', career_assists, 'ratingChange', rating_change, 'transferListed', transfer_listed
  ) order by source_club_id, rating desc nulls last, name), '[]'::jsonb))
  into result from rows;

  return result;
end;
$$;

revoke all on function public.manager_lab_opponent_players(text) from public, anon;
grant execute on function public.manager_lab_opponent_players(text) to authenticated, service_role;
