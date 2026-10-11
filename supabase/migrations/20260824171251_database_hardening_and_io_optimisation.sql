-- Targeted indexes for relationships used by tournament navigation, manager portal,
-- result workflow, revisions, and manager history.  We deliberately do not index
-- every foreign key: low-cardinality/admin-only relationships can wait for evidence.
create index if not exists matches_tournament_id_idx on public.matches(tournament_id);
create index if not exists matches_group_id_idx on public.matches(group_id);
create index if not exists matches_home_entry_id_idx on public.matches(home_entry_id);
create index if not exists matches_away_entry_id_idx on public.matches(away_entry_id);
create index if not exists matches_stage_id_idx on public.matches(stage_id);
create index if not exists matches_round_id_idx on public.matches(round_id);
create index if not exists matches_winner_entry_id_idx on public.matches(winner_entry_id) where winner_entry_id is not null;
create index if not exists matches_loser_entry_id_idx on public.matches(loser_entry_id) where loser_entry_id is not null;

create index if not exists tournament_entries_manager_id_idx on public.tournament_entries(manager_id);
create index if not exists tournament_entries_team_id_idx on public.tournament_entries(team_id);

create index if not exists manager_result_submissions_submitted_user_idx on public.manager_result_submissions(submitted_by_user_id);
create index if not exists manager_result_submissions_opponent_user_idx on public.manager_result_submissions(opponent_user_id);
create index if not exists manager_result_submissions_submitted_manager_idx on public.manager_result_submissions(submitted_by_manager_id);
create index if not exists manager_result_submissions_opponent_manager_idx on public.manager_result_submissions(opponent_manager_id);
create index if not exists manager_result_submissions_forfeiting_entry_idx on public.manager_result_submissions(forfeiting_entry_id) where forfeiting_entry_id is not null;

create index if not exists match_result_revisions_match_id_idx on public.match_result_revisions(match_id);
create index if not exists match_result_revisions_submission_id_idx on public.match_result_revisions(submission_id) where submission_id is not null;

create index if not exists manager_clubs_manager_id_idx on public.manager_clubs(manager_id);
create index if not exists manager_clubs_team_id_idx on public.manager_clubs(team_id);
create index if not exists tournament_rounds_tournament_id_idx on public.tournament_rounds(tournament_id);

-- Avoid per-row re-evaluation of auth helpers and consolidate overlapping policies.
-- Public read semantics are intentionally preserved in this migration.

-- competition_types
 drop policy if exists "Admins manage competition types" on public.competition_types;
create policy "Admins insert competition types" on public.competition_types for insert to authenticated with check (public.is_admin());
create policy "Admins update competition types" on public.competition_types for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete competition types" on public.competition_types for delete to authenticated using (public.is_admin());

-- competitions
 drop policy if exists "admins can manage competitions" on public.competitions;
create policy "Admins insert competitions" on public.competitions for insert to authenticated with check (public.is_admin());
create policy "Admins update competitions" on public.competitions for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete competitions" on public.competitions for delete to authenticated using (public.is_admin());

-- game_worlds
 drop policy if exists "Admins manage game worlds" on public.game_worlds;
create policy "Admins insert game worlds" on public.game_worlds for insert to authenticated with check (public.is_admin());
create policy "Admins update game worlds" on public.game_worlds for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete game worlds" on public.game_worlds for delete to authenticated using (public.is_admin());

-- groups: preserve current unrestricted public read and remove the redundant restricted policy.
 drop policy if exists "admins can manage groups" on public.groups;
 drop policy if exists "public can read public groups" on public.groups;
create policy "Admins insert groups" on public.groups for insert to authenticated with check (public.is_admin());
create policy "Admins update groups" on public.groups for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete groups" on public.groups for delete to authenticated using (public.is_admin());

-- managers
 drop policy if exists "admins can manage managers" on public.managers;
 drop policy if exists "public can read managers" on public.managers;
create policy "Admins insert managers" on public.managers for insert to authenticated with check (public.is_admin());
create policy "Admins update managers" on public.managers for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete managers" on public.managers for delete to authenticated using (public.is_admin());

-- matches
 drop policy if exists "admins can manage matches" on public.matches;
 drop policy if exists "public can read public matches" on public.matches;
create policy "Admins insert matches" on public.matches for insert to authenticated with check (public.is_admin());
create policy "Admins update matches" on public.matches for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete matches" on public.matches for delete to authenticated using (public.is_admin());

-- seasons
 drop policy if exists "admins can manage seasons" on public.seasons;
create policy "Admins insert seasons" on public.seasons for insert to authenticated with check (public.is_admin());
create policy "Admins update seasons" on public.seasons for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete seasons" on public.seasons for delete to authenticated using (public.is_admin());

-- teams
 drop policy if exists "admins can manage teams" on public.teams;
 drop policy if exists "public can read teams" on public.teams;
create policy "Admins insert teams" on public.teams for insert to authenticated with check (public.is_admin());
create policy "Admins update teams" on public.teams for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete teams" on public.teams for delete to authenticated using (public.is_admin());

