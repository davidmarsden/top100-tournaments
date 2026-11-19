-- The rules check, widened for new and prospective managers, applicants and anyone after a rule
-- break (manager.smtop100.blog/rules-check). Passing is not required for anything yet.
--
-- 1. A bigger question bank in two sections: "squad" (the squad limit, loans and transfers, rules 4
--    and 5) and "general" (activity, Gold, vacancies, reappointment, the waiting list, the Youth
--    Cup and asking first, rules 1, 3 and 6). Each attempt draws 6 squad and 4 general questions.
-- 2. submit_rules_check marks the questions answered: they must be real questions, at least 6
--    squad and 4 general, and all right to pass.
-- 3. rules_check_results(): officials only. Each person who has tried it: their Manager Portal
--    manager, waiting-list entries, attempts and when they last passed, for the waiting list,
--    applications and reappointment reviews.
-- 4. A new transfer ban sends the banned manager a Manager Portal notice suggesting the check.

create or replace function public.rules_check_bank()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '[
    {"id": "limit", "section": "squad", "rule": "4.1", "question": "What is the most players a Top 100 club may have in its squad?",
     "options": ["45", "50", "55", "As many as Soccer Manager allows"], "answer": 1,
     "why": "Rule 4.1: a club may have a maximum of 50 players associated with its squad."},
    {"id": "loans", "section": "squad", "rule": "4.2", "question": "You loan a player out to another club. Does he still count towards your 50?",
     "options": ["No, only the club he is on loan at counts him", "Yes: loans count in both directions", "Only if the loan is longer than a month"], "answer": 1,
     "why": "Rule 4.2: a player loaned to your club counts, and a player loaned out from your club also counts. A loan never creates an extra squad place."},
    {"id": "briefly", "section": "squad", "rule": "4.1", "question": "You sign a player that takes you to 51, planning to sell someone before the next transfer turn. Is that allowed?",
     "options": ["Yes, as long as you are back to 50 by the next turn", "No: the limit applies at all times, and going over even briefly is a breach", "Yes, if you tell the admin team first"], "answer": 1,
     "why": "Rule 4.1: the limit applies at all times, including between transfer turns. Sell first, then sign."},
    {"id": "sm-enforces", "section": "squad", "rule": "4.1", "question": "Will Soccer Manager stop you going over 50 players?",
     "options": ["Yes, it blocks the 51st signing", "No: Soccer Manager does not enforce it, so keeping within 50 is the manager''s responsibility"], "answer": 1,
     "why": "Rule 4.1: Soccer Manager''s own squad setting does not enforce the limit. Managers are responsible for keeping their squad compliant."},
    {"id": "ban-terms", "section": "squad", "rule": "4.1", "question": "During a squad-limit transfer ban, which deals are allowed?",
     "options": ["None at all", "Cash sales to clubs outside Top 100 only", "Any sale, but no signings", "Swaps with other Top 100 managers"], "answer": 1,
     "why": "Rule 4.1: during the ban the only permitted deals are cash sales to clubs outside Top 100."},
    {"id": "the-signing", "section": "squad", "rule": "4.1", "question": "What happens to the signing that took your squad over 50?",
     "options": ["Nothing, once you are back to 50", "He must be sold for cash to a club outside Top 100 once his own transfer ban ends, and you can never bid for him again", "He must be released"], "answer": 1,
     "why": "Rule 4.1: the signing that took the squad over 50 is sold for cash to a club outside Top 100 once that player''s own transfer ban ends, and the club may not bid for him again."},
    {"id": "ladder", "section": "squad", "rule": "4.1", "question": "You finished a one-month ban two months ago and go over 50 again. What ban should you expect?",
     "options": ["Another one-month ban", "A three-month ban: a second level offence", "A warning only"], "answer": 1,
     "why": "Rule 4.1: each offence moves you up a level (one month, then three, four and six). Only six months clean after a ban ends moves you back down a level."},
    {"id": "new-players", "section": "squad", "rule": "5.4", "question": "A new player is added to the Soccer Manager database. What is the most you may bid?",
     "options": ["£1m, in a public cash bid", "£5m, in any kind of bid", "Any amount, as long as the bid is public"], "answer": 0,
     "why": "Rule 5.4: bids for newly added players must be public, cash only, and no more than £1,000,000."},
    {"id": "binding", "section": "squad", "rule": "5.1", "question": "You agree a deal with another manager, then a better offer arrives. Can you pull out?",
     "options": ["Yes, until the transfer completes", "No: an unambiguous agreement between managers is binding", "Yes, within 24 hours"], "answer": 1,
     "why": "Rule 5.1: once both managers have clearly agreed a deal, neither should withdraw because a better offer appears."},
    {"id": "mistake", "section": "squad", "rule": "5.2", "question": "You make a genuine mistake on a system bid, with no deal agreed beforehand. How long do you have to cancel it?",
     "options": ["Five minutes", "An hour", "Until the next transfer turn", "You can''t cancel it"], "answer": 0,
     "why": "Rule 5.2: a five-minute grace period applies to a genuine mistake on a system bid where there was no prior agreement. It is for mistakes, not second thoughts."},
    {"id": "device", "section": "squad", "rule": "5.5", "question": "Can you route a player through another club to get round a transfer ban or the squad limit?",
     "options": ["Yes, if the other manager agrees", "No: using another club as a device to evade a rule is not allowed", "Yes, for loans only"], "answer": 1,
     "why": "Rule 5.5: managers must not use another club as a device to evade a transfer restriction, squad rule or transfer ban. If a deal may be a grey area, ask the administrators first."},
    {"id": "gold", "section": "general", "rule": "3.2", "question": "Do you need Gold membership to manage a Top 100 club?",
     "options": ["No, it is optional", "Yes: every Top 100 manager must be a Gold member", "Only in Division 1"], "answer": 1,
     "why": "Rules 3.1 and 3.2: every Top 100 manager must be a Gold member, as every new manager joining is. Without it you can''t apply for a club or be reappointed."},
    {"id": "inactive", "section": "general", "rule": "3.1", "question": "Which of these counts as inactive, so a bottom-three manager is never reappointed?",
     "options": ["Losing heavily in a few games", "Two or more spells of seven days or more without logging in during the season", "Not posting on the newsfeed"], "answer": 1,
     "why": "Rule 3.1: logging in irregularly (two or more spells of seven days or more without logging in), being removed by Soccer Manager, not responding to the administrators or to fixture requests, or not setting teams all count as inactive."},
    {"id": "ban-counts", "section": "general", "rule": "3.1", "question": "You finish in the bottom three after a transfer ban during the season. Does the ban count against you at the review?",
     "options": ["No, the ban was the punishment", "Yes: a sanction during the season is one of the clear and obvious errors", "Only if it was a six-month ban"], "answer": 1,
     "why": "Rule 3.1: a sanction during the season, such as a transfer ban, is one of the clear and obvious errors weighed at a bottom-three review. Two or more and the manager is not reappointed."},
    {"id": "apply-banned", "section": "general", "rule": "3.2", "question": "You are serving a transfer ban when a vacancy you want is published. Can you apply?",
     "options": ["Yes", "No: an applicant serving a transfer ban or another open sanction is not eligible", "Only for a club in a lower division"], "answer": 1,
     "why": "Rule 3.2: an applicant is not eligible while serving a transfer ban or another open sanction."},
    {"id": "apply-season", "section": "general", "rule": "3.2", "question": "You took over your club this season. Can you apply for a vacant club?",
     "options": ["Yes, any time", "No: you must be in at least your second season at your current club", "Only if you finished in the top half"], "answer": 1,
     "why": "Rule 3.2: an applicant must be in at least their second season at their current club."},
    {"id": "confirm-offer", "section": "general", "rule": "3.2", "question": "You are offered a club in a vacancy round. How long do you have to confirm?",
     "options": ["24 hours", "A week", "Until the next season starts"], "answer": 0,
     "why": "Rule 3.2: an appointment is offered to the manager, who confirms within 24 hours. If you decline or don''t confirm in time, you stay at your current club."},
    {"id": "two-worlds", "section": "general", "rule": "3.3", "question": "Can you manage a club in Top 100 and one in Top 100 Regen at the same time?",
     "options": ["No, you must choose one", "Yes: one club in each game world", "Only for one season"], "answer": 1,
     "why": "Rule 3.3: you can manage one club in each game world. Taking a Top 100 club doesn''t mean giving up your Top 100 Regen club."},
    {"id": "waiting-confirm", "section": "general", "rule": "3.3", "question": "What must you do to keep your place on the waiting list?",
     "options": ["Nothing, it lasts for ever", "Confirm once a season that you are still interested", "Post on the newsfeed every month"], "answer": 1,
     "why": "Rule 3.3: confirm once a season that you are still interested, or your place lapses."},
    {"id": "youth-cup", "section": "general", "rule": "6", "question": "For a Saturday Youth Cup fixture, who sends the friendly request, and by when?",
     "options": ["The away manager, by Friday", "The home manager, promptly and no later than Wednesday", "Whoever remembers, any time before kick-off"], "answer": 1,
     "why": "Rule 6: the home manager sends the request promptly and no later than Wednesday; the away manager checks and chases before Wednesday if none has arrived."},
    {"id": "ask-first", "section": "general", "rule": "1", "question": "You spot what looks like a loophole in the rules. What should you do?",
     "options": ["Use it before someone else does", "Ask the administrators before acting", "Use it, then tell the administrators"], "answer": 1,
     "why": "Rules 1 and 5.5: don''t exploit loopholes or ambiguity. If something is unclear, ask before acting rather than relying on an assumed loophole."}
  ]'::jsonb;
