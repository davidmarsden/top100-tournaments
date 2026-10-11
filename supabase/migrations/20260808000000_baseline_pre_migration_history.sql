-- Baseline: reconstructed schema of the public schema as it stood immediately before
-- the first recorded migration (20260809210943), i.e. everything created outside
-- migration history between July 2026 and 9 August 2026.
--
-- HOW THIS FILE WAS PRODUCED (see docs/supabase-baseline-reconstruction-2026-10-11.md):
--   1. Objects created by no repo SQL were taken from production's catalog (read-only).
--   2. The original foundational scripts (sql/, database/, supabase/v2-*.sql,
--      supabase/match-comments.sql) and July migrations were replayed on an empty
--      PostgreSQL 17 database in first-commit order, with corrections F1-F10.
--   3. The result was dumped schema-only (no data) and cleaned for use as a migration.
--   4. Baseline + bridge + all 130 recorded migrations were replayed again and the
--      resulting public schema was fingerprinted against production: 0 differences.
--
-- PRODUCTION SAFETY: this version must be recorded as APPLIED in production with
--   supabase migration repair --status applied 20260808000000
-- BEFORE this file reaches the branch production deploys from. It must never execute
-- against production; every object in it already exists there.

SET check_function_bodies = false;
--
-- PostgreSQL database dump
--