-- tournament_entries
 drop policy if exists "admins can manage tournament entries" on public.tournament_entries;
 drop policy if exists "public can read public tournament entries" on public.tournament_entries;
create policy "Admins insert tournament entries" on public.tournament_entries for insert to authenticated with check (public.is_admin());
create policy "Admins update tournament entries" on public.tournament_entries for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete tournament entries" on public.tournament_entries for delete to authenticated using (public.is_admin());

-- tournament_round_dates
 drop policy if exists "admins can manage tournament round dates" on public.tournament_round_dates;
 drop policy if exists "public can read public tournament round dates" on public.tournament_round_dates;
create policy "Admins insert tournament round dates" on public.tournament_round_dates for insert to authenticated with check (public.is_admin());
create policy "Admins update tournament round dates" on public.tournament_round_dates for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete tournament round dates" on public.tournament_round_dates for delete to authenticated using (public.is_admin());

-- tournaments: two SELECT policies currently overlap; preserve the unrestricted one.
 drop policy if exists "public can read public tournaments" on public.tournaments;

-- content_reports: merge user/admin read + insert paths, retain admin-only mutation.
 drop policy if exists "Admins manage reports" on public.content_reports;
 drop policy if exists "Signed-in users create reports" on public.content_reports;
 drop policy if exists "Users read own reports" on public.content_reports;
create policy "Users and admins create reports" on public.content_reports
  for insert to authenticated
  with check (
    public.is_admin()
    or (reporter_id = (select auth.uid()) and status = 'unresolved')
  );
create policy "Users read own reports and admins read all" on public.content_reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or public.is_admin());
create policy "Admins update reports" on public.content_reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete reports" on public.content_reports
  for delete to authenticated using (public.is_admin());

-- manager_portal_accounts
 drop policy if exists "Admins can manage manager portal accounts" on public.manager_portal_accounts;
 drop policy if exists "Managers can read their own portal account" on public.manager_portal_accounts;
create policy "Managers read own account and admins read all" on public.manager_portal_accounts
  for select to authenticated
  using ((select auth.uid()) = auth_user_id or public.is_admin());
create policy "Admins insert manager portal accounts" on public.manager_portal_accounts
  for insert to authenticated with check (public.is_admin());
create policy "Admins update manager portal accounts" on public.manager_portal_accounts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete manager portal accounts" on public.manager_portal_accounts
  for delete to authenticated using (public.is_admin());

-- manager_portal_claims
 drop policy if exists "Admins can manage manager claims" on public.manager_portal_claims;
 drop policy if exists "Users can create their own manager claim" on public.manager_portal_claims;
 drop policy if exists "Users can read their own manager claim" on public.manager_portal_claims;
 drop policy if exists "Users can correct their own manager claim" on public.manager_portal_claims;
create policy "Users create own claims and admins create claims" on public.manager_portal_claims
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      (select auth.uid()) = auth_user_id
      and lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    )
  );
create policy "Users read own claims and admins read all" on public.manager_portal_claims
  for select to authenticated
  using ((select auth.uid()) = auth_user_id or public.is_admin());
create policy "Users correct own claims and admins update all" on public.manager_portal_claims
  for update to authenticated
  using (
    public.is_admin()
    or ((select auth.uid()) = auth_user_id and status = any(array['pending'::text,'rejected'::text]))
  )
  with check (
    public.is_admin()
    or (
      (select auth.uid()) = auth_user_id
      and status = 'pending'
      and lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    )
  );
create policy "Admins delete manager claims" on public.manager_portal_claims
  for delete to authenticated using (public.is_admin());

-- manager_result_submissions
 drop policy if exists "Admins can manage result submissions" on public.manager_result_submissions;
 drop policy if exists "Managers can read submissions for their matches" on public.manager_result_submissions;
create policy "Managers read own match submissions and admins read all" on public.manager_result_submissions
  for select to authenticated
  using (
    public.is_admin()
    or submitted_by_user_id = (select auth.uid())
    or opponent_user_id = (select auth.uid())
  );
create policy "Admins insert result submissions" on public.manager_result_submissions
  for insert to authenticated with check (public.is_admin());
create policy "Admins update result submissions" on public.manager_result_submissions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete result submissions" on public.manager_result_submissions
  for delete to authenticated using (public.is_admin());

-- match_comments: keep anonymous public participation without making anon execute is_admin().
 drop policy if exists "Admins manage match comments" on public.match_comments;
 drop policy if exists "Public publish visible match comments" on public.match_comments;
 drop policy if exists "Public read visible match comments" on public.match_comments;
create policy "Anonymous read visible match comments" on public.match_comments
  for select to anon using (status = 'visible');
create policy "Authenticated read visible comments and admins read all" on public.match_comments
  for select to authenticated using (status = 'visible' or public.is_admin());
create policy "Anonymous publish visible match comments" on public.match_comments
  for insert to anon
  with check (
    status='visible' and coalesce(is_pinned,false)=false and coalesce(editor_pick,false)=false
    and comment_type=any(array['pre_match'::text,'post_match'::text])
    and contribution_type=any(array['statement'::text,'question'::text,'comment'::text])
    and length(trim(manager_name)) between 2 and 80
    and length(trim(comment)) between 3 and 500
  );