$$;

revoke all on function public.rules_check_bank() from public, anon, authenticated;

-- Six squad and four general questions, drawn at random; squad questions first.
create or replace function public.rules_check_questions()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with drawn as (
    select q, q->>'section' as section,
      row_number() over (partition by q->>'section' order by random()) as pick
    from jsonb_array_elements(public.rules_check_bank()) q
  )
  select jsonb_agg(q - 'answer' - 'why' order by section desc, pick)
  from drawn
  where (section = 'squad' and pick <= 6) or (section = 'general' and pick <= 4);
$$;

revoke all on function public.rules_check_questions() from public, anon;
grant execute on function public.rules_check_questions() to authenticated;

create or replace function public.submit_rules_check(p_answers jsonb, p_world_slug text default 'top-100')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_total integer;
  v_score integer;
  v_squad integer;
  v_general integer;
  v_unknown integer;
  v_wrong jsonb;
  v_passed boolean;
  v_ban public.club_transfer_bans;
  v_ends_on date;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'Answers must be an object of question id to option number.'; end if;
  select * into v_me from public.rules_check_my_club(p_world_slug);

  select count(*) into v_unknown
  from jsonb_object_keys(p_answers) answered(id)
  where not exists (select 1 from jsonb_array_elements(public.rules_check_bank()) q where q->>'id' = answered.id);
  if v_unknown > 0 then raise exception 'Some answers are for questions that are not in the rules check. Reload the page and try again.'; end if;

  -- Mark the questions answered (each attempt is a random draw from the bank).
  select count(*),
    count(*) filter (where (p_answers->>(q->>'id')) = (q->>'answer')),
    count(*) filter (where q->>'section' = 'squad'),
    count(*) filter (where q->>'section' = 'general'),
    coalesce(jsonb_agg(jsonb_build_object('id', q->>'id', 'rule', q->>'rule', 'why', q->>'why'))
      filter (where (p_answers->>(q->>'id')) is distinct from (q->>'answer')), '[]'::jsonb)
  into v_total, v_score, v_squad, v_general, v_wrong
  from jsonb_array_elements(public.rules_check_bank()) q
  where p_answers ? (q->>'id');
  if v_squad < 6 or v_general < 4 then raise exception 'Answer every question in the check (reload the page if some are missing).'; end if;
  v_passed := v_score = v_total;

  insert into public.rules_check_attempts (auth_user_id, manager_id, score, total, passed, answers)
  values (auth.uid(), v_me.manager_id, v_score, v_total, v_passed, p_answers);

  -- A pass applies every reduction the administrators offered on the manager's club's bans
  -- (a club can have more than one ban in force), logging each for the admin team.
  if v_passed and v_me.source_club_id is not null then
    for v_ban in
      update public.club_transfer_bans ban
         set ends_on = least(ban.ends_on, ban.reduced_ends_on), reduced_at = now(), reduce_condition = null
       where ban.source_world_id = v_me.source_world_id and ban.source_club_id = v_me.source_club_id
         and ban.reduce_condition = 'rules_check' and ban.reduced_ends_on is not null and ban.ends_on >= current_date
      returning *
    loop
      v_ends_on := greatest(v_ends_on, v_ban.ends_on);
      insert into public.compliance_events (source_club_id, club_name, kind, severity, title, body, related, dedupe_key)
      values (v_ban.source_club_id, v_ban.club_name, 'ban_reduced', 'info',
        'Rules check passed: ' || v_ban.club_name || ' ban shortened',
        coalesce(v_me.manager_name, 'The manager') || ' passed the rules check, so the transfer ban now ends on '
          || to_char(v_ban.ends_on, 'FMDD Mon YYYY') || '.',
        jsonb_build_object('ban_id', v_ban.id, 'ends_on', v_ban.ends_on),
        'ban-reduced:' || v_ban.id)
      on conflict (dedupe_key) do nothing;
    end loop;
  end if;

  return jsonb_build_object('score', v_score, 'total', v_total, 'passed', v_passed, 'wrong', v_wrong,
    'banEndsOn', v_ends_on);
