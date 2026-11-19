-- Rules check: a short multiple-choice check on the squad limit and transfer rules, in the
-- Manager Portal (manager.smtop100.blog/rules-check).
--
-- The administrators can offer a banned manager a shorter ban for passing it: the ban's
-- reduced_ends_on is the end date they'll get, and reduce_condition = 'rules_check'. Passing
-- shortens the ban automatically and tells the admin team, so nobody has to remember.
--
-- rules_check_questions(): the questions and options, without the answers.
-- submit_rules_check(answers): marks the answers on the server (every answer must be right to
--   pass), records the attempt and, on a pass, applies any reduction offered to the manager's club.
-- my_rules_check(): the manager's last pass and any reduction on offer.
-- offer_ban_reduction(ban, ends_on): officials only.

-- The Sync tables come from Manager Lab's migrations, so SQL function bodies are not checked here.
set check_function_bodies = false;

alter table public.club_transfer_bans add column if not exists reduced_ends_on date;
alter table public.club_transfer_bans add column if not exists reduce_condition text check (reduce_condition in ('rules_check'));
alter table public.club_transfer_bans add column if not exists reduced_at timestamptz;

-- Passing the rules check can shorten a ban; that's logged with the other ruling follow-up.
alter table public.compliance_events drop constraint if exists compliance_events_kind_check;
alter table public.compliance_events add constraint compliance_events_kind_check
  check (kind in ('cap_cleared', 'ban_breach', 'obligation_met', 'obligation_breached', 'rebid', 'ban_reduced'));

create table if not exists public.rules_check_attempts (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null default auth.uid(),
  manager_id bigint references public.managers(id),
  score integer not null,
  total integer not null,
  passed boolean not null,
  answers jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists rules_check_attempts_user_idx on public.rules_check_attempts (auth_user_id, created_at desc);

alter table public.rules_check_attempts enable row level security;

drop policy if exists "Officials read rules check attempts" on public.rules_check_attempts;
create policy "Officials read rules check attempts" on public.rules_check_attempts
  for select to authenticated using (public.is_top100_official());

revoke all on public.rules_check_attempts from anon, authenticated;
grant select on public.rules_check_attempts to authenticated;

-- The question bank: id, question, options, the right option and why (from the published rules).
-- @permissions private public.rules_check_bank(): holds the answers; read only by rules_check_questions() and submit_rules_check()
create or replace function public.rules_check_bank()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '[
    {"id": "limit", "rule": "4.1", "question": "What is the most players a Top 100 club may have in its squad?",
     "options": ["45", "50", "55", "As many as Soccer Manager allows"], "answer": 1,
     "why": "Rule 4.1: a club may have a maximum of 50 players associated with its squad."},
    {"id": "loans", "rule": "4.2", "question": "You loan a player out to another club. Does he still count towards your 50?",
     "options": ["No, only the club he is on loan at counts him", "Yes: loans count in both directions", "Only if the loan is longer than a month"], "answer": 1,
     "why": "Rule 4.2: a player loaned to your club counts, and a player loaned out from your club also counts. A loan never creates an extra squad place."},
    {"id": "briefly", "rule": "4.1", "question": "You sign a player that takes you to 51, planning to sell someone before the next transfer turn. Is that allowed?",
     "options": ["Yes, as long as you are back to 50 by the next turn", "No: the limit applies at all times, and going over even briefly is a breach", "Yes, if you tell the admin team first"], "answer": 1,
     "why": "Rule 4.1: the limit applies at all times, including between transfer turns. Sell first, then sign."},
    {"id": "sm-enforces", "rule": "4.1", "question": "Will Soccer Manager stop you going over 50 players?",
     "options": ["Yes, it blocks the 51st signing", "No: Soccer Manager does not enforce it, so keeping within 50 is the manager''s responsibility"], "answer": 1,
     "why": "Rule 4.1: Soccer Manager''s own squad setting does not enforce the limit. Managers are responsible for keeping their squad compliant."},
    {"id": "ban-terms", "rule": "4.1", "question": "During a squad-limit transfer ban, which deals are allowed?",
     "options": ["None at all", "Cash sales to clubs outside Top 100 only", "Any sale, but no signings", "Swaps with other Top 100 managers"], "answer": 1,
     "why": "Rule 4.1: during the ban the only permitted deals are cash sales to clubs outside Top 100."},
    {"id": "the-signing", "rule": "4.1", "question": "What happens to the signing that took your squad over 50?",
     "options": ["Nothing, once you are back to 50", "He must be sold for cash to a club outside Top 100 once his own transfer ban ends, and you can never bid for him again", "He must be released"], "answer": 1,
     "why": "Rule 4.1: the signing that took the squad over 50 is sold for cash to a club outside Top 100 once that player''s own transfer ban ends, and the club may not bid for him again."},
    {"id": "new-players", "rule": "5.4", "question": "A new player is added to the Soccer Manager database. What is the most you may bid?",
     "options": ["£1m, in a public cash bid", "£5m, in any kind of bid", "Any amount, as long as the bid is public"], "answer": 0,
     "why": "Rule 5.4: bids for newly added players must be public, cash only, and no more than £1,000,000."},
    {"id": "binding", "rule": "5.1", "question": "You agree a deal with another manager, then a better offer arrives. Can you pull out?",
     "options": ["Yes, until the transfer completes", "No: an unambiguous agreement between managers is binding", "Yes, within 24 hours"], "answer": 1,
     "why": "Rule 5.1: once both managers have clearly agreed a deal, neither should withdraw because a better offer appears."}
  ]'::jsonb;