create policy "Authenticated publish comments and admins insert" on public.match_comments
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      status='visible' and coalesce(is_pinned,false)=false and coalesce(editor_pick,false)=false
      and comment_type=any(array['pre_match'::text,'post_match'::text])
      and contribution_type=any(array['statement'::text,'question'::text,'comment'::text])
      and length(trim(manager_name)) between 2 and 80
      and length(trim(comment)) between 3 and 500
    )
  );
create policy "Admins update match comments" on public.match_comments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete match comments" on public.match_comments
  for delete to authenticated using (public.is_admin());

-- match_result_revisions had two equivalent admin SELECT paths.
 drop policy if exists "Admins can read result revisions" on public.match_result_revisions;

-- Harden mutable search paths on helper functions.
alter function public.normal_registration_key(text) set search_path = pg_catalog, public;
alter function public.set_registration_keys() set search_path = pg_catalog, public;
alter function public.normalise_manager_claim_text(text) set search_path = pg_catalog, public;
alter function public.canonical_manager_claim_club(text) set search_path = pg_catalog, public;

-- SECURITY DEFINER execution: remove PostgreSQL's default EXECUTE-for-PUBLIC grant.
-- Regrant only intentional API entry points.
revoke execute on function public.admin_amend_match_result(bigint,integer,integer,text,text) from public;
revoke execute on function public.admin_record_double_forfeit(bigint,text) from public;
revoke execute on function public.approve_manager_portal_claim(bigint,bigint) from public;
revoke execute on function public.approve_manager_portal_claim_with_alias(bigint,bigint,bigint,boolean) from public;
revoke execute on function public.create_seeded_test_tournament(bigint,integer) from public;
revoke execute on function public.find_manager_portal_claim_match(text,text) from public;
revoke execute on function public.get_public_youth_winners() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.manager_portal_claim_candidates(text,text) from public;
revoke execute on function public.manager_portal_claim_suggestions(bigint) from public;
revoke execute on function public.moderate_match_comment(bigint,text,text) from public;
revoke execute on function public.notify_admin_of_pending_manager_claim() from public;
revoke execute on function public.populate_manager_portal_claim_suggestion() from public;
revoke execute on function public.promote_registration_to_entrant(bigint) from public;
revoke execute on function public.protect_final_manager_result() from public;
revoke execute on function public.react_to_match_comment(bigint,text) from public;
revoke execute on function public.reject_manager_portal_claim(bigint,text) from public;
revoke execute on function public.reject_manager_result(bigint,text) from public;
revoke execute on function public.report_match_comment(bigint,text) from public;
revoke execute on function public.resolve_manager_result(bigint,integer,integer,text) from public;
revoke execute on function public.respond_to_manager_result(bigint,text,text) from public;
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.set_tournament_registration_window(bigint,text,timestamptz,timestamptz) from public;
revoke execute on function public.submit_manager_result(bigint,integer,integer) from public;
revoke execute on function public.submit_manager_result_with_ruling(bigint,integer,integer,text,text) from public;
revoke execute on function public.sync_match_forfeit_record() from public;
revoke execute on function public.tournament_is_public(bigint) from public;

-- Authenticated admin/manager RPCs. Each function still performs its own ownership/admin check.
grant execute on function public.admin_amend_match_result(bigint,integer,integer,text,text) to authenticated;
grant execute on function public.admin_record_double_forfeit(bigint,text) to authenticated;
grant execute on function public.approve_manager_portal_claim(bigint,bigint) to authenticated;
grant execute on function public.approve_manager_portal_claim_with_alias(bigint,bigint,bigint,boolean) to authenticated;
grant execute on function public.create_seeded_test_tournament(bigint,integer) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.manager_portal_claim_suggestions(bigint) to authenticated;
grant execute on function public.moderate_match_comment(bigint,text,text) to authenticated;
grant execute on function public.promote_registration_to_entrant(bigint) to authenticated;
grant execute on function public.reject_manager_portal_claim(bigint,text) to authenticated;
grant execute on function public.reject_manager_result(bigint,text) to authenticated;
grant execute on function public.report_match_comment(bigint,text) to authenticated;
grant execute on function public.resolve_manager_result(bigint,integer,integer,text) to authenticated;
grant execute on function public.respond_to_manager_result(bigint,text,text) to authenticated;
grant execute on function public.set_tournament_registration_window(bigint,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.submit_manager_result(bigint,integer,integer) to authenticated;
grant execute on function public.submit_manager_result_with_ruling(bigint,integer,integer,text,text) to authenticated;

-- Intentionally public read/interaction RPCs. These remain SECURITY DEFINER by design.
grant execute on function public.get_public_youth_winners() to anon, authenticated;
grant execute on function public.react_to_match_comment(bigint,text) to anon, authenticated;
grant execute on function public.tournament_is_public(bigint) to anon, authenticated;

-- Internal matching helpers and trigger/event-trigger functions receive no client grants.
-- Function owners retain execution rights for trigger/function-to-function calls.