end;
$$;

revoke all on function public.submit_rules_check(jsonb, text) from public, anon;
grant execute on function public.submit_rules_check(jsonb, text) to authenticated;

-- Everyone who has tried the check, for the admin pages.
create or replace function public.rules_check_results()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_top100_official() then null else coalesce((
    select jsonb_agg(jsonb_build_object(
      'authUserId', person.auth_user_id,
      'managerId', coalesce(person.manager_id, account.manager_id),
      'waitingEntryIds', coalesce((select jsonb_agg(entry.id) from public.waiting_list_entries entry where entry.auth_user_id = person.auth_user_id), '[]'::jsonb),
      'attempts', person.attempts,
      'passedAt', person.passed_at,
      'lastAt', person.last_at))
    from (
      select attempt.auth_user_id, max(attempt.manager_id) as manager_id, count(*) as attempts,
        max(attempt.created_at) filter (where attempt.passed) as passed_at, max(attempt.created_at) as last_at
      from public.rules_check_attempts attempt
      group by attempt.auth_user_id
    ) person
    left join lateral (
      select account.manager_id from public.manager_portal_accounts account
      where account.auth_user_id = person.auth_user_id and account.active and account.manager_id is not null
      order by account.updated_at desc nulls last limit 1
    ) account on true), '[]'::jsonb) end;
