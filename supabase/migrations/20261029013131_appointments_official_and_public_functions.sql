-- Appointments (rulebook 3.1, 3.2): see 20261029013005_appointments_tables_and_helpers.sql.
-- SQL function bodies depend on Manager Lab objects, so they are not checked here.
set check_function_bodies = false;

-- ── Officials ───────────────────────────────────────────────────────────────

create or replace function public.appointment_admin_overview(p_world_slug text default 'top-100', p_season integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
  v_ids bigint[];
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can manage appointments.'; end if;
  select array_agg(distinct id) into v_ids from (
    select application.manager_id as id from public.appointment_applications application
    where application.game_world_id = v_world and application.season = v_season
    union select review.manager_id from public.appointment_reviews review
    where review.game_world_id = v_world and review.season = v_season and review.manager_id is not null
  ) managers;
  return jsonb_build_object(
    'season', v_season,
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('club', club.club_name, 'division', club.division, 'position', club.position,
               'played', club.played, 'managerId', club.manager_id, 'manager', club.manager_name) order by club.division, club.position)
             from public.appointment_world_managers(v_world) club), '[]'::jsonb),
    'vacancies', coalesce((select jsonb_agg(to_jsonb(vacancy) || jsonb_build_object('appointedManager',
                   (select coalesce(m.display_name, m.name) from public.managers m where m.id = vacancy.appointed_manager_id))
                   order by vacancy.division, vacancy.club_name)
                 from public.appointment_vacancies vacancy where vacancy.game_world_id = v_world and vacancy.season = v_season), '[]'::jsonb),
    'applications', coalesce((select jsonb_agg(to_jsonb(application) || jsonb_build_object(
                     'managerName', club.manager_name, 'club', club.club_name, 'clubDivision', club.division, 'clubPosition', club.position)
                     order by application.submitted_at)
                   from public.appointment_applications application
                   left join lateral (select * from public.appointment_world_managers(v_world) c where c.manager_id = application.manager_id limit 1) club on true
                   where application.game_world_id = v_world and application.season = v_season), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(review) order by review.division, review.position)
                 from public.appointment_reviews review where review.game_world_id = v_world and review.season = v_season), '[]'::jsonb),
    'rounds', coalesce((select jsonb_object_agg(round.kind, to_jsonb(round))
                from public.appointment_rounds round where round.game_world_id = v_world and round.season = v_season), '{}'::jsonb),
    'votes', coalesce((select jsonb_agg(to_jsonb(vote) || jsonb_build_object('mine', vote.voter = auth.uid()) order by vote.created_at)
               from public.appointment_votes vote
               where (vote.subject_kind = 'vacancy' and vote.subject_id in (select id from public.appointment_vacancies where game_world_id = v_world and season = v_season))
                  or (vote.subject_kind = 'review' and vote.subject_id in (select id from public.appointment_reviews where game_world_id = v_world and season = v_season))), '[]'::jsonb),
    'inputs', public.appointment_manager_inputs(v_world, v_season, coalesce(v_ids, '{}'))
  );
end;
$$;

revoke all on function public.appointment_admin_overview(text, integer) from public, anon;
grant execute on function public.appointment_admin_overview(text, integer) to authenticated;

