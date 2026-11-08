-- Appointment votes: what is published.
--
-- Rule 3.2 asks the admin team to vote, with reasons, where applicants for the same club are within
-- five points. Admins sometimes also vote on clubs that turn out not to need a vote (an applicant is
-- matched to their first choice elsewhere, or the vote is overtaken by another appointment), and
-- publishing those votes with the decision would be confusing. So:
--   * each vacancy has publish_votes (default on): the admin team can choose, before publishing,
--     whether that club's votes and reasons are published with the decision;
--   * an admin can withdraw their own vote while the decision is unpublished.

alter table public.appointment_vacancies add column if not exists publish_votes boolean not null default true;

create or replace function public.set_appointment_vacancy_votes_published(p_id bigint, p_publish boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can change this.'; end if;
  update public.appointment_vacancies vacancy set publish_votes = coalesce(p_publish, true)
  where vacancy.id = p_id and vacancy.published_at is null;
  if not found then raise exception 'That vacancy is already published.'; end if;
end;
$$;
revoke all on function public.set_appointment_vacancy_votes_published(bigint, boolean) from public, anon;
grant execute on function public.set_appointment_vacancy_votes_published(bigint, boolean) to authenticated;

create or replace function public.withdraw_appointment_vote(p_subject_kind text, p_subject_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can vote.'; end if;
  if p_subject_kind = 'vacancy' and not exists (select 1 from public.appointment_vacancies where id = p_subject_id and published_at is null)
     or p_subject_kind = 'review' and not exists (select 1 from public.appointment_reviews where id = p_subject_id and published_at is null)
     or p_subject_kind not in ('vacancy', 'review') then
    raise exception 'That decision is already published.';
  end if;
  delete from public.appointment_votes vote
  where vote.subject_kind = p_subject_kind and vote.subject_id = p_subject_id and vote.voter = auth.uid();
end;
$$;
revoke all on function public.withdraw_appointment_vote(text, bigint) from public, anon;
grant execute on function public.withdraw_appointment_vote(text, bigint) to authenticated;

-- Published decisions: as defined live (comparison scores stay private, as in
-- 20261031130000_vacancy_comparison_manager.sql), plus a vacancy's votes only when the admin team chose to publish them.
create or replace function public.public_appointment_decisions(p_season integer default null, p_world_slug text default 'top-100')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
begin
  return jsonb_build_object(
    'season', v_season,
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', review.id, 'club', review.club_name, 'division', review.division,
                 'position', review.position, 'manager', review.manager_name, 'decision', review.decision, 'reason', review.decision_reason,
                 'publishedAt', review.published_at,
                 'votes', coalesce((select jsonb_agg(jsonb_build_object('voter', vote.voter_name, 'choice', vote.choice, 'reason', vote.reason))
                           from public.appointment_votes vote where vote.subject_kind = 'review' and vote.subject_id = review.id), '[]'::jsonb))
                 order by review.division, review.position)
               from public.appointment_reviews review
               where review.game_world_id = v_world and review.season = v_season and review.published_at is not null), '[]'::jsonb),
    'vacancies', coalesce((select jsonb_agg(jsonb_build_object('id', vacancy.id, 'club', vacancy.club_name, 'division', vacancy.division,
                   'context', vacancy.context, 'appointed', (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.appointed_manager_id),
                   'reason', vacancy.decision_reason, 'publishedAt', vacancy.published_at,
                   'votes', case when vacancy.publish_votes then coalesce((select jsonb_agg(jsonb_build_object('voter', vote.voter_name, 'choice', vote.choice, 'reason', vote.reason))
                             from public.appointment_votes vote where vote.subject_kind = 'vacancy' and vote.subject_id = vacancy.id), '[]'::jsonb) else '[]'::jsonb end)
                   order by vacancy.division, vacancy.club_name)
                 from public.appointment_vacancies vacancy
                 where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.published_at is not null), '[]'::jsonb),
    'scores', coalesce((select jsonb_object_agg(round.kind, round.result - 'comparisons')
                from public.appointment_rounds round
                where round.game_world_id = v_world and round.season = v_season and round.published_at is not null), '{}'::jsonb)
  );
end;
$$;

revoke all on function public.public_appointment_decisions(integer, text) from public;
grant execute on function public.public_appointment_decisions(integer, text) to anon, authenticated;
