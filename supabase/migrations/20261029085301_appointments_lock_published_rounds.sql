-- Appointments: once a round's scores are published they are the evidence for its public
-- decisions, so they can no longer be rescored (or replaced for later decisions).
set check_function_bodies = false;

create or replace function public.save_appointment_round(p_kind text, p_inputs jsonb, p_result jsonb, p_season integer default null, p_world_slug text default 'top-100')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can score appointments.'; end if;
  if p_kind not in ('vacancies', 'review') then raise exception 'Unknown round %', p_kind; end if;
  if exists (select 1 from public.appointment_rounds round
             where round.game_world_id = v_world and round.season = v_season and round.kind = p_kind and round.published_at is not null) then
    raise exception 'These scores are published with the decisions and can no longer be changed.';
  end if;
  insert into public.appointment_rounds (game_world_id, season, kind, inputs, result, scored_at, scored_by)
  values (v_world, v_season, p_kind, coalesce(p_inputs, '{}'), coalesce(p_result, '{}'), now(), auth.uid())
  on conflict (game_world_id, season, kind) do update
    set inputs = excluded.inputs, result = excluded.result, scored_at = now(), scored_by = auth.uid()
    where public.appointment_rounds.published_at is null;
  if p_kind = 'review' then
    update public.appointment_reviews review set suggested_outcome = scored.value->>'outcome'
    from jsonb_array_elements(coalesce(p_result->'reviews', '[]')) scored
    where review.game_world_id = v_world and review.season = v_season and review.id::text = scored.value->>'key'
      and review.published_at is null
      and scored.value->>'outcome' in ('reappoint', 'secondChance', 'anotherClub', 'leave');
  end if;
end;
$$;

revoke all on function public.save_appointment_round(text, jsonb, jsonb, integer, text) from public, anon;
grant execute on function public.save_appointment_round(text, jsonb, jsonb, integer, text) to authenticated;
