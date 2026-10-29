-- The Top 100 admin team (officials) can manage community polls as the platform administrator
-- does: create, edit, open, close, finalise and release them, see who has voted, and see the
-- results once voting closes. Only polls (event_type 'poll'); other voting events, such as the
-- awards, stay with the platform administrator.
set check_function_bodies = false;

-- Whether the signed-in user can manage community polls; the voting page asks this.
create or replace function public.can_manage_polls()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_top100_official();
$$;

revoke all on function public.can_manage_polls() from public, anon;
grant execute on function public.can_manage_polls() to authenticated;

-- Whether the signed-in user can manage this voting event: the platform administrator any event,
-- officials community polls only.
create or replace function public.can_manage_voting_event(p_event_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (public.is_top100_official()
        and exists (select 1 from public.voting_events event where event.id = p_event_id and event.event_type = 'poll'));
$$;

revoke all on function public.can_manage_voting_event(bigint) from public, anon, authenticated;

-- @permissions private public.can_manage_voting_event: used only inside the voting functions' own checks

-- The poll functions checked is_admin(); they now check the two functions above. Each check is
-- replaced in the function's current definition, and the migration fails if one isn't found.
do $migration$
declare
  v_change record;
  v_before text;
  v_after text;
begin
  for v_change in
    select * from (values
      ('public.create_manager_poll(text,text,text,text[],timestamptz,text,text,numeric,text,numeric,text)',
       'not public.is_admin()', 'not public.can_manage_polls()'),
      ('public.open_voting_event(bigint)', 'not public.is_admin()', 'not public.can_manage_voting_event(target_event_id)'),
      ('public.close_voting_event(bigint)', 'not public.is_admin()', 'not public.can_manage_voting_event(target_event_id)'),
      ('public.finalise_voting_event(bigint)', 'not public.is_admin()', 'not public.can_manage_voting_event(target_event_id)'),
      ('public.release_voting_results(bigint)', 'not public.is_admin()', 'not public.can_manage_voting_event(target_event_id)'),
      ('public.update_voting_event_text(bigint,text,text)', 'not public.is_admin()', 'not public.can_manage_voting_event(target_event_id)'),
      ('public.update_voting_event_deadline(bigint,timestamptz)', 'not public.is_admin()', 'not public.can_manage_voting_event(target_event_id)'),
      ('public.add_voting_electorate_member(bigint,bigint,text)', 'not public.is_admin()', 'not public.can_manage_voting_event(target_event_id)'),
      ('public.get_voting_participants(bigint)', 'not public.is_admin()', 'not public.can_manage_voting_event(target_event_id)'),
      -- Results: whoever manages the poll sees them once voting closes, like the administrator.
      ('public.get_voting_results(bigint)', 'if public.is_admin() then', 'if public.can_manage_voting_event(target_event_id) then')
    ) as change(signature, old_check, new_check)
  loop
    v_before := pg_get_functiondef(v_change.signature::regprocedure);
    v_after := replace(v_before, v_change.old_check, v_change.new_check);
    if v_after = v_before then
      raise exception 'Expected check "%" not found in %', v_change.old_check, v_change.signature;
    end if;
    execute v_after;
  end loop;
end
$migration$;

-- Officials read every community poll, including drafts, with its questions, options and results.
create policy "Officials read community polls" on public.voting_events
  for select to authenticated
  using (event_type = 'poll' and public.is_top100_official());

create policy "Officials read community poll questions" on public.voting_questions
  for select to authenticated
  using (public.is_top100_official()
         and exists (select 1 from public.voting_events event where event.id = voting_questions.event_id and event.event_type = 'poll'));

create policy "Officials read community poll options" on public.voting_options
  for select to authenticated
  using (public.is_top100_official()
         and exists (select 1 from public.voting_questions question
                     join public.voting_events event on event.id = question.event_id
                     where question.id = voting_options.question_id and event.event_type = 'poll'));

create policy "Officials read community poll results" on public.voting_event_results
  for select to authenticated
  using (public.is_top100_official()
         and exists (select 1 from public.voting_events event where event.id = voting_event_results.event_id and event.event_type = 'poll'));

create policy "Officials read community poll question results" on public.voting_question_results
  for select to authenticated
  using (public.is_top100_official()
         and exists (select 1 from public.voting_events event where event.id = voting_question_results.event_id and event.event_type = 'poll'));
