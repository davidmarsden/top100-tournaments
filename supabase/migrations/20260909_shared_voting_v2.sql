-- Shared Voting V2
-- Extends the authenticated voting foundation for Awards and other ecosystem consumers.

alter table public.voting_options
  add column if not exists manager_id bigint references public.managers(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.voting_events
  add column if not exists results_released_at timestamptz,
  add column if not exists results_released_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_exported_at timestamptz,
  add column if not exists archive_exported_by uuid references auth.users(id) on delete set null;

alter table public.voting_events
  drop constraint if exists voting_events_results_visibility_check;

alter table public.voting_events
  add constraint voting_events_results_visibility_check
  check (results_visibility in ('hidden','after_close','live','manual_release'));

create index if not exists voting_options_manager_idx on public.voting_options(manager_id);

-- Return the signed-in manager's voting state without requiring clients to know table layout.
create or replace function public.get_my_voting_ballot(target_event_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.manager_portal_accounts%rowtype;
  v_event public.voting_events%rowtype;
  v_ballot public.voting_ballots%rowtype;
  v_eligible boolean := false;
  v_answers jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_event from public.voting_events where id = target_event_id;
  if not found then raise exception 'Voting event not found'; end if;

  select * into v_account
  from public.manager_portal_accounts
  where auth_user_id = auth.uid() and active = true
  limit 1;

  if found then
    select exists(
      select 1 from public.voting_electorate
      where event_id = target_event_id and manager_id = v_account.manager_id
    ) into v_eligible;

    select * into v_ballot
    from public.voting_ballots
    where event_id = target_event_id and manager_id = v_account.manager_id;

    if found then
      select coalesce(jsonb_agg(
        jsonb_build_object('question_id', r.question_id, 'option_id', r.option_id)
        order by r.question_id
      ), '[]'::jsonb)
      into v_answers
      from public.voting_responses r
      where r.ballot_id = v_ballot.id;
    end if;
  end if;

  return jsonb_build_object(
    'event_id', v_event.id,
    'status', v_event.status,
    'opens_at', v_event.opens_at,
    'closes_at', v_event.closes_at,
    'results_visibility', v_event.results_visibility,
    'results_released_at', v_event.results_released_at,
    'eligible', v_eligible,
    'manager_id', case when v_account.id is null then null else v_account.manager_id end,
    'ballot_id', case when v_ballot.id is null then null else v_ballot.id end,
    'submitted_at', v_ballot.submitted_at,
    'updated_at', v_ballot.updated_at,
    'answers', v_answers
  );
end;
$$;

revoke all on function public.get_my_voting_ballot(bigint) from public;
grant execute on function public.get_my_voting_ballot(bigint) to authenticated;

-- Manual release is separate from closing/finalising. This mirrors the Awards Show/Hide Results workflow.
create or replace function public.release_voting_results(target_event_id bigint)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.voting_events%rowtype;
  v_released_at timestamptz := now();
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into v_event from public.voting_events where id = target_event_id for update;
  if not found then raise exception 'Voting event not found'; end if;
  if v_event.status not in ('closed','open') then raise exception 'Only an open/expired or closed event can release results'; end if;
  if v_event.status = 'open' and (v_event.closes_at is null or now() < v_event.closes_at) then
    raise exception 'Voting is still open';
  end if;

  update public.voting_events
  set results_released_at = coalesce(results_released_at, v_released_at),
      results_released_by = coalesce(results_released_by, auth.uid()),
      updated_at = now()
  where id = target_event_id
  returning results_released_at into v_released_at;

  insert into public.voting_audit_log(event_id, actor_user_id, action, details)
  values (target_event_id, auth.uid(), 'results_released', jsonb_build_object('released_at', v_released_at));

  return v_released_at;
end;
$$;

revoke all on function public.release_voting_results(bigint) from public;
grant execute on function public.release_voting_results(bigint) to authenticated;

-- Audited eligibility correction for edge cases discovered after electorate reconciliation.
create or replace function public.add_voting_electorate_member(
  target_event_id bigint,
  target_manager_id bigint,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.voting_events%rowtype;
  v_manager public.managers%rowtype;
  v_account public.manager_portal_accounts%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required'; end if;
  if nullif(trim(reason), '') is null then raise exception 'An audit reason is required'; end if;

  select * into v_event from public.voting_events where id = target_event_id for update;
  if not found then raise exception 'Voting event not found'; end if;
  if v_event.status not in ('draft','open') then raise exception 'Electorate can only be corrected before voting closes'; end if;

  select * into v_manager from public.managers where id = target_manager_id;
  if not found then raise exception 'Manager not found'; end if;

  select * into v_account
  from public.manager_portal_accounts
  where manager_id = target_manager_id and active = true
  order by id
  limit 1;

  insert into public.voting_electorate(event_id, manager_id, manager_account_id, manager_name)
  values (
    target_event_id,
    target_manager_id,
    v_account.id,
    coalesce(nullif(v_manager.display_name, ''), v_manager.name)
  )
  on conflict (event_id, manager_id) do update set
    manager_account_id = excluded.manager_account_id,
    manager_name = excluded.manager_name;

  insert into public.voting_audit_log(event_id, actor_user_id, manager_id, action, details)
  values (
    target_event_id,
    auth.uid(),
    target_manager_id,
    'electorate_member_added',
    jsonb_build_object('reason', trim(reason), 'active_account_found', v_account.id is not null)
  );
end;
$$;

revoke all on function public.add_voting_electorate_member(bigint,bigint,text) from public;
grant execute on function public.add_voting_electorate_member(bigint,bigint,text) to authenticated;

-- Create a multi-question event (notably Awards) from validated JSON configuration.
-- questions_json shape:
-- [{"title":"Division 1 Manager of the Season","description":"...","options":[{"label":"Jane","manager_id":123,"metadata":{"club":"Chelsea"}}]}]
create or replace function public.create_voting_event_from_json(
  event_title text,
  event_description text,
  event_type_value text,
  closes_at_value timestamptz,
  results_visibility_value text,
  questions_json jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id bigint;
  v_question_id bigint;
  v_question jsonb;
  v_option jsonb;
  v_question_sort integer := 0;
  v_option_sort integer;
  v_slug text;
  v_option_count integer;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required'; end if;
  if nullif(trim(event_title), '') is null then raise exception 'Event title is required'; end if;
  if event_type_value not in ('poll','awards','test') then raise exception 'Invalid event type'; end if;
  if results_visibility_value not in ('hidden','after_close','live','manual_release') then raise exception 'Invalid results visibility'; end if;
  if closes_at_value is null or closes_at_value <= now() then raise exception 'Closing time must be in the future'; end if;
  if jsonb_typeof(questions_json) <> 'array' or jsonb_array_length(questions_json) = 0 then raise exception 'At least one question is required'; end if;

  v_slug := regexp_replace(lower(trim(event_title)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug) || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');

  insert into public.voting_events(
    slug, title, description, event_type, status, closes_at, results_visibility, created_by
  ) values (
    v_slug, trim(event_title), nullif(trim(event_description), ''), event_type_value,
    'draft', closes_at_value, results_visibility_value, auth.uid()
  ) returning id into v_event_id;

  for v_question in select value from jsonb_array_elements(questions_json) loop
    v_question_sort := v_question_sort + 1;
    if nullif(trim(v_question->>'title'), '') is null then raise exception 'Every question requires a title'; end if;
    if jsonb_typeof(v_question->'options') <> 'array' then raise exception 'Every question requires an options array'; end if;
    v_option_count := jsonb_array_length(v_question->'options');
    if v_option_count < 2 then raise exception 'Every question requires at least two options'; end if;

    insert into public.voting_questions(event_id, title, description, question_type, required, sort_order)
    values (
      v_event_id,
      trim(v_question->>'title'),
      nullif(trim(v_question->>'description'), ''),
      'single_choice',
      coalesce((v_question->>'required')::boolean, true),
      v_question_sort
    ) returning id into v_question_id;

    v_option_sort := 0;
    for v_option in select value from jsonb_array_elements(v_question->'options') loop
      v_option_sort := v_option_sort + 1;
      if nullif(trim(v_option->>'label'), '') is null then raise exception 'Every option requires a label'; end if;
      insert into public.voting_options(question_id, label, value, sort_order, manager_id, metadata)
      values (
        v_question_id,
        trim(v_option->>'label'),
        coalesce(nullif(trim(v_option->>'value'), ''), trim(v_option->>'label')),
        v_option_sort,
        nullif(v_option->>'manager_id', '')::bigint,
        coalesce(v_option->'metadata', '{}'::jsonb)
      );
    end loop;
  end loop;

  insert into public.voting_audit_log(event_id, actor_user_id, action, details)
  values (v_event_id, auth.uid(), 'event_created', jsonb_build_object(
    'event_type', event_type_value,
    'question_count', v_question_sort,
    'results_visibility', results_visibility_value
  ));

  return v_event_id;
end;
$$;

revoke all on function public.create_voting_event_from_json(text,text,text,timestamptz,text,jsonb) from public;
grant execute on function public.create_voting_event_from_json(text,text,text,timestamptz,text,jsonb) to authenticated;

-- Published result payload for compatibility/archive bridges. Never includes individual ballots.
create or replace function public.get_released_voting_archive(target_event_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.voting_events%rowtype;
  v_questions jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required'; end if;
  select * into v_event from public.voting_events where id = target_event_id;
  if not found then raise exception 'Voting event not found'; end if;
  if v_event.results_released_at is null then raise exception 'Results have not been released'; end if;

  select coalesce(jsonb_agg(question_row order by question_sort), '[]'::jsonb)
  into v_questions
  from (
    select
      q.sort_order as question_sort,
      jsonb_build_object(
        'question_id', q.id,
        'title', q.title,
        'description', q.description,
        'options', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'option_id', o.id,
              'label', o.label,
              'manager_id', o.manager_id,
              'metadata', o.metadata,
              'votes', coalesce(t.votes, 0)
            ) order by o.sort_order, o.id
          ), '[]'::jsonb)
          from public.voting_options o
          left join (
            select r.option_id, count(*)::integer votes
            from public.voting_responses r
            join public.voting_ballots b on b.id = r.ballot_id and b.event_id = target_event_id
            group by r.option_id
          ) t on t.option_id = o.id
          where o.question_id = q.id
        )
      ) as question_row
    from public.voting_questions q
    where q.event_id = target_event_id
  ) rows;

  return jsonb_build_object(
    'event_id', v_event.id,
    'slug', v_event.slug,
    'title', v_event.title,
    'event_type', v_event.event_type,
    'closed_at', v_event.closes_at,
    'results_released_at', v_event.results_released_at,
    'questions', v_questions
  );
end;
$$;

revoke all on function public.get_released_voting_archive(bigint) from public;
grant execute on function public.get_released_voting_archive(bigint) to authenticated;

create or replace function public.mark_voting_archive_exported(target_event_id bigint, note text default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_exported_at timestamptz := now();
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.voting_events where id = target_event_id and results_released_at is not null) then
    raise exception 'Released voting event not found';
  end if;

  update public.voting_events
  set archive_exported_at = v_exported_at, archive_exported_by = auth.uid(), updated_at = now()
  where id = target_event_id;

  insert into public.voting_audit_log(event_id, actor_user_id, action, details)
  values (target_event_id, auth.uid(), 'archive_exported', jsonb_build_object('note', note, 'exported_at', v_exported_at));
  return v_exported_at;
end;
$$;

revoke all on function public.mark_voting_archive_exported(bigint,text) from public;
grant execute on function public.mark_voting_archive_exported(bigint,text) to authenticated;

-- Replace result reader so manual-release events stay hidden until explicitly released.
create or replace function public.get_voting_results(target_event_id bigint)
returns table(question_id bigint, question_title text, option_id bigint, option_label text, votes bigint)
language plpgsql security definer set search_path = public as $$
declare v_event public.voting_events%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_event from public.voting_events where id = target_event_id;
  if not found then raise exception 'Voting event not found'; end if;

  if not public.is_admin() then
    if v_event.results_visibility = 'hidden' then raise exception 'Results are hidden'; end if;
    if v_event.results_visibility = 'manual_release' and v_event.results_released_at is null then raise exception 'Results have not been released'; end if;
    if v_event.results_visibility = 'after_close' and not (v_event.status = 'closed' or (v_event.closes_at is not null and now() >= v_event.closes_at)) then
      raise exception 'Results are not available until voting closes';
    end if;
  end if;

  return query
  select q.id, q.title, o.id, o.label, count(r.ballot_id)::bigint
  from public.voting_questions q
  join public.voting_options o on o.question_id = q.id
  left join public.voting_responses r on r.question_id = q.id and r.option_id = o.id
  where q.event_id = target_event_id
  group by q.id, q.title, q.sort_order, o.id, o.label, o.sort_order
  order by q.sort_order, q.id, o.sort_order, o.id;
end $$;

grant execute on function public.get_voting_results(bigint) to authenticated;