$$;

revoke all on function public.rules_check_results() from public, anon;
grant execute on function public.rules_check_results() to authenticated;

-- A new transfer ban: suggest the rules check to the banned manager in the Manager Portal.
-- Runs after record_transfer_ban_history (triggers fire in name order), which names the manager.
create or replace function public.suggest_rules_check_after_ban()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account bigint;
begin
  select account.id into v_account
  from public.transfer_ban_history history
  join public.manager_portal_accounts account on account.manager_id = history.manager_id and account.active
  left join public.game_worlds world on world.id = account.game_world_id
  where history.ban_id = new.id
  -- The manager's account in the banned club's game world, if they have one there.
  order by (world.external_world_id = new.source_world_id) desc nulls last, account.updated_at desc nulls last
  limit 1;
  if v_account is null then return new; end if;

  perform public.enqueue_manager_notification(v_account, 'admin_alerts',
    'Take the Top 100 rules check',
    'After a transfer ban, take the short rules check on the squad limit, transfers and how Top 100 is run. '
      || 'It takes a few minutes and you can retake it until you pass.',
    'https://manager.smtop100.blog/rules-check',
    'rules-check-after-ban:' || new.id);
  return new;
end;
$$;

revoke all on function public.suggest_rules_check_after_ban() from public, anon, authenticated;

drop trigger if exists suggest_rules_check_after_ban on public.club_transfer_bans;
create trigger suggest_rules_check_after_ban
  after insert on public.club_transfer_bans
  for each row execute function public.suggest_rules_check_after_ban();
