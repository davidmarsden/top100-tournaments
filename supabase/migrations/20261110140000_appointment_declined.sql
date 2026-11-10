-- An appointee who declines a published appointment (rule 3.2: an appointment is offered to the
-- manager, who confirms within 24 hours). The decision stays published, as a record of what happened,
-- but the club is no longer filled: the public page shows who declined and when, the profile card and
-- Chat announcement no longer apply, and the club can be advertised again in the next round.
--
-- record_appointment_declined(p_id, p_note) (officials only): for a published vacancy with an
-- appointee, moves the appointee to declined_manager_id, records when and an optional note, and
-- clears appointed_manager_id.

alter table public.appointment_vacancies
  add column if not exists declined_at timestamptz,
  add column if not exists declined_manager_id bigint references public.managers(id),
  add column if not exists declined_note text check (declined_note is null or length(declined_note) <= 500);

create or replace function public.record_appointment_declined(p_id bigint, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy public.appointment_vacancies;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can record a declined appointment.'; end if;
  select * into v_vacancy from public.appointment_vacancies where id = p_id for update;
  if v_vacancy.id is null then raise exception 'No such vacancy.'; end if;
  if v_vacancy.published_at is null then raise exception 'Only a published appointment can be declined. Change the team decision instead.'; end if;
  if v_vacancy.appointed_manager_id is null then raise exception 'This vacancy has no appointee to decline it.'; end if;
  update public.appointment_vacancies
  set declined_manager_id = appointed_manager_id, declined_at = now(), declined_note = nullif(trim(p_note), ''),
      appointed_manager_id = null
  where id = p_id;
end;
$$;
revoke all on function public.record_appointment_declined(bigint, text) from public, anon;
grant execute on function public.record_appointment_declined(bigint, text) to authenticated;

-- One published vacancy as the public sees it, now with any declined appointment.
create or replace function public.appointment_public_vacancy(vacancy public.appointment_vacancies)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', vacancy.id, 'club', vacancy.club_name, 'division', vacancy.division,
    'context', vacancy.context, 'appointed', (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.appointed_manager_id),
    'reason', vacancy.decision_reason, 'publishedAt', vacancy.published_at,
    'declined', (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.declined_manager_id),
    'declinedAt', vacancy.declined_at, 'declinedNote', vacancy.declined_note,
    'votes', case when vacancy.publish_votes then coalesce((select jsonb_agg(jsonb_build_object('voter', vote.voter_name, 'choice', vote.choice, 'reason', vote.reason))
                  from public.appointment_votes vote where vote.subject_kind = 'vacancy' and vote.subject_id = vacancy.id), '[]'::jsonb)
                  else '[]'::jsonb end);
$$;

-- @permissions private public.appointment_public_vacancy(public.appointment_vacancies): used only inside public_appointment_decisions()
revoke all on function public.appointment_public_vacancy(public.appointment_vacancies) from public, anon, authenticated;