create or replace function public.upsert_appointment_vacancy(
  p_club_name text, p_division integer, p_context text default null, p_closes_at timestamptz default null,
  p_id bigint default null, p_season integer default null, p_world_slug text default 'top-100'
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_id bigint;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can publish vacancies.'; end if;
  if p_id is null then
    insert into public.appointment_vacancies (game_world_id, season, club_name, division, context, closes_at)
    values (v_world, coalesce(p_season, public.appointment_current_season(p_world_slug)), trim(p_club_name), p_division, nullif(trim(p_context), ''), p_closes_at)
    returning id into v_id;
  else
    update public.appointment_vacancies vacancy
    set club_name = trim(p_club_name), division = p_division, context = nullif(trim(p_context), ''), closes_at = p_closes_at
    where vacancy.id = p_id and vacancy.published_at is null
    returning id into v_id;
    if v_id is null then raise exception 'That vacancy is already published.'; end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.upsert_appointment_vacancy(text, integer, text, timestamptz, bigint, integer, text) from public, anon;
grant execute on function public.upsert_appointment_vacancy(text, integer, text, timestamptz, bigint, integer, text) to authenticated;

create or replace function public.set_appointment_vacancy_status(p_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can change vacancies.'; end if;
  if p_status not in ('open', 'closed', 'withdrawn') then raise exception 'Status must be open, closed or withdrawn.'; end if;
  update public.appointment_vacancies vacancy set status = p_status where vacancy.id = p_id and vacancy.published_at is null;
end;
$$;

revoke all on function public.set_appointment_vacancy_status(bigint, text) from public, anon;
grant execute on function public.set_appointment_vacancy_status(bigint, text) to authenticated;

-- Tell every manager with a Manager Portal account that this season's vacancies are open.
create or replace function public.announce_appointment_vacancies(p_season integer default null, p_world_slug text default 'top-100')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
  v_clubs text;
  v_closes timestamptz;
  v_account bigint;
  v_count integer := 0;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can announce vacancies.'; end if;
  select string_agg(vacancy.club_name || ' (D' || vacancy.division || ')', ', ' order by vacancy.division, vacancy.club_name), min(vacancy.closes_at)
  into v_clubs, v_closes
  from public.appointment_vacancies vacancy
  where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.status = 'open';
  if v_clubs is null then raise exception 'There are no open vacancies to announce.'; end if;
  for v_account in select account.id from public.manager_portal_accounts account where account.active and account.manager_id is not null loop
    perform public.enqueue_manager_notification(v_account, 'broadcasts', 'Vacancies open for S' || (v_season + 1),
      'Apply from Manager Portal: ' || v_clubs || coalesce('. Applications close ' || to_char(v_closes at time zone 'Europe/London', 'FMDD Mon HH24:MI'), '') || '.',
      'https://manager.smtop100.blog/appointments',
      'vacancies:' || v_world || ':' || v_season || ':' || md5(v_clubs) || ':' || v_account);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.announce_appointment_vacancies(integer, text) from public, anon;
grant execute on function public.announce_appointment_vacancies(integer, text) to authenticated;

-- The season's bottom three in every division, ready for review (positions already
-- loaded are left as they are).
create or replace function public.load_appointment_reviews(p_season integer default null, p_world_slug text default 'top-100')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
  v_count integer;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can load reviews.'; end if;
  insert into public.appointment_reviews (game_world_id, season, club_name, division, position, manager_id, manager_name)
  select v_world, v_season, club.club_name, club.division, club.position, club.manager_id, club.manager_name
  from public.appointment_world_managers(v_world) club
  where club.position > (select max(other.position) from public.appointment_world_managers(v_world) other where other.division = club.division) - 3
  on conflict (game_world_id, season, club_name) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.load_appointment_reviews(integer, text) from public, anon;
grant execute on function public.load_appointment_reviews(integer, text) to authenticated;

-- Officials' facts for one review: took over mid-season, standing (e.g. the founder at
-- Genoa), last chance from an earlier review, misconduct, inactivity.
create or replace function public.update_appointment_review(p_id bigint, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can update reviews.'; end if;
  update public.appointment_reviews review set
    took_over_mid_season = coalesce((p_fields->>'tookOverMidSeason')::boolean, review.took_over_mid_season),
    standing = case when p_fields ? 'standing' then nullif(trim(p_fields->>'standing'), '') else review.standing end,
    last_chance = coalesce((p_fields->>'lastChance')::boolean, review.last_chance),
    misconduct = case when p_fields ? 'misconduct' then nullif(trim(p_fields->>'misconduct'), '') else review.misconduct end,
    inactive = case when p_fields ? 'inactive' then nullif(trim(p_fields->>'inactive'), '') else review.inactive end
  where review.id = p_id and review.published_at is null;
end;
$$;

revoke all on function public.update_appointment_review(bigint, jsonb) from public, anon;
grant execute on function public.update_appointment_review(bigint, jsonb) to authenticated;

-- Keep the latest scoring of a round; for reviews, record each suggested outcome.
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
  insert into public.appointment_rounds (game_world_id, season, kind, inputs, result, scored_at, scored_by)
  values (v_world, v_season, p_kind, coalesce(p_inputs, '{}'), coalesce(p_result, '{}'), now(), auth.uid())
  on conflict (game_world_id, season, kind) do update
    set inputs = excluded.inputs, result = excluded.result, scored_at = now(), scored_by = auth.uid(), published_at = null;
  if p_kind = 'review' then
    update public.appointment_reviews review set suggested_outcome = scored.value->>'outcome'
    from jsonb_array_elements(coalesce(p_result->'reviews', '[]')) scored
    where review.game_world_id = v_world and review.season = v_season and review.id::text = scored.value->>'key'
      and scored.value->>'outcome' in ('reappoint', 'secondChance', 'anotherClub', 'leave');
  end if;
end;
$$;

revoke all on function public.save_appointment_round(text, jsonb, jsonb, integer, text) from public, anon;
grant execute on function public.save_appointment_round(text, jsonb, jsonb, integer, text) to authenticated;

create or replace function public.cast_appointment_vote(p_subject_kind text, p_subject_id bigint, p_choice text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can vote.'; end if;
  if p_subject_kind = 'vacancy' and not exists (select 1 from public.appointment_vacancies where id = p_subject_id and published_at is null)
     or p_subject_kind = 'review' and not exists (select 1 from public.appointment_reviews where id = p_subject_id and published_at is null)
     or p_subject_kind not in ('vacancy', 'review') then
    raise exception 'That decision is not open for votes.';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Every vote needs a reason.'; end if;
  select coalesce(manager.display_name, manager.name) into v_name
  from public.manager_portal_accounts account join public.managers manager on manager.id = account.manager_id
  where account.auth_user_id = auth.uid() and account.active order by account.id limit 1;
  insert into public.appointment_votes (subject_kind, subject_id, voter, voter_name, choice, reason)
  values (p_subject_kind, p_subject_id, auth.uid(), v_name, trim(p_choice), trim(p_reason))
  on conflict (subject_kind, subject_id, voter) do update set choice = excluded.choice, reason = excluded.reason, updated_at = now();
end;
$$;

revoke all on function public.cast_appointment_vote(text, bigint, text, text) from public, anon;
grant execute on function public.cast_appointment_vote(text, bigint, text, text) to authenticated;

create or replace function public.decide_appointment_vacancy(p_id bigint, p_manager_id bigint, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can decide appointments.'; end if;
  update public.appointment_vacancies vacancy
  set appointed_manager_id = p_manager_id, decision_reason = nullif(trim(p_reason), ''), decided_at = now(),
      status = case when p_manager_id is null then 'closed' else 'decided' end
  where vacancy.id = p_id and vacancy.published_at is null;
end;
$$;

revoke all on function public.decide_appointment_vacancy(bigint, bigint, text) from public, anon;
grant execute on function public.decide_appointment_vacancy(bigint, bigint, text) to authenticated;

create or replace function public.decide_appointment_review(p_id bigint, p_decision text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can decide reviews.'; end if;
  if p_decision is not null and p_decision not in ('reappoint', 'secondChance', 'anotherClub', 'leave') then raise exception 'Unknown decision %', p_decision; end if;
  update public.appointment_reviews review
  set decision = p_decision, decision_reason = nullif(trim(p_reason), ''), decided_at = case when p_decision is null then null else now() end
  where review.id = p_id and review.published_at is null;
end;
$$;

revoke all on function public.decide_appointment_review(bigint, text, text) from public, anon;
grant execute on function public.decide_appointment_review(bigint, text, text) to authenticated;

-- Publish the decided items of a round, with its scores and the votes, and tell each
-- manager concerned.
create or replace function public.publish_appointments(p_kind text, p_season integer default null, p_world_slug text default 'top-100')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world bigint := public.appointment_world_id(p_world_slug);
  v_season integer := coalesce(p_season, public.appointment_current_season(p_world_slug));
  v_row record;
  v_account bigint;
  v_count integer := 0;
  v_label text;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can publish decisions.'; end if;
  if p_kind = 'review' then
    for v_row in
      update public.appointment_reviews review set published_at = now()
      where review.game_world_id = v_world and review.season = v_season and review.decision is not null and review.published_at is null
      returning review.*
    loop
      v_count := v_count + 1;
      v_label := case v_row.decision when 'reappoint' then 'reappointed' when 'secondChance' then 'reappointed on a last chance'
                   when 'anotherClub' then 'not reappointed: you can apply for another club' else 'not reappointed' end;
      for v_account in select account.id from public.manager_portal_accounts account where account.manager_id = v_row.manager_id and account.active loop
        perform public.enqueue_manager_notification(v_account, 'broadcasts', 'Your S' || v_season || ' review: ' || v_row.club_name,
          'You have been ' || v_label || '.' || coalesce(' ' || v_row.decision_reason, ''),
          'https://manager.smtop100.blog/appointments', 'review:' || v_row.id || ':' || v_account);
      end loop;
    end loop;
  elsif p_kind = 'vacancies' then
    for v_row in
      update public.appointment_vacancies vacancy set published_at = now()
      where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.decided_at is not null and vacancy.published_at is null
      returning vacancy.*
    loop
      v_count := v_count + 1;
      for v_account in select account.id from public.manager_portal_accounts account where account.manager_id = v_row.appointed_manager_id and account.active loop
        perform public.enqueue_manager_notification(v_account, 'broadcasts', 'Appointed: ' || v_row.club_name,
          'You have been appointed manager of ' || v_row.club_name || ' for S' || (v_season + 1) || '.',
          'https://manager.smtop100.blog/appointments', 'appointed:' || v_row.id || ':' || v_account);
      end loop;
    end loop;
  else
    raise exception 'Unknown round %', p_kind;
  end if;
  update public.appointment_rounds round set published_at = now()
  where round.game_world_id = v_world and round.season = v_season and round.kind = p_kind;
  return v_count;
end;
$$;

revoke all on function public.publish_appointments(text, integer, text) from public, anon;
grant execute on function public.publish_appointments(text, integer, text) to authenticated;

-- ── Public ──────────────────────────────────────────────────────────────────

-- Published decisions, with the scores they rest on and the officials' votes and reasons.
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
                   'votes', coalesce((select jsonb_agg(jsonb_build_object('voter', vote.voter_name, 'choice', vote.choice, 'reason', vote.reason))
                             from public.appointment_votes vote where vote.subject_kind = 'vacancy' and vote.subject_id = vacancy.id), '[]'::jsonb))
                   order by vacancy.division, vacancy.club_name)
                 from public.appointment_vacancies vacancy
                 where vacancy.game_world_id = v_world and vacancy.season = v_season and vacancy.published_at is not null), '[]'::jsonb),
    'scores', coalesce((select jsonb_object_agg(round.kind, round.result)
                from public.appointment_rounds round
                where round.game_world_id = v_world and round.season = v_season and round.published_at is not null), '{}'::jsonb)
  );
end;
$$;

revoke all on function public.public_appointment_decisions(integer, text) from public;
grant execute on function public.public_appointment_decisions(integer, text) to anon, authenticated;