--
-- Name: admin_amend_match_result(bigint, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_amend_match_result(target_match_id bigint, target_home_score integer DEFAULT NULL::integer, target_away_score integer DEFAULT NULL::integer, target_status text DEFAULT 'played'::text, note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  match_row public.matches%rowtype;
  winner_id bigint;
  loser_id bigint;
  revision_action text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if nullif(trim(note), '') is null then raise exception 'A reason is required for retrospective result changes'; end if;
  if target_status not in ('played','forfeit','voided') then raise exception 'Status must be played, forfeit or voided'; end if;
  if target_status <> 'voided' and (target_home_score is null or target_away_score is null or target_home_score < 0 or target_away_score < 0) then
    raise exception 'Valid scores are required unless the match is voided';
  end if;

  select * into match_row from public.matches where id = target_match_id for update;
  if not found then raise exception 'Match not found'; end if;

  if target_status = 'voided' then
    winner_id := null;
    loser_id := null;
    revision_action := 'voided';
  else
    winner_id := case when target_home_score > target_away_score then match_row.home_entry_id when target_away_score > target_home_score then match_row.away_entry_id else null end;
    loser_id := case when target_home_score > target_away_score then match_row.away_entry_id when target_away_score > target_home_score then match_row.home_entry_id else null end;
    revision_action := case when target_status = 'forfeit' then 'forfeit' else 'admin_corrected' end;
  end if;

  insert into public.match_result_revisions (
    match_id, changed_by, action,
    previous_status, previous_home_score, previous_away_score,
    new_status, new_home_score, new_away_score, reason
  ) values (
    match_row.id, auth.uid(), revision_action,
    match_row.status, match_row.home_score, match_row.away_score,
    target_status, target_home_score, target_away_score, note
  );

  update public.matches set
    home_score = case when target_status = 'voided' then null else target_home_score end,
    away_score = case when target_status = 'voided' then null else target_away_score end,
    winner_entry_id = winner_id,
    loser_entry_id = loser_id,
    status = target_status,
    played_at = coalesce(played_at, now())
  where id = target_match_id;

  update public.manager_result_submissions set
    status = 'final',
    resolved_by = auth.uid(),
    resolved_home_score = case when target_status = 'voided' then null else target_home_score end,
    resolved_away_score = case when target_status = 'voided' then null else target_away_score end,
    resolution_note = note,
    resolved_at = now(),
    updated_at = now()
  where match_id = target_match_id;
end;
$$;

--
-- Name: approve_manager_portal_claim(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_manager_portal_claim(target_claim_id bigint, target_manager_id bigint DEFAULT NULL::bigint) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  claim_row public.manager_portal_claims%rowtype;
  resolved_manager_id bigint;
  reviewer_label text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select * into claim_row
  from public.manager_portal_claims
  where id = target_claim_id
  for update;

  if not found then raise exception 'Manager claim not found'; end if;
  if claim_row.status <> 'pending' then raise exception 'Manager claim has already been reviewed'; end if;

  resolved_manager_id := coalesce(target_manager_id, claim_row.suggested_manager_id);
  if resolved_manager_id is null then raise exception 'Choose a manager before approving this claim'; end if;

  reviewer_label := coalesce(
    nullif(auth.jwt() ->> 'name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    nullif(auth.jwt() ->> 'email', ''),
    'Administrator'
  );

  insert into public.manager_portal_accounts (auth_user_id, manager_id, email, active, updated_at)
  values (claim_row.auth_user_id, resolved_manager_id, claim_row.email, true, now())
  on conflict (auth_user_id) do update set
    manager_id = excluded.manager_id,
    email = excluded.email,
    active = true,
    updated_at = now();

  update public.manager_portal_claims set
    suggested_manager_id = resolved_manager_id,
    status = 'approved',
    reviewed_by = auth.uid(),
    reviewed_by_label = reviewer_label,
    reviewed_at = now(),
    updated_at = now()
  where id = target_claim_id;

  return resolved_manager_id;
end;
$$;

--
-- Name: approve_manager_portal_claim_with_alias(bigint, bigint, bigint, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_manager_portal_claim_with_alias(target_claim_id bigint, target_manager_id bigint, target_team_id bigint DEFAULT NULL::bigint, remember_team_alias boolean DEFAULT true) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  claim_row public.manager_portal_claims%rowtype;
  canonical_team_name text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into claim_row from public.manager_portal_claims
  where id = target_claim_id for update;
  if not found then raise exception 'Manager claim not found'; end if;

  perform public.approve_manager_portal_claim(target_claim_id, target_manager_id);

  if remember_team_alias and target_team_id is not null then
    select name into canonical_team_name from public.teams where id = target_team_id;
    if canonical_team_name is null then raise exception 'Team not found'; end if;

    if public.normalise_manager_claim_text(claim_row.claimed_club_name)
       <> public.normalise_manager_claim_text(canonical_team_name) then
      insert into public.manager_team_aliases(alias, alias_key, team_id, created_from_claim_id, created_by)
      values (
        claim_row.claimed_club_name,
        public.normalise_manager_claim_text(claim_row.claimed_club_name),
        target_team_id,
        target_claim_id,
        auth.uid()
      )
      on conflict (alias_key) do update set
        alias = excluded.alias,
        team_id = excluded.team_id,
        created_from_claim_id = excluded.created_from_claim_id,
        created_by = excluded.created_by,
        updated_at = now();
    end if;
  end if;

  return target_manager_id;
end;
$$;

--
-- Name: canonical_manager_claim_club(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_manager_claim_club(value text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
declare
  club text := public.normalise_manager_claim_text(value);
begin
  club := regexp_replace(club, '^(fc|ac|as|ssc|sc|cf) ', '');
  club := regexp_replace(club, ' (fc|cf)$', '');

  return case
    when club in ('bayern', 'bayern munich', 'bayern munchen', 'bayern muenchen') then 'bayern'
    when club in ('leicester', 'leicester city', 'leicester youth') then 'leicester youth'
    when club in ('club brugge', 'club brugge nxt', 'brugge', 'brugge nxt') then 'club brugge nxt'
    when club in ('dynamo kyiv', 'dynamo kiev', 'dynamo kyiv molodizhka', 'dynamo kiev molodizhka') then 'dynamo kyiv molodizhka'
    when club in ('dynamo moscow', 'dynamo moskva') then 'dynamo moskva'
    when club in ('besiktas', 'besiktas jk') then 'besiktas'
    when club in ('galatasaray', 'galatasaray sk') then 'galatasaray'
    when club in ('internacional', 'internacional porto alegre') then 'internacional'
    when club = 'milan' then 'milan'
    when club in ('marseille', 'olympique marseille') then 'marseille'
    when club in ('saint etienne', 'st etienne') then 'saint etienne'
    when club in ('sporting', 'sporting cp', 'sporting lisbon') then 'sporting'
    when club in ('athletic club', 'athletic bilbao') then 'athletic club'
    when club in ('psv', 'psv eindhoven') then 'psv'
    when club in ('cska', 'cska moscow', 'cska moskva') then 'cska'
    when club in ('hertha', 'hertha berlin', 'hertha bsc') then 'hertha berlin'
    when club in ('leverkusen', 'bayer leverkusen') then 'leverkusen'
    when club in ('monchengladbach', 'borussia monchengladbach', 'borussia m gladbach', 'gladbach') then 'monchengladbach'
    else club
  end;
end;
$_$;

--
-- Name: create_seeded_test_tournament(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_seeded_test_tournament(source_tournament_id bigint, entrant_count integer DEFAULT 16) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  source_row tournaments%rowtype;
  new_tournament_id bigint;
  test_stamp text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  test_name text;
  team_row_id bigint;
  manager_row_id bigint;
  entry_row_id bigint;
  registration_row_id bigint;
  index_value integer;
  rating_value integer;
  group_total integer;
  knockout_total integer;
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;

  if entrant_count not in (16, 32, 64) then
    raise exception 'Entrant count must be 16, 32 or 64';
  end if;

  select * into source_row
  from tournaments
  where id = source_tournament_id;

  if not found then
    raise exception 'Source tournament not found';
  end if;

  group_total := ceil(entrant_count::numeric / 4)::integer;
  knockout_total := case
    when entrant_count >= 64 then 32
    when entrant_count >= 32 then 16
    else 8
  end;

  test_name := 'TEST ' || source_row.name || ' ' || test_stamp;

  insert into tournaments (
    season_id,
    competition_id,
    game_world_id,
    competition_type_id,
    season_number,
    name,
    slug,
    public_slug,
    status,
    format,
    source,
    max_entries,
    actual_entries,
    group_count,
    teams_per_group,
    knockout_teams,
    secondary_bracket_name,
    rules_notes,
    is_public,
    archive_quality,
    registration_status,
    registration_opens_at,
    registration_closes_at
  ) values (
    source_row.season_id,
    source_row.competition_id,
    source_row.game_world_id,
    source_row.competition_type_id,
    source_row.season_number,
    test_name,
    'test-' || test_stamp,
    null,
    'draft',
    'groups_then_knockout',
    'app',
    entrant_count,
    entrant_count,
    group_total,
    4,
    knockout_total,
    source_row.secondary_bracket_name,
    'Automatically generated test tournament based on tournament #' || source_tournament_id,
    false,
    'unknown',
    'closed',
    null,
    null
  ) returning id into new_tournament_id;

  for index_value in 1..entrant_count loop
    rating_value := 70 + ((index_value - 1) % 26);

    insert into teams(name, active)
    values (
      'Test Club ' || lpad(index_value::text, 2, '0') || ' ' || test_stamp,
      true
    ) returning id into team_row_id;

    insert into managers(name, display_name, canonical_name, active)
    values (
      'Test Manager ' || lpad(index_value::text, 2, '0') || ' ' || test_stamp,
      'Test Manager ' || lpad(index_value::text, 2, '0'),
      'test-manager-' || lpad(index_value::text, 2, '0') || '-' || test_stamp,
      true
    ) returning id into manager_row_id;

    insert into tournament_entries (
      tournament_id,
      team_id,
      manager_id,
      seed,
      rating,
      entry_status,
      prize_draw_eligible,
      notes
    ) values (
      new_tournament_id,
      team_row_id,
      manager_row_id,
      index_value,
      rating_value,
      'active',
      true,
      'Generated by seeded test tournament harness'
    ) returning id into entry_row_id;

    insert into tournament_registrations (
      tournament_id,
      manager_name,
      manager_email,
      club_name,
      rating,
      notes,
      status,
      manager_key,
      email_key,
      club_key,
      submitted_at,
      reviewed_at,
      reviewed_by,
      promoted_entry_id,
      promoted_at
    ) values (
      new_tournament_id,
      'Test Manager ' || lpad(index_value::text, 2, '0'),
      null,
      'Test Club ' || lpad(index_value::text, 2, '0'),
      rating_value,
      null,
      'approved',
      normal_registration_key('Test Manager ' || lpad(index_value::text, 2, '0')),
      '',
      normal_registration_key('Test Club ' || lpad(index_value::text, 2, '0')),
      now(),
      now(),
      auth.uid(),
      entry_row_id,
      now()
    ) returning id into registration_row_id;
  end loop;

  return new_tournament_id;
end;
$$;

--
-- Name: find_manager_portal_claim_match(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_manager_portal_claim_match(claimed_manager_name text, claimed_club_name text) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with candidates as (
    select *
    from public.manager_portal_claim_candidates(claimed_manager_name, claimed_club_name)
  ),
  best_score as (
    select
      max(match_quality) as match_quality,
      max(latest_season) filter (
        where match_quality = (select max(match_quality) from candidates)
      ) as latest_season
    from candidates
  ),
  best_score_with_appearances as (
    select
      bs.match_quality,
      bs.latest_season,
      max(c.appearances) as appearances
    from best_score bs
    join candidates c
      on c.match_quality = bs.match_quality
     and c.latest_season = bs.latest_season
    group by bs.match_quality, bs.latest_season
  ),
  top_candidates as (
    select c.manager_id
    from candidates c
    join best_score_with_appearances best
      on c.match_quality = best.match_quality
     and c.latest_season = best.latest_season
     and c.appearances = best.appearances
  )
  select case
    when count(*) = 1 then min(manager_id)
    else null
  end
  from top_candidates;
$$;

--
-- Name: get_public_youth_winners(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_youth_winners() RETURNS TABLE(id bigint, honour text, honour_position integer, tournament_id bigint, tournament_name text, season_number integer, team_name text, manager_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    h.id,
    h.honour,
    h.position as honour_position,
    h.tournament_id,
    t.name as tournament_name,
    coalesce(t.season_number, 0) as season_number,
    tm.name as team_name,
    coalesce(m.display_name, m.name) as manager_name
  from public.honours h
  join public.tournaments t on t.id = h.tournament_id
  left join public.tournament_entries te on te.id = h.entry_id
  left join public.teams tm on tm.id = te.team_id
  left join public.managers m on m.id = te.manager_id
  where lower(coalesce(h.honour, '')) like '%winner%'
    and (
      lower(coalesce(t.name, '')) like '%youth%'
      or lower(coalesce(h.honour, '')) like '%youth cup%'
      or lower(coalesce(h.honour, '')) like '%youth shield%'
      or lower(coalesce(h.honour, '')) like '%shield winner%'
      or lower(coalesce(h.honour, '')) like '%cup winner%'
    )
  order by coalesce(t.season_number, 0) desc, h.id desc;
$$;

--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
          select exists (
              select 1
                  from public.admin_users
                      where user_id = auth.uid()
                        );
                        $$;

--
-- Name: manager_portal_claim_candidates(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.manager_portal_claim_candidates(claimed_manager_name text, claimed_club_name text) RETURNS TABLE(manager_id bigint, manager_name text, team_name text, match_quality integer, latest_season integer, appearances bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with prepared as (
    select
      public.normalise_manager_claim_text(claimed_manager_name) as claimed_name,
      public.canonical_manager_claim_club(claimed_club_name) as claimed_club
  ),
  matching_entries as (
    select
      te.manager_id,
      coalesce(m.display_name, m.name) as manager_name,
      t.name as team_name,
      case
        when public.normalise_manager_claim_text(coalesce(m.display_name, m.name)) = p.claimed_name then 2
        when public.normalise_manager_claim_text(coalesce(m.display_name, m.name)) like p.claimed_name || ' %' then 1
        else 0
      end as match_quality,
      coalesce(tr.season_number, 0) as season_number
    from public.tournament_entries te
    join public.managers m on m.id = te.manager_id
    join public.teams t on t.id = te.team_id
    join public.tournaments tr on tr.id = te.tournament_id
    cross join prepared p
    where p.claimed_name <> ''
      and p.claimed_club <> ''
      and public.canonical_manager_claim_club(t.name) = p.claimed_club
      and (
        public.normalise_manager_claim_text(coalesce(m.display_name, m.name)) = p.claimed_name
        or public.normalise_manager_claim_text(coalesce(m.display_name, m.name)) like p.claimed_name || ' %'
      )
  )
  select
    me.manager_id,
    max(me.manager_name) as manager_name,
    max(me.team_name) as team_name,
    max(me.match_quality) as match_quality,
    max(me.season_number) as latest_season,
    count(*) as appearances
  from matching_entries me
  group by me.manager_id
  order by
    max(me.match_quality) desc,
    max(me.season_number) desc,
    count(*) desc,
    me.manager_id desc;
$$;

--
-- Name: manager_portal_claim_suggestions(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.manager_portal_claim_suggestions(target_claim_id bigint) RETURNS TABLE(manager_id bigint, manager_name text, team_id bigint, team_name text, latest_season integer, seed integer, group_code text, score integer, confidence text, reasons text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  with claim as (
    select
      c.claimed_manager_name,
      c.claimed_club_name,
      public.normalise_manager_claim_text(c.claimed_manager_name) as claim_manager_key,
      public.canonical_manager_claim_club(c.claimed_club_name) as claim_club_key,
      public.normalise_manager_claim_text(c.claimed_club_name) as claim_club_raw
    from public.manager_portal_claims c
    where c.id = target_claim_id and public.is_admin()
  ),
  candidates as (
    select
      te.manager_id,
      coalesce(m.display_name, m.name) as manager_name,
      te.team_id,
      t.name as team_name,
      coalesce(tr.season_number, 0) as latest_season,
      te.seed,
      te.group_code,
      public.normalise_manager_claim_text(coalesce(m.display_name, m.name)) as manager_key,
      public.canonical_manager_claim_club(t.name) as team_key,
      public.normalise_manager_claim_text(t.name) as team_raw,
      exists (
        select 1 from public.manager_team_aliases a
        where a.team_id = te.team_id and a.alias_key = cl.claim_club_raw
      ) as alias_exact,
      similarity(public.normalise_manager_claim_text(coalesce(m.display_name, m.name)), cl.claim_manager_key) as manager_similarity,
      greatest(
        similarity(public.canonical_manager_claim_club(t.name), cl.claim_club_key),
        similarity(public.normalise_manager_claim_text(t.name), cl.claim_club_raw)
      ) as club_similarity,
      cl.claim_manager_key,
      cl.claim_club_key
    from public.tournament_entries te
    join public.managers m on m.id = te.manager_id
    join public.teams t on t.id = te.team_id
    join public.tournaments tr on tr.id = te.tournament_id
    cross join claim cl
  ),
  scored as (
    select *,
      (case when manager_key = claim_manager_key then 55
             when manager_key like claim_manager_key || ' %' then 45
             else round(manager_similarity * 38)::int end)
      + (case when alias_exact then 42
              when team_key = claim_club_key then 38
              else round(club_similarity * 34)::int end) as total_score
    from candidates
    where (manager_key = claim_manager_key or manager_key like claim_manager_key || ' %' or manager_similarity >= 0.28)
      and (alias_exact or team_key = claim_club_key or club_similarity >= 0.28)
  ),
  deduped as (
    select distinct on (manager_id, team_id) *
    from scored
    order by manager_id, team_id, total_score desc, latest_season desc
  )
  select
    d.manager_id,
    d.manager_name,
    d.team_id,
    d.team_name,
    d.latest_season,
    d.seed,
    d.group_code,
    least(d.total_score, 100) as score,
    case when d.total_score >= 92 then 'Very strong'
         when d.total_score >= 78 then 'Likely'
         else 'Possible' end as confidence,
    array_remove(array[
      case when d.manager_key = d.claim_manager_key then 'Exact manager name' end,
      case when d.manager_key like d.claim_manager_key || ' %' and d.manager_key <> d.claim_manager_key then 'Shortened manager name' end,
      case when d.alias_exact then 'Known club alias' end,
      case when d.team_key = d.claim_club_key and not d.alias_exact then 'Matching club name' end,
      case when d.team_key <> d.claim_club_key and not d.alias_exact then 'Similar club name' end
    ], null) as reasons
  from deduped d
  order by d.total_score desc, d.latest_season desc, d.seed asc nulls last
  limit 6;
$$;

--
-- Name: moderate_match_comment(bigint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.moderate_match_comment(target_comment_id bigint, target_status text, moderation_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if target_status not in ('visible', 'hidden', 'removed') then
    raise exception 'Invalid moderation state';
  end if;

  update public.match_comments
  set status = target_status,
      moderated_at = now(),
      moderated_by = auth.uid(),
      is_pinned = case when target_status = 'visible' then is_pinned else false end,
      editor_pick = case when target_status = 'visible' then editor_pick else false end
  where id = target_comment_id;

  if not found then raise exception 'Contribution not found'; end if;

  if target_status <> 'visible' then
    update public.content_reports
    set status = 'resolved',
        resolved_at = now(),
        resolved_by = auth.uid(),
        resolution_note = coalesce(nullif(trim(moderation_note), ''), 'Content moderated by administrator.')
    where content_type = 'match_comment'
      and content_id = target_comment_id
      and status = 'unresolved';
  end if;
end;
$$;

--
-- Name: normal_registration_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normal_registration_key(value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select regexp_replace(lower(trim(coalesce(value, ''))), '[^a-z0-9]+', '', 'g');
$$;

--
-- Name: normalise_manager_claim_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalise_manager_claim_text(value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select trim(regexp_replace(
    lower(translate(coalesce(value, ''),
      'áàâäãåāăąçćčďđéèêëēĕėęěíìîïīĭįłñńňóòôöõøōŏőŕřśšşťţúùûüūŭůűųýÿžźż',
      'aaaaaaaaacccddeeeeeeeeeiiiiiiilnnnooooooooorrsssttuuuuuuuuuyyzzz'
    )),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

--
-- Name: populate_manager_portal_claim_suggestion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.populate_manager_portal_claim_suggestion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  new.suggested_manager_id := public.find_manager_portal_claim_match(
    new.claimed_manager_name,
    new.claimed_club_name
  );
  return new;
end;
$$;

--
-- Name: prevent_repeated_match_comment_spam(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_repeated_match_comment_spam() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if exists (
    select 1 from public.match_comments existing
    where existing.match_id = new.match_id
      and lower(trim(existing.manager_name)) = lower(trim(new.manager_name))
      and lower(trim(existing.comment)) = lower(trim(new.comment))
      and existing.created_at > now() - interval '10 minutes'
      and existing.status <> 'removed'
  ) then
    raise exception 'That contribution was already posted recently.';
  end if;
  return new;
end;
$$;

--
-- Name: promote_registration_to_entrant(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_registration_to_entrant(registration_id bigint) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  registration_row tournament_registrations%rowtype;
  team_row_id bigint;
  manager_row_id bigint;
  entry_row_id bigint;
  next_seed integer;
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;

  select * into registration_row
  from tournament_registrations
  where id = registration_id
  for update;

  if not found then
    raise exception 'Registration not found';
  end if;

  if registration_row.status <> 'approved' then
    raise exception 'Registration must be approved first';
  end if;

  if registration_row.promoted_entry_id is not null then
    return registration_row.promoted_entry_id;
  end if;

  select id into team_row_id
  from teams
  where normal_registration_key(name) = registration_row.club_key
  order by id
  limit 1;

  if team_row_id is null then
    insert into teams(name, active)
    values (registration_row.club_name, true)
    returning id into team_row_id;
  end if;

  select id into manager_row_id
  from managers
  where normal_registration_key(coalesce(display_name, name)) = registration_row.manager_key
  order by id
  limit 1;

  if manager_row_id is null then
    insert into managers(name, display_name, canonical_name, active)
    values (
      registration_row.manager_name,
      registration_row.manager_name,
      lower(registration_row.manager_name),
      true
    )
    returning id into manager_row_id;
  end if;

  select id into entry_row_id
  from tournament_entries
  where tournament_id = registration_row.tournament_id
    and (team_id = team_row_id or manager_id = manager_row_id)
  limit 1;

  if entry_row_id is null then
    select coalesce(max(seed), 0) + 1 into next_seed
    from tournament_entries
    where tournament_id = registration_row.tournament_id;

    insert into tournament_entries(
      tournament_id,
      team_id,
      manager_id,
      seed,
      rating,
      entry_status,
      prize_draw_eligible,
      notes
    ) values (
      registration_row.tournament_id,
      team_row_id,
      manager_row_id,
      next_seed,
      registration_row.rating,
      'active',
      true,
      'Promoted from registration #' || registration_row.id || ' · ' || registration_row.manager_email
    )
    returning id into entry_row_id;
  end if;

  update tournament_registrations
  set promoted_entry_id = entry_row_id,
      promoted_at = now(),
      reviewed_at = coalesce(reviewed_at, now()),
      reviewed_by = coalesce(reviewed_by, auth.uid())
  where id = registration_row.id;

  update tournaments t
  set actual_entries = (
    select count(*) from tournament_entries te where te.tournament_id = t.id
  )
  where t.id = registration_row.tournament_id;

  return entry_row_id;
end;
$$;

--
-- Name: protect_final_manager_result(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_final_manager_result() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if old.status = 'final'
     and new.status is distinct from old.status
     and not public.is_admin() then
    raise exception 'This result has been finalised. Only an administrator can reopen or amend it.';
  end if;
  return new;
end;
$$;

--
-- Name: react_to_match_comment(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.react_to_match_comment(comment_id bigint, reaction_key text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if reaction_key not in ('like', 'laugh', 'eyes', 'fire') then raise exception 'Invalid reaction'; end if;
  update public.match_comments
  set reactions = jsonb_set(
    coalesce(reactions, '{}'::jsonb), array[reaction_key],
    to_jsonb(coalesce((reactions ->> reaction_key)::int, 0) + 1), true
  )
  where id = comment_id and status = 'visible';
end;
$$;

--
-- Name: reject_manager_portal_claim(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_manager_portal_claim(target_claim_id bigint, notes text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  reviewer_label text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  reviewer_label := coalesce(
    nullif(auth.jwt() ->> 'name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    nullif(auth.jwt() ->> 'email', ''),
    'Administrator'
  );

  update public.manager_portal_claims set
    status = 'rejected',
    review_notes = notes,
    reviewed_by = auth.uid(),
    reviewed_by_label = reviewer_label,
    reviewed_at = now(),
    updated_at = now()
  where id = target_claim_id and status = 'pending';

  if not found then raise exception 'Pending manager claim not found'; end if;
end;
$$;

--
-- Name: reject_manager_result(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_manager_result(target_submission_id bigint, note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  submission_row public.manager_result_submissions%rowtype;
  match_row public.matches%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if nullif(trim(note), '') is null then raise exception 'A rejection reason is required'; end if;

  select * into submission_row from public.manager_result_submissions
  where id = target_submission_id for update;
  if not found then raise exception 'Result submission not found'; end if;
  if submission_row.status not in ('pending_confirmation','disputed','pending_admin_check','opponent_confirmed','appealed') then
    raise exception 'This submission is no longer awaiting review';
  end if;

  select * into match_row from public.matches where id = submission_row.match_id for update;

  insert into public.match_result_revisions (
    match_id, submission_id, changed_by, action,
    previous_status, previous_home_score, previous_away_score,
    new_status, new_home_score, new_away_score, reason
  ) values (
    match_row.id, submission_row.id, auth.uid(), 'reopened',
    match_row.status, match_row.home_score, match_row.away_score,
    'scheduled', null, null, note
  );

  update public.matches set
    home_score = null,
    away_score = null,
    winner_entry_id = null,
    loser_entry_id = null,
    status = 'scheduled',
    played_at = null
  where id = submission_row.match_id;

  update public.manager_result_submissions set
    status = 'withdrawn',
    resolved_by = auth.uid(),
    resolution_note = note,
    resolved_at = now(),
    updated_at = now()
  where id = target_submission_id;
end;
$$;

--
-- Name: report_match_comment(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_match_comment(target_comment_id bigint, report_reason text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  report_id bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to report content.'; end if;
  if length(trim(coalesce(report_reason, ''))) not between 3 and 500 then
    raise exception 'Give a brief reason for the report.';
  end if;
  if not exists (
    select 1 from public.match_comments
    where id = target_comment_id and status <> 'removed'
  ) then
    raise exception 'Content not found.';
  end if;

  insert into public.content_reports(content_type, content_id, reporter_id, reason)
  values ('match_comment', target_comment_id, auth.uid(), trim(report_reason))
  returning id into report_id;
  return report_id;
exception when unique_violation then
  raise exception 'You have already reported this item.';
end;
$$;

--
-- Name: resolve_manager_result(bigint, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_manager_result(target_submission_id bigint, target_home_score integer, target_away_score integer, note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  submission_row public.manager_result_submissions%rowtype;
  match_row public.matches%rowtype;
  winner_id bigint;
  loser_id bigint;
  revision_action text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if target_home_score < 0 or target_away_score < 0 then
    raise exception 'Scores cannot be negative';
  end if;

  select * into submission_row
  from public.manager_result_submissions
  where id = target_submission_id
  for update;

  if not found then
    raise exception 'Result submission not found';
  end if;

  select * into match_row
  from public.matches
  where id = submission_row.match_id
  for update;

  winner_id := case
    when target_home_score > target_away_score then match_row.home_entry_id
    when target_away_score > target_home_score then match_row.away_entry_id
    else null
  end;

  loser_id := case
    when target_home_score > target_away_score then match_row.away_entry_id
    when target_away_score > target_home_score then match_row.home_entry_id
    else null
  end;

  revision_action := case
    when match_row.home_score is distinct from target_home_score
      or match_row.away_score is distinct from target_away_score
      then 'admin_corrected'
    else 'admin_finalised'
  end;

  insert into public.match_result_revisions (
    match_id,
    submission_id,
    changed_by,
    action,
    previous_status,
    previous_home_score,
    previous_away_score,
    new_status,
    new_home_score,
    new_away_score,
    reason
  ) values (
    match_row.id,
    submission_row.id,
    auth.uid(),
    revision_action,
    match_row.status,
    match_row.home_score,
    match_row.away_score,
    'played',
    target_home_score,
    target_away_score,
    note
  );

  update public.matches
  set home_score = target_home_score,
      away_score = target_away_score,
      winner_entry_id = winner_id,
      loser_entry_id = loser_id,
      status = 'played',
      played_at = coalesce(played_at, now())
  where id = submission_row.match_id;

  update public.manager_result_submissions
  set status = 'final',
      resolved_by = auth.uid(),
      resolved_home_score = target_home_score,
      resolved_away_score = target_away_score,
      resolution_note = note,
      resolved_at = now(),
      updated_at = now()
  where id = target_submission_id;
end;
$$;

--
-- Name: respond_to_manager_result(bigint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_to_manager_result(target_submission_id bigint, response text, note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  submission_row public.manager_result_submissions%rowtype;
begin
  select * into submission_row
  from public.manager_result_submissions
  where id = target_submission_id
  for update;

  if not found then
    raise exception 'Result submission not found';
  end if;

  if submission_row.opponent_user_id is distinct from auth.uid() then
    raise exception 'Only the opposing manager can respond';
  end if;

  if submission_row.status not in ('pending_admin_check', 'opponent_confirmed') then
    raise exception 'This result is no longer open for opponent response';
  end if;

  if response = 'confirm' then
    update public.manager_result_submissions
    set status = 'opponent_confirmed',
        opponent_response_note = note,
        confirmed_at = now(),
        updated_at = now()
    where id = target_submission_id;
  elsif response in ('dispute', 'appeal') then
    if nullif(trim(note), '') is null then
      raise exception 'An appeal reason is required';
    end if;

    update public.manager_result_submissions
    set status = 'appealed',
        opponent_response_note = note,
        disputed_at = now(),
        updated_at = now()
    where id = target_submission_id;
  else
    raise exception 'Response must be confirm or appeal';
  end if;
end;
$$;

--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

--
-- Name: sanitise_manager_claim_reviewer_label(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sanitise_manager_claim_reviewer_label() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.reviewed_by_label is null
     or trim(new.reviewed_by_label) = ''
     or new.reviewed_by_label like '%@%' then
    new.reviewed_by_label := 'Top 100 Admin';
  end if;

  return new;
end;
$$;

--
-- Name: set_registration_keys(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_registration_keys() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.manager_name := trim(new.manager_name);
  new.manager_email := nullif(lower(trim(coalesce(new.manager_email, ''))), '');
  new.club_name := trim(new.club_name);
  new.manager_key := normal_registration_key(new.manager_name);
  new.email_key := coalesce(new.manager_email, '');
  new.club_key := normal_registration_key(new.club_name);
  new.updated_at := now();
  return new;
end;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: tournaments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournaments (
    id bigint NOT NULL,
    season_id bigint,
    competition_id bigint,
    name text NOT NULL,
    status text DEFAULT 'draft'::text,
    format text,
    source text DEFAULT 'manual'::text,
    source_id text,
    created_at timestamp with time zone DEFAULT now(),
    format_id bigint,
    max_entries integer,
    actual_entries integer,
    group_count integer,
    teams_per_group integer,
    knockout_teams integer,
    secondary_bracket_name text,
    rules_notes text,
    game_world_id bigint,
    competition_type_id bigint,
    season_number integer,
    slug text,
    public_slug text,
    is_public boolean DEFAULT true NOT NULL,
    registration_status text DEFAULT 'closed'::text NOT NULL,
    registration_opens_at timestamp with time zone,
    registration_closes_at timestamp with time zone,
    archived_at timestamp with time zone,
    archive_quality text DEFAULT 'unknown'::text NOT NULL,
    CONSTRAINT tournaments_archive_quality_check CHECK ((archive_quality = ANY (ARRAY['unknown'::text, 'placeholder'::text, 'partial'::text, 'complete'::text]))),
    CONSTRAINT tournaments_registration_status_check CHECK ((registration_status = ANY (ARRAY['closed'::text, 'open'::text, 'paused'::text, 'full'::text])))
);

--
-- Name: set_tournament_registration_window(bigint, text, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_tournament_registration_window(target_tournament_id bigint, next_registration_status text, next_registration_opens_at timestamp with time zone, next_registration_closes_at timestamp with time zone) RETURNS public.tournaments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  updated_row tournaments%rowtype;
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;

  if next_registration_status not in ('closed', 'open', 'paused', 'full') then
    raise exception 'Invalid registration status';
  end if;

  if next_registration_opens_at is not null
     and next_registration_closes_at is not null
     and next_registration_closes_at <= next_registration_opens_at then
    raise exception 'Registration close date must be after the opening date';
  end if;

  update tournaments
  set registration_status = next_registration_status,
      registration_opens_at = next_registration_opens_at,
      registration_closes_at = next_registration_closes_at
  where id = target_tournament_id
  returning * into updated_row;

  if not found then
    raise exception 'Tournament not found';
  end if;

  return updated_row;
end;
$$;

--
-- Name: submit_manager_result(bigint, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_manager_result(target_match_id bigint, target_home_score integer, target_away_score integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  account_row public.manager_portal_accounts%rowtype;
  match_row public.matches%rowtype;
  submitter_entry public.tournament_entries%rowtype;
  opponent_entry public.tournament_entries%rowtype;
  opponent_account public.manager_portal_accounts%rowtype;
  submission_id bigint;
  winner_id bigint;
  loser_id bigint;
begin
  if target_home_score < 0 or target_away_score < 0 then
    raise exception 'Scores cannot be negative';
  end if;

  select * into account_row
  from public.manager_portal_accounts
  where auth_user_id = auth.uid()
    and active = true;

  if not found then
    raise exception 'Manager Portal account not found';
  end if;

  select * into match_row
  from public.matches
  where id = target_match_id
  for update;

  if not found then
    raise exception 'Match not found';
  end if;

  if match_row.status = 'forfeit' then
    raise exception 'This match has already been decided by forfeit';
  end if;

  select * into submitter_entry
  from public.tournament_entries
  where manager_id = account_row.manager_id
    and id in (match_row.home_entry_id, match_row.away_entry_id)
  limit 1;

  if not found then
    raise exception 'You are not a manager in this fixture';
  end if;

  select * into opponent_entry
  from public.tournament_entries
  where id = case
    when submitter_entry.id = match_row.home_entry_id then match_row.away_entry_id
    else match_row.home_entry_id
  end;

  select * into opponent_account
  from public.manager_portal_accounts
  where manager_id = opponent_entry.manager_id
    and active = true
  limit 1;

  winner_id := case
    when target_home_score > target_away_score then match_row.home_entry_id
    when target_away_score > target_home_score then match_row.away_entry_id
    else null
  end;

  loser_id := case
    when target_home_score > target_away_score then match_row.away_entry_id
    when target_away_score > target_home_score then match_row.home_entry_id
    else null
  end;

  insert into public.manager_result_submissions (
    match_id,
    submitted_by_user_id,
    submitted_by_manager_id,
    submitted_home_score,
    submitted_away_score,
    opponent_user_id,
    opponent_manager_id,
    status,
    updated_at
  ) values (
    target_match_id,
    auth.uid(),
    account_row.manager_id,
    target_home_score,
    target_away_score,
    opponent_account.auth_user_id,
    opponent_entry.manager_id,
    'pending_admin_check',
    now()
  )
  on conflict (match_id) do update set
    submitted_by_user_id = excluded.submitted_by_user_id,
    submitted_by_manager_id = excluded.submitted_by_manager_id,
    submitted_home_score = excluded.submitted_home_score,
    submitted_away_score = excluded.submitted_away_score,
    opponent_user_id = excluded.opponent_user_id,
    opponent_manager_id = excluded.opponent_manager_id,
    opponent_response_note = null,
    status = 'pending_admin_check',
    confirmed_at = null,
    disputed_at = null,
    resolved_by = null,
    resolved_home_score = null,
    resolved_away_score = null,
    resolution_note = null,
    resolved_at = null,
    updated_at = now()
  returning id into submission_id;

  insert into public.match_result_revisions (
    match_id,
    submission_id,
    changed_by,
    action,
    previous_status,
    previous_home_score,
    previous_away_score,
    new_status,
    new_home_score,
    new_away_score,
    reason
  ) values (
    target_match_id,
    submission_id,
    auth.uid(),
    'manager_submission',
    match_row.status,
    match_row.home_score,
    match_row.away_score,
    'played',
    target_home_score,
    target_away_score,
    'Provisionally published from Manager Portal submission.'
  );

  update public.matches
  set home_score = target_home_score,
      away_score = target_away_score,
      winner_entry_id = winner_id,
      loser_entry_id = loser_id,
      status = 'played',
      played_at = coalesce(played_at, now())
  where id = target_match_id;

  return submission_id;
end;
$$;

--
-- Name: sync_match_forfeit_record(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_match_forfeit_record() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  forfeiting_entry bigint;
  responsible_manager bigint;
begin
  if new.status = 'forfeit' then
    forfeiting_entry := new.loser_entry_id;

    if forfeiting_entry is null then
      if new.home_score is not null
         and new.away_score is not null
         and new.home_score < new.away_score then
        forfeiting_entry := new.home_entry_id;
      elsif new.home_score is not null
            and new.away_score is not null
            and new.away_score < new.home_score then
        forfeiting_entry := new.away_entry_id;
      end if;
    end if;

    if forfeiting_entry is null then
      raise exception using
        errcode = '23514',
        message = 'Cannot record forfeit: the responsible losing entrant could not be determined.',
        hint = 'Supply loser_entry_id and a decisive official score before setting the match status to forfeit.';
    end if;

    select manager_id
      into responsible_manager
    from public.tournament_entries
    where id = forfeiting_entry;

    if responsible_manager is null then
      raise exception using
        errcode = '23514',
        message = 'Cannot record forfeit: the responsible entrant has no manager.',
        hint = 'Assign the responsible manager to the tournament entrant before recording the forfeit.';
    end if;

    insert into public.forfeits (
      match_id,
      forfeiting_entry_id,
      manager_id,
      reason,
      penalty,
      affects_prize_draw,
      source
    ) values (
      new.id,
      forfeiting_entry,
      responsible_manager,
      'Match recorded as a forfeit',
      'Match forfeiture',
      true,
      'match_ruling'
    )
    on conflict (match_id) where match_id is not null
    do update set
      forfeiting_entry_id = excluded.forfeiting_entry_id,
      manager_id = excluded.manager_id,
      source = 'match_ruling';
  else
    delete from public.forfeits
    where match_id = new.id
      and source = 'match_ruling';
  end if;

  return new;
end;
$$;

--
-- Name: validate_manager_team_alias_source(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_manager_team_alias_source() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  approved_manager_id bigint;
begin
  if new.created_from_claim_id is null then
    return new;
  end if;

  select c.suggested_manager_id
  into approved_manager_id
  from public.manager_portal_claims c
  where c.id = new.created_from_claim_id
    and c.status = 'approved';

  if approved_manager_id is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.tournament_entries te
    where te.manager_id = approved_manager_id
      and te.team_id = new.team_id
  ) then
    return null;
  end if;

  return new;
end;
$$;

--
-- Name: achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievements (
    id bigint NOT NULL,
    tournament_id bigint,
    entry_id bigint,
    team_id bigint,
    manager_id bigint,
    achievement_type text NOT NULL,
    title text NOT NULL,
    "position" integer,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: achievements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.achievements ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.achievements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    user_id uuid NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachments (
    id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_id bigint NOT NULL,
    url text NOT NULL,
    title text,
    caption text,
    source text,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.attachments ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_id bigint,
    action text NOT NULL,
    old_data jsonb,
    new_data jsonb,
    changed_by text,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: competition_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_types (
    id bigint NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    default_max_entries integer,
    default_group_count integer,
    default_teams_per_group integer,
    default_knockout_teams integer,
    default_secondary_bracket_name text,
    display_order integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: competition_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.competition_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: competition_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.competition_types_id_seq OWNED BY public.competition_types.id;

--
-- Name: competitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitions (
    id bigint NOT NULL,
    name text NOT NULL,
    competition_type text,
    description text
);

--
-- Name: competitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.competitions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.competitions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: content_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_reports (
    id bigint NOT NULL,
    content_type text NOT NULL,
    content_id bigint NOT NULL,
    reporter_id uuid NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'unresolved'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    resolution_note text,
    CONSTRAINT content_reports_content_type_check CHECK ((content_type = 'match_comment'::text)),
    CONSTRAINT content_reports_reason_check CHECK (((length(TRIM(BOTH FROM reason)) >= 3) AND (length(TRIM(BOTH FROM reason)) <= 500))),
    CONSTRAINT content_reports_status_check CHECK ((status = ANY (ARRAY['unresolved'::text, 'resolved'::text, 'dismissed'::text])))
);

--
-- Name: content_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.content_reports ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.content_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: fixture_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixture_templates (
    id bigint NOT NULL,
    round_template_id bigint NOT NULL,
    leg integer DEFAULT 1 NOT NULL,
    day_offset integer DEFAULT 0 NOT NULL,
    home_away_flip boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: fixture_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.fixture_templates ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.fixture_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: forfeits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forfeits (
    id bigint NOT NULL,
    match_id bigint,
    forfeiting_entry_id bigint,
    reason text,
    penalty text,
    affects_prize_draw boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    manager_id bigint,
    source text DEFAULT 'legacy'::text NOT NULL
);

--
-- Name: COLUMN forfeits.manager_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.forfeits.manager_id IS 'Manager responsible at the time of the forfeit. This is a snapshot and does not change when a club appoints a replacement manager.';

--
-- Name: forfeits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.forfeits ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.forfeits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: game_worlds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_worlds (
    id bigint NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    display_order integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: game_worlds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_worlds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: game_worlds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_worlds_id_seq OWNED BY public.game_worlds.id;

--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id bigint NOT NULL,
    tournament_id bigint,
    code text NOT NULL,
    name text,
    group_order integer
);

--
-- Name: groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.groups ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.groups_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: honours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.honours (
    id bigint NOT NULL,
    tournament_id bigint,
    entry_id bigint,
    honour text NOT NULL,
    "position" integer
);

--
-- Name: honours_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.honours ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.honours_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: manager_clubs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manager_clubs (
    id bigint NOT NULL,
    manager_id bigint,
    team_id bigint,
    from_season_id bigint,
    to_season_id bigint,
    current_club boolean DEFAULT false,
    appointment_type text,
    notes text
);

--
-- Name: manager_clubs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.manager_clubs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.manager_clubs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: manager_portal_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manager_portal_accounts (
    id bigint NOT NULL,
    auth_user_id uuid NOT NULL,
    manager_id bigint NOT NULL,
    email text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE manager_portal_accounts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.manager_portal_accounts IS 'Links a Supabase Auth user to one canonical Top 100 manager for the Manager Portal.';

--
-- Name: manager_portal_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.manager_portal_accounts ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.manager_portal_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: manager_portal_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manager_portal_claims (
    id bigint NOT NULL,
    auth_user_id uuid NOT NULL,
    email text NOT NULL,
    claimed_manager_name text NOT NULL,
    claimed_club_name text NOT NULL,
    suggested_manager_id bigint,
    status text DEFAULT 'pending'::text NOT NULL,
    review_notes text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_by_label text,
    CONSTRAINT manager_portal_claims_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

--
-- Name: TABLE manager_portal_claims; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.manager_portal_claims IS 'Self-service claims made after a user verifies their email through Supabase Auth.';

--
-- Name: manager_portal_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.manager_portal_claims ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.manager_portal_claims_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: manager_result_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manager_result_submissions (
    id bigint NOT NULL,
    match_id bigint NOT NULL,
    submitted_by_user_id uuid NOT NULL,
    submitted_by_manager_id bigint NOT NULL,
    submitted_home_score integer NOT NULL,
    submitted_away_score integer NOT NULL,
    status text DEFAULT 'pending_confirmation'::text NOT NULL,
    opponent_user_id uuid,
    opponent_manager_id bigint,
    opponent_response_note text,
    confirmed_at timestamp with time zone,
    disputed_at timestamp with time zone,
    resolved_by uuid,
    resolved_home_score integer,
    resolved_away_score integer,
    resolution_note text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT manager_result_submissions_resolved_away_score_check CHECK (((resolved_away_score >= 0) AND (resolved_away_score <= 99))),
    CONSTRAINT manager_result_submissions_resolved_home_score_check CHECK (((resolved_home_score >= 0) AND (resolved_home_score <= 99))),
    CONSTRAINT manager_result_submissions_status_check CHECK ((status = ANY (ARRAY['pending_confirmation'::text, 'confirmed'::text, 'disputed'::text, 'resolved'::text, 'withdrawn'::text, 'pending_admin_check'::text, 'opponent_confirmed'::text, 'appealed'::text, 'final'::text]))),
    CONSTRAINT manager_result_submissions_submitted_away_score_check CHECK (((submitted_away_score >= 0) AND (submitted_away_score <= 99))),
    CONSTRAINT manager_result_submissions_submitted_home_score_check CHECK (((submitted_home_score >= 0) AND (submitted_home_score <= 99)))
);

--
-- Name: manager_result_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.manager_result_submissions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.manager_result_submissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: manager_team_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manager_team_aliases (
    id bigint NOT NULL,
    alias text NOT NULL,
    alias_key text NOT NULL,
    team_id bigint NOT NULL,
    created_from_claim_id bigint,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: manager_team_aliases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.manager_team_aliases ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.manager_team_aliases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: managers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.managers (
    id bigint NOT NULL,
    name text NOT NULL,
    canonical_name text,
    active boolean DEFAULT true,
    display_name text,
    discord_name text,
    joined_season_id bigint,
    retired_season_id bigint
);

--
-- Name: managers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.managers ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.managers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: match_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_comments (
    id bigint NOT NULL,
    match_id bigint NOT NULL,
    tournament_id bigint,
    manager_name text NOT NULL,
    club_name text,
    comment text NOT NULL,
    status text DEFAULT 'visible'::text NOT NULL,
    comment_type text DEFAULT 'pre_match'::text NOT NULL,
    contribution_type text DEFAULT 'statement'::text NOT NULL,
    prediction_score text,
    player_to_watch text,
    first_goalscorer text,
    is_pinned boolean DEFAULT false NOT NULL,
    editor_pick boolean DEFAULT false NOT NULL,
    badge_label text,
    reactions jsonb DEFAULT '{"eyes": 0, "fire": 0, "like": 0, "laugh": 0}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    moderated_at timestamp with time zone,
    moderated_by uuid,
    CONSTRAINT match_comments_comment_type_check CHECK ((comment_type = ANY (ARRAY['pre_match'::text, 'post_match'::text, 'admin_preview'::text, 'admin_report'::text]))),
    CONSTRAINT match_comments_contribution_type_check CHECK ((contribution_type = ANY (ARRAY['statement'::text, 'question'::text, 'comment'::text]))),
    CONSTRAINT match_comments_status_check CHECK ((status = ANY (ARRAY['visible'::text, 'hidden'::text, 'removed'::text])))
);

--
-- Name: match_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: match_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_comments_id_seq OWNED BY public.match_comments.id;

--
-- Name: match_result_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_result_revisions (
    id bigint NOT NULL,
    match_id bigint NOT NULL,
    submission_id bigint,
    changed_by uuid,
    action text NOT NULL,
    previous_status text,
    previous_home_score integer,
    previous_away_score integer,
    new_status text,
    new_home_score integer,
    new_away_score integer,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT match_result_revisions_action_check CHECK ((action = ANY (ARRAY['manager_submission'::text, 'admin_finalised'::text, 'admin_corrected'::text, 'forfeit'::text, 'voided'::text, 'reopened'::text])))
);

--
-- Name: match_result_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.match_result_revisions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.match_result_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matches (
    id bigint NOT NULL,
    tournament_id bigint,
    group_id bigint,
    stage text NOT NULL,
    round text NOT NULL,
    leg integer DEFAULT 1,
    match_order integer,
    scheduled_at timestamp with time zone,
    home_entry_id bigint,
    away_entry_id bigint,
    home_score integer,
    away_score integer,
    winner_entry_id bigint,
    status text DEFAULT 'scheduled'::text,
    source_id text,
    notes text,
    match_code text,
    bracket text,
    home_extra_time_score integer,
    away_extra_time_score integer,
    home_penalty_score integer,
    away_penalty_score integer,
    decided_by text,
    played_at timestamp with time zone,
    challonge_match_id text,
    stage_id bigint,
    round_id bigint,
    aggregate_home_score integer,
    aggregate_away_score integer,
    home_seed integer,
    away_seed integer,
    home_placeholder text,
    away_placeholder text,
    loser_entry_id bigint,
    locked boolean DEFAULT false,
    published boolean DEFAULT false,
    walkover boolean DEFAULT false,
    forfeit boolean DEFAULT false,
    fixture_date date,
    CONSTRAINT matches_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'played'::text, 'forfeit'::text, 'postponed'::text, 'cancelled'::text, 'voided'::text])))
);

--
-- Name: matches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.matches ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.matches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: qualification_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qualification_rules (
    id bigint NOT NULL,
    format_id bigint NOT NULL,
    bracket text NOT NULL,
    source_stage text DEFAULT 'group'::text NOT NULL,
    group_position integer,
    rank_order integer NOT NULL,
    slots integer,
    destination_round text NOT NULL,
    drop_from_bracket text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: qualification_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.qualification_rules ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.qualification_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: seasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seasons (
    id bigint NOT NULL,
    code text NOT NULL,
    number integer,
    start_date date,
    end_date date
);

--
-- Name: seasons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.seasons ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.seasons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id bigint NOT NULL,
    scope text NOT NULL,
    scope_id bigint,
    key text NOT NULL,
    value jsonb,
    notes text
);

--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.settings ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: team_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_aliases (
    id bigint NOT NULL,
    team_id bigint,
    alias text NOT NULL,
    source text
);

--
-- Name: team_aliases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.team_aliases ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.team_aliases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id bigint NOT NULL,
    name text NOT NULL,
    short_name text,
    country text,
    active boolean DEFAULT true
);

--
-- Name: teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.teams ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.teams_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: tournament_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_entries (
    id bigint NOT NULL,
    tournament_id bigint,
    team_id bigint,
    manager_id bigint,
    seed integer,
    rating integer,
    group_code text,
    entry_status text DEFAULT 'active'::text,
    prize_draw_eligible boolean DEFAULT true,
    notes text,
    pot integer,
    qualifying_position integer,
    final_position integer,
    eliminated_in text,
    qualified_for_secondary boolean DEFAULT false,
    withdrawn boolean DEFAULT false,
    disqualified boolean DEFAULT false
);

--
-- Name: tournament_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tournament_entries ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.tournament_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: tournament_formats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_formats (
    id bigint NOT NULL,
    name text NOT NULL,
    description text,
    has_group_stage boolean DEFAULT true,
    has_knockout_stage boolean DEFAULT true,
    has_secondary_bracket boolean DEFAULT false,
    group_size integer,
    legs_group_stage integer DEFAULT 1,
    legs_knockout_stage integer DEFAULT 1,
    notes text
);

--
-- Name: tournament_formats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tournament_formats ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.tournament_formats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: tournament_public_routes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.tournament_public_routes WITH (security_invoker='true') AS
 SELECT t.id,
    t.name,
    t.status,
    t.season_number,
    t.slug,
    t.public_slug,
    t.is_public,
    t.registration_status,
    t.archive_quality,
    gw.name AS game_world_name,
    gw.slug AS game_world_slug,
    ct.name AS competition_name,
    ct.slug AS competition_slug,
    (((('/'::text || gw.slug) || '/'::text) || ct.slug) ||
        CASE
            WHEN (t.public_slug IS NOT NULL) THEN ('/'::text || t.public_slug)
            ELSE ''::text
        END) AS archive_path,
    ((('/'::text || gw.slug) || '/'::text) || ct.slug) AS live_path
   FROM ((public.tournaments t
     JOIN public.game_worlds gw ON ((gw.id = t.game_world_id)))
     JOIN public.competition_types ct ON ((ct.id = t.competition_type_id)))
  WHERE ((t.is_public = true) AND ((t.status <> ALL (ARRAY['archived'::text, 'completed'::text])) OR (t.archive_quality = ANY (ARRAY['partial'::text, 'complete'::text])) OR (COALESCE(t.source, ''::text) = 'challonge'::text)));

--
-- Name: tournament_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_registrations (
    id bigint NOT NULL,
    tournament_id bigint NOT NULL,
    manager_name text NOT NULL,
    manager_email text,
    club_name text NOT NULL,
    rating numeric,
    notes text,
    status text DEFAULT 'pending'::text NOT NULL,
    manager_key text NOT NULL,
    email_key text,
    club_key text NOT NULL,
    duplicate_reason text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    review_notes text,
    promoted_entry_id bigint,
    promoted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tournament_registrations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text])))
);

--
-- Name: tournament_registrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tournament_registrations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: tournament_registrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tournament_registrations_id_seq OWNED BY public.tournament_registrations.id;

--
-- Name: tournament_round_dates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_round_dates (
    id bigint NOT NULL,
    tournament_id bigint NOT NULL,
    bracket text NOT NULL,
    round text NOT NULL,
    leg1_date date NOT NULL,
    leg2_date date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tournament_round_dates_bracket_check CHECK ((bracket = ANY (ARRAY['Cup'::text, 'Shield'::text])))
);

--
-- Name: tournament_round_dates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tournament_round_dates ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.tournament_round_dates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: tournament_round_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_round_templates (
    id bigint NOT NULL,
    format_id bigint NOT NULL,
    bracket text NOT NULL,
    round_name text NOT NULL,
    round_order integer NOT NULL,
    round_type text DEFAULT 'knockout'::text NOT NULL,
    legs integer DEFAULT 1 NOT NULL,
    away_goals boolean DEFAULT true NOT NULL,
    fictional_extra_time boolean DEFAULT true NOT NULL,
    penalties boolean DEFAULT false NOT NULL,
    loser_to_bracket text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: tournament_round_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tournament_round_templates ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.tournament_round_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: tournament_rounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_rounds (
    id bigint NOT NULL,
    tournament_id bigint,
    stage_id bigint,
    name text NOT NULL,
    round_order integer NOT NULL,
    round_type text NOT NULL,
    legs integer DEFAULT 1,
    scheduled_at timestamp with time zone,
    notes text
);

--
-- Name: tournament_rounds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tournament_rounds ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.tournament_rounds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: tournament_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_stages (
    id bigint NOT NULL,
    tournament_id bigint,
    name text NOT NULL,
    stage_type text NOT NULL,
    stage_order integer NOT NULL,
    bracket_name text,
    entrants_from text,
    notes text
);

--
-- Name: tournament_stages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tournament_stages ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.tournament_stages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: tournaments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tournaments ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.tournaments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: competition_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_types ALTER COLUMN id SET DEFAULT nextval('public.competition_types_id_seq'::regclass);

--
-- Name: game_worlds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_worlds ALTER COLUMN id SET DEFAULT nextval('public.game_worlds_id_seq'::regclass);

--
-- Name: match_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_comments ALTER COLUMN id SET DEFAULT nextval('public.match_comments_id_seq'::regclass);

--
-- Name: tournament_registrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_registrations ALTER COLUMN id SET DEFAULT nextval('public.tournament_registrations_id_seq'::regclass);

--
-- Name: achievements achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_pkey PRIMARY KEY (id);

--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (user_id);

--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);

--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

--
-- Name: competition_types competition_types_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_types
    ADD CONSTRAINT competition_types_name_key UNIQUE (name);

--
-- Name: competition_types competition_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_types
    ADD CONSTRAINT competition_types_pkey PRIMARY KEY (id);

--
-- Name: competition_types competition_types_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_types
    ADD CONSTRAINT competition_types_slug_key UNIQUE (slug);

--
-- Name: competitions competitions_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_name_key UNIQUE (name);

--
-- Name: competitions competitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_pkey PRIMARY KEY (id);

--
-- Name: content_reports content_reports_content_type_content_id_reporter_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_content_type_content_id_reporter_id_key UNIQUE (content_type, content_id, reporter_id);

--
-- Name: content_reports content_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_pkey PRIMARY KEY (id);

--
-- Name: fixture_templates fixture_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixture_templates
    ADD CONSTRAINT fixture_templates_pkey PRIMARY KEY (id);

--
-- Name: fixture_templates fixture_templates_round_template_id_leg_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixture_templates
    ADD CONSTRAINT fixture_templates_round_template_id_leg_key UNIQUE (round_template_id, leg);

--
-- Name: forfeits forfeits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forfeits
    ADD CONSTRAINT forfeits_pkey PRIMARY KEY (id);

--
-- Name: game_worlds game_worlds_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_worlds
    ADD CONSTRAINT game_worlds_name_key UNIQUE (name);

--
-- Name: game_worlds game_worlds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_worlds
    ADD CONSTRAINT game_worlds_pkey PRIMARY KEY (id);

--
-- Name: game_worlds game_worlds_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_worlds
    ADD CONSTRAINT game_worlds_slug_key UNIQUE (slug);

--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);

--
-- Name: groups groups_tournament_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_tournament_id_code_key UNIQUE (tournament_id, code);

--
-- Name: honours honours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honours
    ADD CONSTRAINT honours_pkey PRIMARY KEY (id);

--
-- Name: manager_clubs manager_clubs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_clubs
    ADD CONSTRAINT manager_clubs_pkey PRIMARY KEY (id);

--
-- Name: manager_portal_accounts manager_portal_accounts_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_portal_accounts
    ADD CONSTRAINT manager_portal_accounts_auth_user_id_key UNIQUE (auth_user_id);

--
-- Name: manager_portal_accounts manager_portal_accounts_manager_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_portal_accounts
    ADD CONSTRAINT manager_portal_accounts_manager_id_key UNIQUE (manager_id);

--
-- Name: manager_portal_accounts manager_portal_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_portal_accounts
    ADD CONSTRAINT manager_portal_accounts_pkey PRIMARY KEY (id);

--
-- Name: manager_portal_claims manager_portal_claims_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_portal_claims
    ADD CONSTRAINT manager_portal_claims_auth_user_id_key UNIQUE (auth_user_id);

--
-- Name: manager_portal_claims manager_portal_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_portal_claims
    ADD CONSTRAINT manager_portal_claims_pkey PRIMARY KEY (id);

--
-- Name: manager_result_submissions manager_result_submissions_match_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_result_submissions
    ADD CONSTRAINT manager_result_submissions_match_id_key UNIQUE (match_id);

--
-- Name: manager_result_submissions manager_result_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_result_submissions
    ADD CONSTRAINT manager_result_submissions_pkey PRIMARY KEY (id);

--
-- Name: manager_team_aliases manager_team_aliases_alias_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_team_aliases
    ADD CONSTRAINT manager_team_aliases_alias_key_key UNIQUE (alias_key);

--
-- Name: manager_team_aliases manager_team_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_team_aliases
    ADD CONSTRAINT manager_team_aliases_pkey PRIMARY KEY (id);

--
-- Name: managers managers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managers
    ADD CONSTRAINT managers_pkey PRIMARY KEY (id);

--
-- Name: match_comments match_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_comments
    ADD CONSTRAINT match_comments_pkey PRIMARY KEY (id);

--
-- Name: match_result_revisions match_result_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_result_revisions
    ADD CONSTRAINT match_result_revisions_pkey PRIMARY KEY (id);

--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);

--
-- Name: qualification_rules qualification_rules_format_id_bracket_rank_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qualification_rules
    ADD CONSTRAINT qualification_rules_format_id_bracket_rank_order_key UNIQUE (format_id, bracket, rank_order);

--
-- Name: qualification_rules qualification_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qualification_rules
    ADD CONSTRAINT qualification_rules_pkey PRIMARY KEY (id);

--
-- Name: seasons seasons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_code_key UNIQUE (code);

--
-- Name: seasons seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);

--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);

--
-- Name: settings settings_scope_scope_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_scope_scope_id_key_key UNIQUE (scope, scope_id, key);

--
-- Name: team_aliases team_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_aliases
    ADD CONSTRAINT team_aliases_pkey PRIMARY KEY (id);

--
-- Name: team_aliases team_aliases_team_id_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_aliases
    ADD CONSTRAINT team_aliases_team_id_alias_key UNIQUE (team_id, alias);

--
-- Name: teams teams_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_name_key UNIQUE (name);

--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);

--
-- Name: tournament_entries tournament_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_entries
    ADD CONSTRAINT tournament_entries_pkey PRIMARY KEY (id);

--
-- Name: tournament_entries tournament_entries_tournament_id_team_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_entries
    ADD CONSTRAINT tournament_entries_tournament_id_team_id_key UNIQUE (tournament_id, team_id);

--
-- Name: tournament_formats tournament_formats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_formats
    ADD CONSTRAINT tournament_formats_pkey PRIMARY KEY (id);

--
-- Name: tournament_registrations tournament_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_registrations
    ADD CONSTRAINT tournament_registrations_pkey PRIMARY KEY (id);

--
-- Name: tournament_round_dates tournament_round_dates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_round_dates
    ADD CONSTRAINT tournament_round_dates_pkey PRIMARY KEY (id);

--
-- Name: tournament_round_dates tournament_round_dates_tournament_id_bracket_round_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_round_dates
    ADD CONSTRAINT tournament_round_dates_tournament_id_bracket_round_key UNIQUE (tournament_id, bracket, round);

--
-- Name: tournament_round_templates tournament_round_templates_format_id_bracket_round_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_round_templates
    ADD CONSTRAINT tournament_round_templates_format_id_bracket_round_name_key UNIQUE (format_id, bracket, round_name);

--
-- Name: tournament_round_templates tournament_round_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_round_templates
    ADD CONSTRAINT tournament_round_templates_pkey PRIMARY KEY (id);

--
-- Name: tournament_rounds tournament_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_rounds
    ADD CONSTRAINT tournament_rounds_pkey PRIMARY KEY (id);

--
-- Name: tournament_rounds tournament_rounds_stage_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_rounds
    ADD CONSTRAINT tournament_rounds_stage_id_name_key UNIQUE (stage_id, name);

--
-- Name: tournament_stages tournament_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_stages
    ADD CONSTRAINT tournament_stages_pkey PRIMARY KEY (id);

--
-- Name: tournament_stages tournament_stages_tournament_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_stages
    ADD CONSTRAINT tournament_stages_tournament_id_name_key UNIQUE (tournament_id, name);

--
-- Name: tournaments tournaments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_pkey PRIMARY KEY (id);

--
-- Name: content_reports_content_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_reports_content_idx ON public.content_reports USING btree (content_type, content_id);

--
-- Name: content_reports_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_reports_status_created_idx ON public.content_reports USING btree (status, created_at DESC);

--
-- Name: fixture_templates_round_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fixture_templates_round_idx ON public.fixture_templates USING btree (round_template_id, leg);

--
-- Name: forfeits_manager_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forfeits_manager_id_idx ON public.forfeits USING btree (manager_id);

--
-- Name: forfeits_match_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX forfeits_match_id_unique ON public.forfeits USING btree (match_id) WHERE (match_id IS NOT NULL);

--
-- Name: manager_portal_accounts_email_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX manager_portal_accounts_email_lower_idx ON public.manager_portal_accounts USING btree (lower(email));

--
-- Name: match_comments_match_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_comments_match_id_idx ON public.match_comments USING btree (match_id);

--
-- Name: match_comments_match_pinned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_comments_match_pinned_idx ON public.match_comments USING btree (match_id, is_pinned DESC, editor_pick DESC, created_at);

--
-- Name: match_comments_tournament_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_comments_tournament_status_idx ON public.match_comments USING btree (tournament_id, status, created_at DESC);

--
-- Name: qualification_rules_format_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX qualification_rules_format_idx ON public.qualification_rules USING btree (format_id, bracket, rank_order);

--
-- Name: tournament_registrations_active_club_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tournament_registrations_active_club_idx ON public.tournament_registrations USING btree (tournament_id, club_key) WHERE (status = ANY (ARRAY['pending'::text, 'approved'::text]));

--
-- Name: tournament_registrations_active_manager_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tournament_registrations_active_manager_idx ON public.tournament_registrations USING btree (tournament_id, manager_key) WHERE (status = ANY (ARRAY['pending'::text, 'approved'::text]));

--
-- Name: tournament_registrations_tournament_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tournament_registrations_tournament_status_idx ON public.tournament_registrations USING btree (tournament_id, status, submitted_at DESC);

--
-- Name: tournament_round_dates_tournament_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tournament_round_dates_tournament_idx ON public.tournament_round_dates USING btree (tournament_id, bracket, round);

--
-- Name: tournament_round_templates_format_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tournament_round_templates_format_idx ON public.tournament_round_templates USING btree (format_id, bracket, round_order);

--
-- Name: tournaments_world_comp_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tournaments_world_comp_status_idx ON public.tournaments USING btree (game_world_id, competition_type_id, status, season_number DESC);

--
-- Name: manager_portal_claims manager_portal_claim_auto_match; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER manager_portal_claim_auto_match BEFORE INSERT OR UPDATE OF claimed_manager_name, claimed_club_name ON public.manager_portal_claims FOR EACH ROW EXECUTE FUNCTION public.populate_manager_portal_claim_suggestion();

--
-- Name: match_comments prevent_repeated_match_comment_spam_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_repeated_match_comment_spam_trigger BEFORE INSERT ON public.match_comments FOR EACH ROW EXECUTE FUNCTION public.prevent_repeated_match_comment_spam();

--
-- Name: manager_result_submissions protect_final_manager_result_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER protect_final_manager_result_trigger BEFORE UPDATE ON public.manager_result_submissions FOR EACH ROW EXECUTE FUNCTION public.protect_final_manager_result();

--
-- Name: manager_portal_claims sanitise_manager_claim_reviewer_label; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sanitise_manager_claim_reviewer_label BEFORE INSERT OR UPDATE OF reviewed_by_label ON public.manager_portal_claims FOR EACH ROW EXECUTE FUNCTION public.sanitise_manager_claim_reviewer_label();

--
-- Name: matches sync_match_forfeit_record; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_match_forfeit_record AFTER INSERT OR UPDATE OF status, home_score, away_score, home_entry_id, away_entry_id, loser_entry_id ON public.matches FOR EACH ROW EXECUTE FUNCTION public.sync_match_forfeit_record();

--
-- Name: tournament_registrations tournament_registrations_keys_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tournament_registrations_keys_trigger BEFORE INSERT OR UPDATE OF manager_name, manager_email, club_name, status, review_notes ON public.tournament_registrations FOR EACH ROW EXECUTE FUNCTION public.set_registration_keys();

--
-- Name: manager_team_aliases validate_manager_team_alias_source; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_manager_team_alias_source BEFORE INSERT OR UPDATE OF team_id, created_from_claim_id ON public.manager_team_aliases FOR EACH ROW EXECUTE FUNCTION public.validate_manager_team_alias_source();

--
-- Name: achievements achievements_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.tournament_entries(id);

--
-- Name: achievements achievements_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.managers(id);

--
-- Name: achievements achievements_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);

--
-- Name: achievements achievements_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

--
-- Name: admin_users admin_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: content_reports content_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: content_reports content_reports_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: fixture_templates fixture_templates_round_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixture_templates
    ADD CONSTRAINT fixture_templates_round_template_id_fkey FOREIGN KEY (round_template_id) REFERENCES public.tournament_round_templates(id) ON DELETE CASCADE;

--
-- Name: forfeits forfeits_forfeiting_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forfeits
    ADD CONSTRAINT forfeits_forfeiting_entry_id_fkey FOREIGN KEY (forfeiting_entry_id) REFERENCES public.tournament_entries(id);

--
-- Name: forfeits forfeits_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forfeits
    ADD CONSTRAINT forfeits_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.managers(id) ON DELETE SET NULL;

--
-- Name: forfeits forfeits_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forfeits
    ADD CONSTRAINT forfeits_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;

--
-- Name: groups groups_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

--
-- Name: honours honours_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honours
    ADD CONSTRAINT honours_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.tournament_entries(id);

--
-- Name: honours honours_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honours
    ADD CONSTRAINT honours_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

--
-- Name: manager_clubs manager_clubs_from_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_clubs
    ADD CONSTRAINT manager_clubs_from_season_id_fkey FOREIGN KEY (from_season_id) REFERENCES public.seasons(id);

--
-- Name: manager_clubs manager_clubs_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_clubs
    ADD CONSTRAINT manager_clubs_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.managers(id) ON DELETE CASCADE;

--
-- Name: manager_clubs manager_clubs_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_clubs
    ADD CONSTRAINT manager_clubs_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

--
-- Name: manager_clubs manager_clubs_to_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_clubs
    ADD CONSTRAINT manager_clubs_to_season_id_fkey FOREIGN KEY (to_season_id) REFERENCES public.seasons(id);

--
-- Name: manager_portal_accounts manager_portal_accounts_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_portal_accounts
    ADD CONSTRAINT manager_portal_accounts_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: manager_portal_accounts manager_portal_accounts_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_portal_accounts
    ADD CONSTRAINT manager_portal_accounts_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.managers(id) ON DELETE CASCADE;

--
-- Name: manager_portal_claims manager_portal_claims_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_portal_claims
    ADD CONSTRAINT manager_portal_claims_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: manager_portal_claims manager_portal_claims_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_portal_claims
    ADD CONSTRAINT manager_portal_claims_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: manager_portal_claims manager_portal_claims_suggested_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_portal_claims
    ADD CONSTRAINT manager_portal_claims_suggested_manager_id_fkey FOREIGN KEY (suggested_manager_id) REFERENCES public.managers(id) ON DELETE SET NULL;

--
-- Name: manager_result_submissions manager_result_submissions_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_result_submissions
    ADD CONSTRAINT manager_result_submissions_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;

--
-- Name: manager_result_submissions manager_result_submissions_opponent_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_result_submissions
    ADD CONSTRAINT manager_result_submissions_opponent_manager_id_fkey FOREIGN KEY (opponent_manager_id) REFERENCES public.managers(id) ON DELETE SET NULL;

--
-- Name: manager_result_submissions manager_result_submissions_opponent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_result_submissions
    ADD CONSTRAINT manager_result_submissions_opponent_user_id_fkey FOREIGN KEY (opponent_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: manager_result_submissions manager_result_submissions_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_result_submissions
    ADD CONSTRAINT manager_result_submissions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: manager_result_submissions manager_result_submissions_submitted_by_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_result_submissions
    ADD CONSTRAINT manager_result_submissions_submitted_by_manager_id_fkey FOREIGN KEY (submitted_by_manager_id) REFERENCES public.managers(id) ON DELETE CASCADE;

--
-- Name: manager_result_submissions manager_result_submissions_submitted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_result_submissions
    ADD CONSTRAINT manager_result_submissions_submitted_by_user_id_fkey FOREIGN KEY (submitted_by_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: manager_team_aliases manager_team_aliases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_team_aliases
    ADD CONSTRAINT manager_team_aliases_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: manager_team_aliases manager_team_aliases_created_from_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_team_aliases
    ADD CONSTRAINT manager_team_aliases_created_from_claim_id_fkey FOREIGN KEY (created_from_claim_id) REFERENCES public.manager_portal_claims(id) ON DELETE SET NULL;

--
-- Name: manager_team_aliases manager_team_aliases_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_team_aliases
    ADD CONSTRAINT manager_team_aliases_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

--
-- Name: managers managers_joined_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managers
    ADD CONSTRAINT managers_joined_season_id_fkey FOREIGN KEY (joined_season_id) REFERENCES public.seasons(id);

--
-- Name: managers managers_retired_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managers
    ADD CONSTRAINT managers_retired_season_id_fkey FOREIGN KEY (retired_season_id) REFERENCES public.seasons(id);

--
-- Name: match_comments match_comments_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_comments
    ADD CONSTRAINT match_comments_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;

--
-- Name: match_comments match_comments_moderated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_comments
    ADD CONSTRAINT match_comments_moderated_by_fkey FOREIGN KEY (moderated_by) REFERENCES auth.users(id);

--
-- Name: match_comments match_comments_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_comments
    ADD CONSTRAINT match_comments_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

--
-- Name: match_result_revisions match_result_revisions_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_result_revisions
    ADD CONSTRAINT match_result_revisions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: match_result_revisions match_result_revisions_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_result_revisions
    ADD CONSTRAINT match_result_revisions_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;

--
-- Name: match_result_revisions match_result_revisions_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_result_revisions
    ADD CONSTRAINT match_result_revisions_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.manager_result_submissions(id) ON DELETE SET NULL;

--
-- Name: matches matches_away_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_away_entry_id_fkey FOREIGN KEY (away_entry_id) REFERENCES public.tournament_entries(id);

--
-- Name: matches matches_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id);

--
-- Name: matches matches_home_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_home_entry_id_fkey FOREIGN KEY (home_entry_id) REFERENCES public.tournament_entries(id);

--
-- Name: matches matches_loser_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_loser_entry_id_fkey FOREIGN KEY (loser_entry_id) REFERENCES public.tournament_entries(id);

--
-- Name: matches matches_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.tournament_rounds(id);

--
-- Name: matches matches_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.tournament_stages(id);

--
-- Name: matches matches_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

--
-- Name: matches matches_winner_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_winner_entry_id_fkey FOREIGN KEY (winner_entry_id) REFERENCES public.tournament_entries(id);

--
-- Name: qualification_rules qualification_rules_format_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qualification_rules
    ADD CONSTRAINT qualification_rules_format_id_fkey FOREIGN KEY (format_id) REFERENCES public.tournament_formats(id) ON DELETE CASCADE;

--
-- Name: team_aliases team_aliases_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_aliases
    ADD CONSTRAINT team_aliases_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

--
-- Name: tournament_entries tournament_entries_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_entries
    ADD CONSTRAINT tournament_entries_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.managers(id);

--
-- Name: tournament_entries tournament_entries_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_entries
    ADD CONSTRAINT tournament_entries_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);

--
-- Name: tournament_entries tournament_entries_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_entries
    ADD CONSTRAINT tournament_entries_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

--
-- Name: tournament_registrations tournament_registrations_promoted_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_registrations
    ADD CONSTRAINT tournament_registrations_promoted_entry_id_fkey FOREIGN KEY (promoted_entry_id) REFERENCES public.tournament_entries(id) ON DELETE SET NULL;

--
-- Name: tournament_registrations tournament_registrations_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_registrations
    ADD CONSTRAINT tournament_registrations_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);

--
-- Name: tournament_registrations tournament_registrations_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_registrations
    ADD CONSTRAINT tournament_registrations_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

--
-- Name: tournament_round_dates tournament_round_dates_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_round_dates
    ADD CONSTRAINT tournament_round_dates_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

--
-- Name: tournament_round_templates tournament_round_templates_format_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_round_templates
    ADD CONSTRAINT tournament_round_templates_format_id_fkey FOREIGN KEY (format_id) REFERENCES public.tournament_formats(id) ON DELETE CASCADE;

--
-- Name: tournament_rounds tournament_rounds_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_rounds
    ADD CONSTRAINT tournament_rounds_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.tournament_stages(id) ON DELETE CASCADE;

--
-- Name: tournament_rounds tournament_rounds_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_rounds
    ADD CONSTRAINT tournament_rounds_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

--
-- Name: tournament_stages tournament_stages_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_stages
    ADD CONSTRAINT tournament_stages_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

--
-- Name: tournaments tournaments_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id);

--
-- Name: tournaments tournaments_competition_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_competition_type_id_fkey FOREIGN KEY (competition_type_id) REFERENCES public.competition_types(id);

--
-- Name: tournaments tournaments_format_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_format_id_fkey FOREIGN KEY (format_id) REFERENCES public.tournament_formats(id);

--
-- Name: tournaments tournaments_game_world_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_game_world_id_fkey FOREIGN KEY (game_world_id) REFERENCES public.game_worlds(id);

--
-- Name: tournaments tournaments_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

--
-- Name: manager_portal_claims Admins can manage manager claims; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage manager claims" ON public.manager_portal_claims TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: manager_portal_accounts Admins can manage manager portal accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage manager portal accounts" ON public.manager_portal_accounts TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));

--
-- Name: manager_team_aliases Admins can manage manager team aliases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage manager team aliases" ON public.manager_team_aliases TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: match_result_revisions Admins can manage result revisions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage result revisions" ON public.match_result_revisions TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: manager_result_submissions Admins can manage result submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage result submissions" ON public.manager_result_submissions TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: match_result_revisions Admins can read result revisions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read result revisions" ON public.match_result_revisions FOR SELECT TO authenticated USING (public.is_admin());

--
-- Name: tournament_registrations Admins delete registrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete registrations" ON public.tournament_registrations FOR DELETE TO authenticated USING (public.is_admin());

--
-- Name: competition_types Admins manage competition types; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage competition types" ON public.competition_types TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: game_worlds Admins manage game worlds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage game worlds" ON public.game_worlds TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: match_comments Admins manage match comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage match comments" ON public.match_comments TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: content_reports Admins manage reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage reports" ON public.content_reports TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: tournament_registrations Admins read registrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read registrations" ON public.tournament_registrations FOR SELECT TO authenticated USING (public.is_admin());

--
-- Name: tournament_registrations Admins update registrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update registrations" ON public.tournament_registrations FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: manager_result_submissions Managers can read submissions for their matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can read submissions for their matches" ON public.manager_result_submissions FOR SELECT TO authenticated USING ((public.is_admin() OR (submitted_by_user_id = auth.uid()) OR (opponent_user_id = auth.uid())));

--
-- Name: manager_portal_accounts Managers can read their own portal account; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can read their own portal account" ON public.manager_portal_accounts FOR SELECT TO authenticated USING ((auth.uid() = auth_user_id));

--
-- Name: match_comments Public publish visible match comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public publish visible match comments" ON public.match_comments FOR INSERT TO anon, authenticated WITH CHECK (((status = 'visible'::text) AND (COALESCE(is_pinned, false) = false) AND (COALESCE(editor_pick, false) = false) AND (comment_type = ANY (ARRAY['pre_match'::text, 'post_match'::text])) AND (contribution_type = ANY (ARRAY['statement'::text, 'question'::text, 'comment'::text])) AND ((length(TRIM(BOTH FROM manager_name)) >= 2) AND (length(TRIM(BOTH FROM manager_name)) <= 80)) AND ((length(TRIM(BOTH FROM comment)) >= 3) AND (length(TRIM(BOTH FROM comment)) <= 500))));

--
-- Name: competition_types Public read competition types; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read competition types" ON public.competition_types FOR SELECT TO anon, authenticated USING ((is_active = true));

--
-- Name: game_worlds Public read game worlds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read game worlds" ON public.game_worlds FOR SELECT TO anon, authenticated USING ((is_active = true));

--
-- Name: managers Public read managers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read managers" ON public.managers FOR SELECT TO anon, authenticated USING (true);

--
-- Name: teams Public read teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read teams" ON public.teams FOR SELECT TO anon, authenticated USING (true);

--
-- Name: match_comments Public read visible match comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read visible match comments" ON public.match_comments FOR SELECT TO anon, authenticated USING ((status = 'visible'::text));

--
-- Name: content_reports Signed-in users create reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Signed-in users create reports" ON public.content_reports FOR INSERT TO authenticated WITH CHECK (((reporter_id = auth.uid()) AND (status = 'unresolved'::text)));

--
-- Name: manager_portal_claims Users can correct their own manager claim; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can correct their own manager claim" ON public.manager_portal_claims FOR UPDATE TO authenticated USING (((auth.uid() = auth_user_id) AND (status = ANY (ARRAY['pending'::text, 'rejected'::text])))) WITH CHECK (((auth.uid() = auth_user_id) AND (status = 'pending'::text) AND (lower(email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))));

--
-- Name: manager_portal_claims Users can create their own manager claim; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own manager claim" ON public.manager_portal_claims FOR INSERT TO authenticated WITH CHECK (((auth.uid() = auth_user_id) AND (lower(email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))));

--
-- Name: manager_portal_claims Users can read their own manager claim; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read their own manager claim" ON public.manager_portal_claims FOR SELECT TO authenticated USING ((auth.uid() = auth_user_id));

--
-- Name: content_reports Users read own reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own reports" ON public.content_reports FOR SELECT TO authenticated USING (((reporter_id = auth.uid()) OR public.is_admin()));

--
-- Name: achievements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

--
-- Name: attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: competition_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competition_types ENABLE ROW LEVEL SECURITY;

--
-- Name: competitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;

--
-- Name: content_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: fixture_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixture_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: forfeits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forfeits ENABLE ROW LEVEL SECURITY;

--
-- Name: game_worlds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_worlds ENABLE ROW LEVEL SECURITY;

--
-- Name: groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

--
-- Name: honours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.honours ENABLE ROW LEVEL SECURITY;

--
-- Name: manager_clubs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manager_clubs ENABLE ROW LEVEL SECURITY;

--
-- Name: manager_portal_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manager_portal_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: manager_portal_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manager_portal_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: manager_result_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manager_result_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: manager_team_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manager_team_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: managers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.managers ENABLE ROW LEVEL SECURITY;

--
-- Name: match_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: match_result_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_result_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

--
-- Name: competitions public can read competitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read competitions" ON public.competitions FOR SELECT USING (true);

--
-- Name: seasons public can read seasons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read seasons" ON public.seasons FOR SELECT USING (true);

--
-- Name: qualification_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qualification_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: seasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: team_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_formats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_formats ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_round_dates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_round_dates ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_round_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_round_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_rounds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_rounds ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: tournaments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

--
-- Name: FUNCTION admin_amend_match_result(target_match_id bigint, target_home_score integer, target_away_score integer, target_status text, note text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_amend_match_result(target_match_id bigint, target_home_score integer, target_away_score integer, target_status text, note text) TO anon;
GRANT ALL ON FUNCTION public.admin_amend_match_result(target_match_id bigint, target_home_score integer, target_away_score integer, target_status text, note text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_amend_match_result(target_match_id bigint, target_home_score integer, target_away_score integer, target_status text, note text) TO service_role;

--
-- Name: FUNCTION approve_manager_portal_claim(target_claim_id bigint, target_manager_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.approve_manager_portal_claim(target_claim_id bigint, target_manager_id bigint) TO anon;
GRANT ALL ON FUNCTION public.approve_manager_portal_claim(target_claim_id bigint, target_manager_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.approve_manager_portal_claim(target_claim_id bigint, target_manager_id bigint) TO service_role;

--
-- Name: FUNCTION approve_manager_portal_claim_with_alias(target_claim_id bigint, target_manager_id bigint, target_team_id bigint, remember_team_alias boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.approve_manager_portal_claim_with_alias(target_claim_id bigint, target_manager_id bigint, target_team_id bigint, remember_team_alias boolean) TO anon;
GRANT ALL ON FUNCTION public.approve_manager_portal_claim_with_alias(target_claim_id bigint, target_manager_id bigint, target_team_id bigint, remember_team_alias boolean) TO authenticated;
GRANT ALL ON FUNCTION public.approve_manager_portal_claim_with_alias(target_claim_id bigint, target_manager_id bigint, target_team_id bigint, remember_team_alias boolean) TO service_role;

--
-- Name: FUNCTION canonical_manager_claim_club(value text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.canonical_manager_claim_club(value text) TO anon;
GRANT ALL ON FUNCTION public.canonical_manager_claim_club(value text) TO authenticated;
GRANT ALL ON FUNCTION public.canonical_manager_claim_club(value text) TO service_role;

--
-- Name: FUNCTION create_seeded_test_tournament(source_tournament_id bigint, entrant_count integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_seeded_test_tournament(source_tournament_id bigint, entrant_count integer) TO anon;
GRANT ALL ON FUNCTION public.create_seeded_test_tournament(source_tournament_id bigint, entrant_count integer) TO authenticated;
GRANT ALL ON FUNCTION public.create_seeded_test_tournament(source_tournament_id bigint, entrant_count integer) TO service_role;

--
-- Name: FUNCTION find_manager_portal_claim_match(claimed_manager_name text, claimed_club_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.find_manager_portal_claim_match(claimed_manager_name text, claimed_club_name text) TO anon;
GRANT ALL ON FUNCTION public.find_manager_portal_claim_match(claimed_manager_name text, claimed_club_name text) TO authenticated;
GRANT ALL ON FUNCTION public.find_manager_portal_claim_match(claimed_manager_name text, claimed_club_name text) TO service_role;

--
-- Name: FUNCTION get_public_youth_winners(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_youth_winners() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_youth_winners() TO anon;
GRANT ALL ON FUNCTION public.get_public_youth_winners() TO authenticated;
GRANT ALL ON FUNCTION public.get_public_youth_winners() TO service_role;

--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;

--
-- Name: FUNCTION manager_portal_claim_candidates(claimed_manager_name text, claimed_club_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.manager_portal_claim_candidates(claimed_manager_name text, claimed_club_name text) TO anon;
GRANT ALL ON FUNCTION public.manager_portal_claim_candidates(claimed_manager_name text, claimed_club_name text) TO authenticated;
GRANT ALL ON FUNCTION public.manager_portal_claim_candidates(claimed_manager_name text, claimed_club_name text) TO service_role;

--
-- Name: FUNCTION manager_portal_claim_suggestions(target_claim_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.manager_portal_claim_suggestions(target_claim_id bigint) TO anon;
GRANT ALL ON FUNCTION public.manager_portal_claim_suggestions(target_claim_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.manager_portal_claim_suggestions(target_claim_id bigint) TO service_role;

--
-- Name: FUNCTION moderate_match_comment(target_comment_id bigint, target_status text, moderation_note text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.moderate_match_comment(target_comment_id bigint, target_status text, moderation_note text) TO anon;
GRANT ALL ON FUNCTION public.moderate_match_comment(target_comment_id bigint, target_status text, moderation_note text) TO authenticated;
GRANT ALL ON FUNCTION public.moderate_match_comment(target_comment_id bigint, target_status text, moderation_note text) TO service_role;

--
-- Name: FUNCTION normal_registration_key(value text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normal_registration_key(value text) TO anon;
GRANT ALL ON FUNCTION public.normal_registration_key(value text) TO authenticated;
GRANT ALL ON FUNCTION public.normal_registration_key(value text) TO service_role;

--
-- Name: FUNCTION normalise_manager_claim_text(value text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalise_manager_claim_text(value text) TO anon;
GRANT ALL ON FUNCTION public.normalise_manager_claim_text(value text) TO authenticated;
GRANT ALL ON FUNCTION public.normalise_manager_claim_text(value text) TO service_role;

--
-- Name: FUNCTION populate_manager_portal_claim_suggestion(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.populate_manager_portal_claim_suggestion() TO anon;
GRANT ALL ON FUNCTION public.populate_manager_portal_claim_suggestion() TO authenticated;
GRANT ALL ON FUNCTION public.populate_manager_portal_claim_suggestion() TO service_role;

--
-- Name: FUNCTION prevent_repeated_match_comment_spam(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_repeated_match_comment_spam() TO anon;
GRANT ALL ON FUNCTION public.prevent_repeated_match_comment_spam() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_repeated_match_comment_spam() TO service_role;

--
-- Name: FUNCTION promote_registration_to_entrant(registration_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.promote_registration_to_entrant(registration_id bigint) TO anon;
GRANT ALL ON FUNCTION public.promote_registration_to_entrant(registration_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.promote_registration_to_entrant(registration_id bigint) TO service_role;

--
-- Name: FUNCTION protect_final_manager_result(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.protect_final_manager_result() TO anon;
GRANT ALL ON FUNCTION public.protect_final_manager_result() TO authenticated;
GRANT ALL ON FUNCTION public.protect_final_manager_result() TO service_role;

--
-- Name: FUNCTION react_to_match_comment(comment_id bigint, reaction_key text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.react_to_match_comment(comment_id bigint, reaction_key text) TO anon;
GRANT ALL ON FUNCTION public.react_to_match_comment(comment_id bigint, reaction_key text) TO authenticated;
GRANT ALL ON FUNCTION public.react_to_match_comment(comment_id bigint, reaction_key text) TO service_role;

--
-- Name: FUNCTION reject_manager_portal_claim(target_claim_id bigint, notes text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reject_manager_portal_claim(target_claim_id bigint, notes text) TO anon;
GRANT ALL ON FUNCTION public.reject_manager_portal_claim(target_claim_id bigint, notes text) TO authenticated;
GRANT ALL ON FUNCTION public.reject_manager_portal_claim(target_claim_id bigint, notes text) TO service_role;

--
-- Name: FUNCTION reject_manager_result(target_submission_id bigint, note text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reject_manager_result(target_submission_id bigint, note text) TO anon;
GRANT ALL ON FUNCTION public.reject_manager_result(target_submission_id bigint, note text) TO authenticated;
GRANT ALL ON FUNCTION public.reject_manager_result(target_submission_id bigint, note text) TO service_role;

--
-- Name: FUNCTION report_match_comment(target_comment_id bigint, report_reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.report_match_comment(target_comment_id bigint, report_reason text) TO anon;
GRANT ALL ON FUNCTION public.report_match_comment(target_comment_id bigint, report_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.report_match_comment(target_comment_id bigint, report_reason text) TO service_role;

--
-- Name: FUNCTION resolve_manager_result(target_submission_id bigint, target_home_score integer, target_away_score integer, note text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.resolve_manager_result(target_submission_id bigint, target_home_score integer, target_away_score integer, note text) TO anon;
GRANT ALL ON FUNCTION public.resolve_manager_result(target_submission_id bigint, target_home_score integer, target_away_score integer, note text) TO authenticated;
GRANT ALL ON FUNCTION public.resolve_manager_result(target_submission_id bigint, target_home_score integer, target_away_score integer, note text) TO service_role;

--
-- Name: FUNCTION respond_to_manager_result(target_submission_id bigint, response text, note text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.respond_to_manager_result(target_submission_id bigint, response text, note text) TO anon;
GRANT ALL ON FUNCTION public.respond_to_manager_result(target_submission_id bigint, response text, note text) TO authenticated;
GRANT ALL ON FUNCTION public.respond_to_manager_result(target_submission_id bigint, response text, note text) TO service_role;

--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;

--
-- Name: FUNCTION sanitise_manager_claim_reviewer_label(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sanitise_manager_claim_reviewer_label() TO anon;
GRANT ALL ON FUNCTION public.sanitise_manager_claim_reviewer_label() TO authenticated;
GRANT ALL ON FUNCTION public.sanitise_manager_claim_reviewer_label() TO service_role;

--
-- Name: FUNCTION set_registration_keys(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_registration_keys() TO anon;
GRANT ALL ON FUNCTION public.set_registration_keys() TO authenticated;
GRANT ALL ON FUNCTION public.set_registration_keys() TO service_role;

--
-- Name: TABLE tournaments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournaments TO anon;
GRANT ALL ON TABLE public.tournaments TO authenticated;
GRANT ALL ON TABLE public.tournaments TO service_role;

--
-- Name: FUNCTION set_tournament_registration_window(target_tournament_id bigint, next_registration_status text, next_registration_opens_at timestamp with time zone, next_registration_closes_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_tournament_registration_window(target_tournament_id bigint, next_registration_status text, next_registration_opens_at timestamp with time zone, next_registration_closes_at timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.set_tournament_registration_window(target_tournament_id bigint, next_registration_status text, next_registration_opens_at timestamp with time zone, next_registration_closes_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.set_tournament_registration_window(target_tournament_id bigint, next_registration_status text, next_registration_opens_at timestamp with time zone, next_registration_closes_at timestamp with time zone) TO service_role;

--
-- Name: FUNCTION submit_manager_result(target_match_id bigint, target_home_score integer, target_away_score integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.submit_manager_result(target_match_id bigint, target_home_score integer, target_away_score integer) TO anon;
GRANT ALL ON FUNCTION public.submit_manager_result(target_match_id bigint, target_home_score integer, target_away_score integer) TO authenticated;
GRANT ALL ON FUNCTION public.submit_manager_result(target_match_id bigint, target_home_score integer, target_away_score integer) TO service_role;

--
-- Name: FUNCTION sync_match_forfeit_record(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_match_forfeit_record() TO anon;
GRANT ALL ON FUNCTION public.sync_match_forfeit_record() TO authenticated;
GRANT ALL ON FUNCTION public.sync_match_forfeit_record() TO service_role;

--
-- Name: FUNCTION validate_manager_team_alias_source(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_manager_team_alias_source() TO anon;
GRANT ALL ON FUNCTION public.validate_manager_team_alias_source() TO authenticated;
GRANT ALL ON FUNCTION public.validate_manager_team_alias_source() TO service_role;

--
-- Name: TABLE achievements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.achievements TO anon;
GRANT ALL ON TABLE public.achievements TO authenticated;
GRANT ALL ON TABLE public.achievements TO service_role;

--
-- Name: SEQUENCE achievements_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.achievements_id_seq TO anon;
GRANT ALL ON SEQUENCE public.achievements_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.achievements_id_seq TO service_role;

--
-- Name: TABLE admin_users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_users TO anon;
GRANT ALL ON TABLE public.admin_users TO authenticated;
GRANT ALL ON TABLE public.admin_users TO service_role;

--
-- Name: TABLE attachments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.attachments TO anon;
GRANT ALL ON TABLE public.attachments TO authenticated;
GRANT ALL ON TABLE public.attachments TO service_role;

--
-- Name: SEQUENCE attachments_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.attachments_id_seq TO anon;
GRANT ALL ON SEQUENCE public.attachments_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.attachments_id_seq TO service_role;

--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_log TO anon;
GRANT ALL ON TABLE public.audit_log TO authenticated;
GRANT ALL ON TABLE public.audit_log TO service_role;

--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.audit_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO service_role;

--
-- Name: TABLE competition_types; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competition_types TO anon;
GRANT ALL ON TABLE public.competition_types TO authenticated;
GRANT ALL ON TABLE public.competition_types TO service_role;

--
-- Name: SEQUENCE competition_types_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.competition_types_id_seq TO anon;
GRANT ALL ON SEQUENCE public.competition_types_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.competition_types_id_seq TO service_role;

--
-- Name: TABLE competitions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competitions TO anon;
GRANT ALL ON TABLE public.competitions TO authenticated;
GRANT ALL ON TABLE public.competitions TO service_role;

--
-- Name: SEQUENCE competitions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.competitions_id_seq TO anon;
GRANT ALL ON SEQUENCE public.competitions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.competitions_id_seq TO service_role;

--
-- Name: TABLE content_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.content_reports TO anon;
GRANT ALL ON TABLE public.content_reports TO authenticated;
GRANT ALL ON TABLE public.content_reports TO service_role;

--
-- Name: SEQUENCE content_reports_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.content_reports_id_seq TO anon;
GRANT ALL ON SEQUENCE public.content_reports_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.content_reports_id_seq TO service_role;

--
-- Name: TABLE fixture_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fixture_templates TO anon;
GRANT ALL ON TABLE public.fixture_templates TO authenticated;
GRANT ALL ON TABLE public.fixture_templates TO service_role;

--
-- Name: SEQUENCE fixture_templates_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.fixture_templates_id_seq TO anon;
GRANT ALL ON SEQUENCE public.fixture_templates_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.fixture_templates_id_seq TO service_role;

--
-- Name: TABLE forfeits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.forfeits TO anon;
GRANT ALL ON TABLE public.forfeits TO authenticated;
GRANT ALL ON TABLE public.forfeits TO service_role;

--
-- Name: SEQUENCE forfeits_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.forfeits_id_seq TO anon;
GRANT ALL ON SEQUENCE public.forfeits_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.forfeits_id_seq TO service_role;

--
-- Name: TABLE game_worlds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.game_worlds TO anon;
GRANT ALL ON TABLE public.game_worlds TO authenticated;
GRANT ALL ON TABLE public.game_worlds TO service_role;

--
-- Name: SEQUENCE game_worlds_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.game_worlds_id_seq TO anon;
GRANT ALL ON SEQUENCE public.game_worlds_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.game_worlds_id_seq TO service_role;

--
-- Name: TABLE groups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.groups TO anon;
GRANT ALL ON TABLE public.groups TO authenticated;
GRANT ALL ON TABLE public.groups TO service_role;

--
-- Name: SEQUENCE groups_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.groups_id_seq TO anon;
GRANT ALL ON SEQUENCE public.groups_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.groups_id_seq TO service_role;

--
-- Name: TABLE honours; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.honours TO anon;
GRANT ALL ON TABLE public.honours TO authenticated;
GRANT ALL ON TABLE public.honours TO service_role;

--
-- Name: SEQUENCE honours_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.honours_id_seq TO anon;
GRANT ALL ON SEQUENCE public.honours_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.honours_id_seq TO service_role;

--
-- Name: TABLE manager_clubs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.manager_clubs TO anon;
GRANT ALL ON TABLE public.manager_clubs TO authenticated;
GRANT ALL ON TABLE public.manager_clubs TO service_role;

--
-- Name: SEQUENCE manager_clubs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.manager_clubs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.manager_clubs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.manager_clubs_id_seq TO service_role;

--
-- Name: TABLE manager_portal_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.manager_portal_accounts TO anon;
GRANT ALL ON TABLE public.manager_portal_accounts TO authenticated;
GRANT ALL ON TABLE public.manager_portal_accounts TO service_role;

--
-- Name: SEQUENCE manager_portal_accounts_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.manager_portal_accounts_id_seq TO anon;
GRANT ALL ON SEQUENCE public.manager_portal_accounts_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.manager_portal_accounts_id_seq TO service_role;

--
-- Name: TABLE manager_portal_claims; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.manager_portal_claims TO anon;
GRANT ALL ON TABLE public.manager_portal_claims TO authenticated;
GRANT ALL ON TABLE public.manager_portal_claims TO service_role;

--
-- Name: SEQUENCE manager_portal_claims_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.manager_portal_claims_id_seq TO anon;
GRANT ALL ON SEQUENCE public.manager_portal_claims_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.manager_portal_claims_id_seq TO service_role;

--
-- Name: TABLE manager_result_submissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.manager_result_submissions TO anon;
GRANT ALL ON TABLE public.manager_result_submissions TO authenticated;
GRANT ALL ON TABLE public.manager_result_submissions TO service_role;

--
-- Name: SEQUENCE manager_result_submissions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.manager_result_submissions_id_seq TO anon;
GRANT ALL ON SEQUENCE public.manager_result_submissions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.manager_result_submissions_id_seq TO service_role;

--
-- Name: TABLE manager_team_aliases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.manager_team_aliases TO anon;
GRANT ALL ON TABLE public.manager_team_aliases TO authenticated;
GRANT ALL ON TABLE public.manager_team_aliases TO service_role;

--
-- Name: SEQUENCE manager_team_aliases_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.manager_team_aliases_id_seq TO anon;
GRANT ALL ON SEQUENCE public.manager_team_aliases_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.manager_team_aliases_id_seq TO service_role;

--
-- Name: TABLE managers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.managers TO anon;
GRANT ALL ON TABLE public.managers TO authenticated;
GRANT ALL ON TABLE public.managers TO service_role;

--
-- Name: SEQUENCE managers_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.managers_id_seq TO anon;
GRANT ALL ON SEQUENCE public.managers_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.managers_id_seq TO service_role;

--
-- Name: TABLE match_comments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.match_comments TO anon;
GRANT ALL ON TABLE public.match_comments TO authenticated;
GRANT ALL ON TABLE public.match_comments TO service_role;

--
-- Name: SEQUENCE match_comments_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.match_comments_id_seq TO anon;
GRANT ALL ON SEQUENCE public.match_comments_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.match_comments_id_seq TO service_role;

--
-- Name: TABLE match_result_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.match_result_revisions TO anon;
GRANT ALL ON TABLE public.match_result_revisions TO authenticated;
GRANT ALL ON TABLE public.match_result_revisions TO service_role;

--
-- Name: SEQUENCE match_result_revisions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.match_result_revisions_id_seq TO anon;
GRANT ALL ON SEQUENCE public.match_result_revisions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.match_result_revisions_id_seq TO service_role;

--
-- Name: TABLE matches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.matches TO anon;
GRANT ALL ON TABLE public.matches TO authenticated;
GRANT ALL ON TABLE public.matches TO service_role;

--
-- Name: SEQUENCE matches_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.matches_id_seq TO anon;
GRANT ALL ON SEQUENCE public.matches_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.matches_id_seq TO service_role;

--
-- Name: TABLE qualification_rules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.qualification_rules TO anon;
GRANT ALL ON TABLE public.qualification_rules TO authenticated;
GRANT ALL ON TABLE public.qualification_rules TO service_role;

--
-- Name: SEQUENCE qualification_rules_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.qualification_rules_id_seq TO anon;
GRANT ALL ON SEQUENCE public.qualification_rules_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.qualification_rules_id_seq TO service_role;

--
-- Name: TABLE seasons; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seasons TO anon;
GRANT ALL ON TABLE public.seasons TO authenticated;
GRANT ALL ON TABLE public.seasons TO service_role;

--
-- Name: SEQUENCE seasons_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.seasons_id_seq TO anon;
GRANT ALL ON SEQUENCE public.seasons_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.seasons_id_seq TO service_role;

--
-- Name: TABLE settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.settings TO anon;
GRANT ALL ON TABLE public.settings TO authenticated;
GRANT ALL ON TABLE public.settings TO service_role;

--
-- Name: SEQUENCE settings_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.settings_id_seq TO anon;
GRANT ALL ON SEQUENCE public.settings_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.settings_id_seq TO service_role;

--
-- Name: TABLE team_aliases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_aliases TO anon;
GRANT ALL ON TABLE public.team_aliases TO authenticated;
GRANT ALL ON TABLE public.team_aliases TO service_role;

--
-- Name: SEQUENCE team_aliases_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.team_aliases_id_seq TO anon;
GRANT ALL ON SEQUENCE public.team_aliases_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.team_aliases_id_seq TO service_role;

--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teams TO anon;
GRANT ALL ON TABLE public.teams TO authenticated;
GRANT ALL ON TABLE public.teams TO service_role;

--
-- Name: SEQUENCE teams_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.teams_id_seq TO anon;
GRANT ALL ON SEQUENCE public.teams_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.teams_id_seq TO service_role;

--
-- Name: TABLE tournament_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_entries TO anon;
GRANT ALL ON TABLE public.tournament_entries TO authenticated;
GRANT ALL ON TABLE public.tournament_entries TO service_role;

--
-- Name: SEQUENCE tournament_entries_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.tournament_entries_id_seq TO anon;
GRANT ALL ON SEQUENCE public.tournament_entries_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.tournament_entries_id_seq TO service_role;

--
-- Name: TABLE tournament_formats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_formats TO anon;
GRANT ALL ON TABLE public.tournament_formats TO authenticated;
GRANT ALL ON TABLE public.tournament_formats TO service_role;

--
-- Name: SEQUENCE tournament_formats_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.tournament_formats_id_seq TO anon;
GRANT ALL ON SEQUENCE public.tournament_formats_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.tournament_formats_id_seq TO service_role;

--
-- Name: TABLE tournament_public_routes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_public_routes TO anon;
GRANT ALL ON TABLE public.tournament_public_routes TO authenticated;
GRANT ALL ON TABLE public.tournament_public_routes TO service_role;

--
-- Name: TABLE tournament_registrations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_registrations TO anon;
GRANT ALL ON TABLE public.tournament_registrations TO authenticated;
GRANT ALL ON TABLE public.tournament_registrations TO service_role;

--
-- Name: SEQUENCE tournament_registrations_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.tournament_registrations_id_seq TO anon;
GRANT ALL ON SEQUENCE public.tournament_registrations_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.tournament_registrations_id_seq TO service_role;

--
-- Name: TABLE tournament_round_dates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_round_dates TO anon;
GRANT ALL ON TABLE public.tournament_round_dates TO authenticated;
GRANT ALL ON TABLE public.tournament_round_dates TO service_role;

--
-- Name: SEQUENCE tournament_round_dates_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.tournament_round_dates_id_seq TO anon;
GRANT ALL ON SEQUENCE public.tournament_round_dates_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.tournament_round_dates_id_seq TO service_role;

--
-- Name: TABLE tournament_round_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_round_templates TO anon;
GRANT ALL ON TABLE public.tournament_round_templates TO authenticated;
GRANT ALL ON TABLE public.tournament_round_templates TO service_role;

--
-- Name: SEQUENCE tournament_round_templates_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.tournament_round_templates_id_seq TO anon;
GRANT ALL ON SEQUENCE public.tournament_round_templates_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.tournament_round_templates_id_seq TO service_role;

--
-- Name: TABLE tournament_rounds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_rounds TO anon;
GRANT ALL ON TABLE public.tournament_rounds TO authenticated;
GRANT ALL ON TABLE public.tournament_rounds TO service_role;

--
-- Name: SEQUENCE tournament_rounds_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.tournament_rounds_id_seq TO anon;
GRANT ALL ON SEQUENCE public.tournament_rounds_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.tournament_rounds_id_seq TO service_role;

--
-- Name: TABLE tournament_stages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_stages TO anon;
GRANT ALL ON TABLE public.tournament_stages TO authenticated;
GRANT ALL ON TABLE public.tournament_stages TO service_role;

--
-- Name: SEQUENCE tournament_stages_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.tournament_stages_id_seq TO anon;
GRANT ALL ON SEQUENCE public.tournament_stages_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.tournament_stages_id_seq TO service_role;

--
-- Name: SEQUENCE tournaments_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.tournaments_id_seq TO anon;
GRANT ALL ON SEQUENCE public.tournaments_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.tournaments_id_seq TO service_role;

--
-- PostgreSQL database dump complete
--


-- Reference rows inserted by the foundational scripts themselves (database/2026-07-05-format-template-rules.sql,
-- supabase/v2-1-multi-tournament-foundation.sql). Not production data. Later seed migrations depend on them.
INSERT INTO public.game_worlds (id, name, slug, description, display_order, is_active, created_at) VALUES (1, 'Top 100', 'top-100', 'Original Top 100 game world', 1, true, '2026-10-11 22:28:24.346028+01');
INSERT INTO public.game_worlds (id, name, slug, description, display_order, is_active, created_at) VALUES (2, 'Top 100 Regen', 'regen', 'Top 100 Regen game world', 2, true, '2026-10-11 22:28:24.346028+01');
SELECT pg_catalog.setval('public.game_worlds_id_seq', 2, true);
INSERT INTO public.competition_types (id, name, slug, description, default_max_entries, default_group_count, default_teams_per_group, default_knockout_teams, default_secondary_bracket_name, display_order, is_active, created_at) VALUES (1, 'Youth Cup', 'youth-cup', 'Youth Cup tournament format', 64, 16, 4, 32, 'Shield', 1, true, '2026-10-11 22:28:24.346028+01');
INSERT INTO public.competition_types (id, name, slug, description, default_max_entries, default_group_count, default_teams_per_group, default_knockout_teams, default_secondary_bracket_name, display_order, is_active, created_at) VALUES (2, 'World Club Cup', 'world-club-cup', 'World Club Cup tournament format', 64, 16, 4, 32, NULL, 2, true, '2026-10-11 22:28:24.346028+01');
SELECT pg_catalog.setval('public.competition_types_id_seq', 2, true);
INSERT INTO public.tournament_formats (id, name, description, has_group_stage, has_knockout_stage, has_secondary_bracket, group_size, legs_group_stage, legs_knockout_stage, notes) VALUES (1, 'Youth Cup Template', 'Group stage followed by Cup and Shield knockouts. Cup R32 is one leg; Cup R16 onwards is two legs. Shield R32/R16 are one leg; Shield QF onwards is two legs.', true, true, true, 4, 2, 2, 'Seeded from average rating; knockout qualifiers seeded from group table performance. Opening brackets fill to target sizes with best next-placed teams, then byes if needed.');
SELECT pg_catalog.setval('public.tournament_formats_id_seq', 1, true);
INSERT INTO public.tournament_round_templates (id, format_id, bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (1, 1, 'Cup', 'R32', 1, 'knockout', 1, true, true, false, 'Shield', 'Cup R32 losers drop into Shield R32', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.tournament_round_templates (id, format_id, bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (2, 1, 'Cup', 'R16', 2, 'knockout', 2, true, true, false, NULL, NULL, '2026-10-11 22:28:24.218896+01');
INSERT INTO public.tournament_round_templates (id, format_id, bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (3, 1, 'Cup', 'QF', 3, 'knockout', 2, true, true, false, NULL, NULL, '2026-10-11 22:28:24.218896+01');
INSERT INTO public.tournament_round_templates (id, format_id, bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (4, 1, 'Cup', 'SF', 4, 'knockout', 2, true, true, false, NULL, NULL, '2026-10-11 22:28:24.218896+01');
INSERT INTO public.tournament_round_templates (id, format_id, bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (5, 1, 'Cup', 'Final', 5, 'knockout', 2, true, true, false, NULL, NULL, '2026-10-11 22:28:24.218896+01');
INSERT INTO public.tournament_round_templates (id, format_id, bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (6, 1, 'Shield', 'R32', 1, 'knockout', 1, true, true, false, NULL, 'Best remaining group-stage teams host Cup R32 losers', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.tournament_round_templates (id, format_id, bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (7, 1, 'Shield', 'R16', 2, 'knockout', 1, true, true, false, NULL, NULL, '2026-10-11 22:28:24.218896+01');
INSERT INTO public.tournament_round_templates (id, format_id, bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (8, 1, 'Shield', 'QF', 3, 'knockout', 2, true, true, false, NULL, NULL, '2026-10-11 22:28:24.218896+01');
INSERT INTO public.tournament_round_templates (id, format_id, bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (9, 1, 'Shield', 'SF', 4, 'knockout', 2, true, true, false, NULL, NULL, '2026-10-11 22:28:24.218896+01');
INSERT INTO public.tournament_round_templates (id, format_id, bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (10, 1, 'Shield', 'Final', 5, 'knockout', 2, true, true, false, NULL, NULL, '2026-10-11 22:28:24.218896+01');
SELECT pg_catalog.setval('public.tournament_round_templates_id_seq', 10, true);
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (1, 1, 1, 0, false, 'Single fixture or first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (2, 2, 1, 0, false, 'Single fixture or first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (3, 3, 1, 0, false, 'Single fixture or first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (4, 4, 1, 0, false, 'Single fixture or first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (5, 5, 1, 0, false, 'Single fixture or first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (6, 6, 1, 0, false, 'Single fixture or first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (7, 7, 1, 0, false, 'Single fixture or first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (8, 8, 1, 0, false, 'Single fixture or first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (9, 9, 1, 0, false, 'Single fixture or first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (10, 10, 1, 0, false, 'Single fixture or first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (11, 2, 2, 7, true, 'Second leg exactly seven days after first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (12, 3, 2, 7, true, 'Second leg exactly seven days after first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (13, 4, 2, 7, true, 'Second leg exactly seven days after first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (14, 5, 2, 7, true, 'Second leg exactly seven days after first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (15, 8, 2, 7, true, 'Second leg exactly seven days after first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (16, 9, 2, 7, true, 'Second leg exactly seven days after first leg', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.fixture_templates (id, round_template_id, leg, day_offset, home_away_flip, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (17, 10, 2, 7, true, 'Second leg exactly seven days after first leg', '2026-10-11 22:28:24.218896+01');
SELECT pg_catalog.setval('public.fixture_templates_id_seq', 17, true);
INSERT INTO public.qualification_rules (id, format_id, bracket, source_stage, group_position, rank_order, slots, destination_round, drop_from_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (1, 1, 'Cup', 'group', 1, 1, NULL, 'R32', NULL, 'Group winners qualify first and are ranked by table performance', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.qualification_rules (id, format_id, bracket, source_stage, group_position, rank_order, slots, destination_round, drop_from_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (2, 1, 'Cup', 'group', 2, 2, NULL, 'R32', NULL, 'Runners-up qualify after group winners and are ranked by table performance', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.qualification_rules (id, format_id, bracket, source_stage, group_position, rank_order, slots, destination_round, drop_from_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (3, 1, 'Cup', 'group', 3, 3, NULL, 'R32', NULL, 'Best third-placed teams fill the Cup opening round to its target size', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.qualification_rules (id, format_id, bracket, source_stage, group_position, rank_order, slots, destination_round, drop_from_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (4, 1, 'Shield', 'group', 3, 1, NULL, 'R32', NULL, 'Remaining third-placed teams qualify first for Shield', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.qualification_rules (id, format_id, bracket, source_stage, group_position, rank_order, slots, destination_round, drop_from_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (5, 1, 'Shield', 'group', 4, 2, NULL, 'R32', NULL, 'Best fourth-placed teams fill remaining Shield group-qualifier slots', '2026-10-11 22:28:24.218896+01');
INSERT INTO public.qualification_rules (id, format_id, bracket, source_stage, group_position, rank_order, slots, destination_round, drop_from_bracket, notes, created_at) OVERRIDING SYSTEM VALUE VALUES (6, 1, 'Shield', 'drop', NULL, 3, NULL, 'R32', 'Cup', 'Cup R32 losers enter Shield R32 as away teams', '2026-10-11 22:28:24.218896+01');
SELECT pg_catalog.setval('public.qualification_rules_id_seq', 6, true);

-- Auto-enable-RLS event trigger (finding F5). pg_dump --schema=public omits event triggers.
DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

RESET check_function_bodies;
