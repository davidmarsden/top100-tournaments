-- Open vacancies for the Top 100 Chat announcement (netlify/functions/chat-appointments.mjs).
-- Server-only: the scheduled function reads it with the service role and posts each newly
-- opened vacancy once. Managers see vacancies in Manager Portal as before.

create or replace function public.chat_open_vacancies(p_world_slug text default 'top-100')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', vacancy.id,
    'season', vacancy.season,
    'club', vacancy.club_name,
    'division', vacancy.division,
    'context', vacancy.context,
    'closesAt', vacancy.closes_at,
    'createdAt', vacancy.created_at
  ) order by vacancy.division, vacancy.club_name), '[]'::jsonb)
  from public.appointment_vacancies vacancy
  join public.game_worlds world on world.id = vacancy.game_world_id
  where world.slug = coalesce(p_world_slug, 'top-100')
    and vacancy.status = 'open';
$$;

revoke all on function public.chat_open_vacancies(text) from public, anon, authenticated;
grant execute on function public.chat_open_vacancies(text) to service_role;
