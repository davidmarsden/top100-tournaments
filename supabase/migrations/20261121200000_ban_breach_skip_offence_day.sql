-- A transfer ban runs from the day the club broke the rule (for the squad limit, the day it went over
-- 50) to the day before the same date the following month; the ruling usually comes a day or two later.
-- The deals made on that first day are the offence itself, already dealt with by the ruling, so they
-- are no longer reported as "Deal during a transfer ban". Deals from the next day to the last day of the
-- ban still are.
--
-- enqueue_compliance_events() is patched in place; the anchor must match exactly once.

do $$
declare
  v_ddl text;
  v_anchor constant text := 'on deal.d between ban.starts_on and ban.ends_on';
  v_patch constant text := 'on deal.d > ban.starts_on and deal.d <= ban.ends_on';
begin
  v_ddl := pg_get_functiondef('public.enqueue_compliance_events(text)'::regprocedure);
  if (length(v_ddl) - length(replace(v_ddl, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'enqueue_compliance_events anchor was not found exactly once; refusing an unsafe migration';
  end if;
  execute replace(v_ddl, v_anchor, v_patch);
end;
$$;

revoke all on function public.enqueue_compliance_events(text) from public, anon, authenticated;
grant execute on function public.enqueue_compliance_events(text) to service_role;
