-- Keep the existing All-Manager Poll builder compatible with Shared Voting V2 result visibility.
create or replace function public.create_manager_poll(
  poll_title text,
  poll_description text,
  question_title text,
  option_labels text[],
  closes_at_value timestamptz,
  results_visibility_value text default 'after_close',
  governance_kind_value text default 'advisory',
  quorum_percent_value numeric default 0,
  decision_rule_value text default 'plurality',
  threshold_percent_value numeric default 50,
  tie_policy_value text default 'no_change'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id bigint;
  v_question_id bigint;
  v_label text;
  v_sort integer := 0;
  v_slug text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if nullif(trim(poll_title), '') is null then raise exception 'Poll title is required'; end if;
  if nullif(trim(question_title), '') is null then raise exception 'Question is required'; end if;
  if closes_at_value is null or closes_at_value <= now() then raise exception 'Closing time must be in the future'; end if;
  if coalesce(array_length(option_labels, 1), 0) < 2 then raise exception 'At least two options are required'; end if;
  if results_visibility_value not in ('hidden','after_close','live','manual_release') then raise exception 'Invalid results visibility'; end if;
  if governance_kind_value not in ('advisory','rule_change','appointment','other') then raise exception 'Invalid governance kind'; end if;
  if decision_rule_value not in ('plurality','simple_majority','supermajority') then raise exception 'Invalid decision rule'; end if;
  if tie_policy_value not in ('no_change','admin_decision','runoff') then raise exception 'Invalid tie policy'; end if;
  if quorum_percent_value < 0 or quorum_percent_value > 100 then raise exception 'Quorum must be 0-100'; end if;
  if threshold_percent_value <= 0 or threshold_percent_value > 100 then raise exception 'Threshold must be >0 and <=100'; end if;

  v_slug := regexp_replace(lower(trim(poll_title)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug) || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');

  insert into public.voting_events(
    slug, title, description, event_type, status, closes_at, results_visibility,
    governance_kind, quorum_percent, decision_rule, threshold_percent, tie_policy, created_by
  ) values (
    v_slug, trim(poll_title), nullif(trim(poll_description), ''), 'poll', 'draft', closes_at_value,
    results_visibility_value, governance_kind_value, quorum_percent_value,
    decision_rule_value, threshold_percent_value, tie_policy_value, auth.uid()
  ) returning id into v_event_id;

  insert into public.voting_questions(event_id, title, question_type, required, sort_order)
  values (v_event_id, trim(question_title), 'single_choice', true, 1)
  returning id into v_question_id;

  foreach v_label in array option_labels loop
    if nullif(trim(v_label), '') is not null then
      v_sort := v_sort + 1;
      insert into public.voting_options(question_id, label, value, sort_order)
      values (v_question_id, trim(v_label), trim(v_label), v_sort);
    end if;
  end loop;

  if v_sort < 2 then raise exception 'At least two non-empty options are required'; end if;

  insert into public.voting_audit_log(event_id, actor_user_id, action, details)
  values (v_event_id, auth.uid(), 'event_created', jsonb_build_object(
    'governance_kind', governance_kind_value,
    'decision_rule', decision_rule_value,
    'quorum_percent', quorum_percent_value,
    'threshold_percent', threshold_percent_value,
    'tie_policy', tie_policy_value,
    'results_visibility', results_visibility_value
  ));

  return v_event_id;
end;
$$;

revoke all on function public.create_manager_poll(text,text,text,text[],timestamptz,text,text,numeric,text,numeric,text) from public;
grant execute on function public.create_manager_poll(text,text,text,text[],timestamptz,text,text,numeric,text,numeric,text) to authenticated;