$$;

revoke all on function public.rules_check_bank() from public, anon, authenticated;

create or replace function public.rules_check_questions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_agg(q - 'answer' - 'why' order by ord)
  from jsonb_array_elements(public.rules_check_bank()) with ordinality as bank(q, ord);
$$;

revoke all on function public.rules_check_questions() from public, anon;
grant execute on function public.rules_check_questions() to authenticated;

-- The signed-in manager's Manager Portal account and their club's Soccer Manager id.
-- @permissions private public.rules_check_my_club(text): internal, used by my_rules_check() and submit_rules_check()
create or replace function public.rules_check_my_club(p_world_slug text default 'top-100')
returns table (manager_id bigint, manager_name text, source_world_id bigint, source_club_id text, club_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select account.manager_id, coalesce(manager.display_name, manager.name),
    world.external_world_id, crosswalk.source_club_id, crosswalk.source_club_name
  from public.manager_portal_accounts account
  join public.managers manager on manager.id = account.manager_id
  join public.game_worlds world on world.slug = p_world_slug
  left join public.soccer_manager_world_manager_assignments assignment
    on assignment.game_world_id = world.id and assignment.manager_id = account.manager_id
  left join public.soccer_manager_club_crosswalk crosswalk
    on crosswalk.source_world_id = world.external_world_id and crosswalk.team_id = assignment.team_id
  where account.auth_user_id = auth.uid() and account.active = true
  limit 1;
$$;

revoke all on function public.rules_check_my_club(text) from public, anon, authenticated;

create or replace function public.my_rules_check(p_world_slug text default 'top-100')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select * from public.rules_check_my_club(p_world_slug))
  select jsonb_build_object(
    'manager', (select manager_name from me),
    'club', (select club_name from me),
    'passedAt', (select max(created_at) from public.rules_check_attempts where auth_user_id = auth.uid() and passed),
    'attempts', (select count(*) from public.rules_check_attempts where auth_user_id = auth.uid()),
    'reduction', (
      select jsonb_build_object('endsOn', ban.ends_on, 'reducedEndsOn', ban.reduced_ends_on, 'reducedAt', ban.reduced_at)
      from public.club_transfer_bans ban, me
      where ban.source_world_id = me.source_world_id and ban.source_club_id = me.source_club_id
        and ban.reduced_ends_on is not null and ban.ends_on >= current_date
      order by ban.ends_on desc limit 1));
$$;

revoke all on function public.my_rules_check(text) from public, anon;
grant execute on function public.my_rules_check(text) to authenticated;

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
  v_wrong jsonb;
  v_passed boolean;
  v_ban public.club_transfer_bans;
  v_ends_on date;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'Answers must be an object of question id to option number.'; end if;
  select * into v_me from public.rules_check_my_club(p_world_slug);

  select count(*),
    count(*) filter (where (p_answers->>(q->>'id')) = (q->>'answer')),
    coalesce(jsonb_agg(jsonb_build_object('id', q->>'id', 'rule', q->>'rule', 'why', q->>'why'))
      filter (where (p_answers->>(q->>'id')) is distinct from (q->>'answer')), '[]'::jsonb)
  into v_total, v_score, v_wrong
  from jsonb_array_elements(public.rules_check_bank()) q;
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

-- Officials: offer a shorter ban for passing the rules check (null withdraws the offer).
create or replace function public.offer_ban_reduction(p_ban_id bigint, p_reduced_ends_on date)
returns public.club_transfer_bans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ban public.club_transfer_bans;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can change transfer bans.'; end if;
  select * into v_ban from public.club_transfer_bans where id = p_ban_id for update;
  if not found then raise exception 'Transfer ban not found.'; end if;
  if p_reduced_ends_on is not null and (p_reduced_ends_on >= v_ban.ends_on or p_reduced_ends_on < v_ban.starts_on) then
    raise exception 'The reduced end date must fall within the ban.';
  end if;
  update public.club_transfer_bans
     set reduced_ends_on = p_reduced_ends_on,
         reduce_condition = case when p_reduced_ends_on is null then null else 'rules_check' end
   where id = p_ban_id
  returning * into v_ban;
  return v_ban;
end;
$$;

revoke all on function public.offer_ban_reduction(bigint, date) from public, anon;
grant execute on function public.offer_ban_reduction(bigint, date) to authenticated;
