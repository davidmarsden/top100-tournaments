-- Announcements may link to Soccer Manager's own site (for example an official
-- game update on www.soccermanager.com) as well as Top 100 pages. Other sites
-- stay refused. Patched in place: the anchor must match exactly once.

do $migration$
declare
  v_anchor text := $a$if v_url !~ '^(/|https://([a-z0-9-]+\.)*smtop100\.blog(/|$))' then raise exception 'Links must point to a Top 100 page'; end if;$a$;
  v_patch text := $a$if v_url !~ '^(/|https://([a-z0-9-]+\.)*(smtop100\.blog|soccermanager\.com)(/|$))' then raise exception 'Links must point to a Top 100 or Soccer Manager page'; end if;$a$;
  v_ddl text;
begin
  v_ddl := pg_get_functiondef('public.send_manager_broadcast(text,text,text,bigint)'::regprocedure);
  if (length(v_ddl) - length(replace(v_ddl, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'send_manager_broadcast anchor was not found exactly once; refusing an unsafe migration';
  end if;
  execute replace(v_ddl, v_anchor, v_patch);
end;
$migration$;

revoke all on function public.send_manager_broadcast(text, text, text, bigint) from public, anon;
grant execute on function public.send_manager_broadcast(text, text, text, bigint) to authenticated;
