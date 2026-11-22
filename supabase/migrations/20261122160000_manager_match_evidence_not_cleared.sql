-- My Matches: no evidence on an undone fixture update.
--
-- The portal hides the evidence button once an update is undone ('cleared'),
-- but a second, stale tab could still attach evidence, which would then
-- reappear against the next recorded action. attach_manager_match_evidence()
-- now refuses a cleared arrangement itself. Patched in place; the anchor must
-- match exactly once.

do $$
declare
  v_ddl text;
  v_anchor constant text := 'and (tournament_entry_id=v_home_entry_id or tournament_entry_id=v_away_entry_id)';
  v_patch constant text := $p$and status <> 'cleared'
     and (tournament_entry_id=v_home_entry_id or tournament_entry_id=v_away_entry_id)$p$;
begin
  v_ddl := pg_get_functiondef('public.attach_manager_match_evidence(bigint,text,text)'::regprocedure);
  if position($c$status <> 'cleared'$c$ in v_ddl) > 0 then return; end if;
  if (length(v_ddl) - length(replace(v_ddl, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'attach_manager_match_evidence anchor was not found exactly once; refusing an unsafe migration';
  end if;
  execute replace(v_ddl, v_anchor, v_patch);
end;
$$;
