select string_agg(kind||'|'||name||'|'||left(md5(detail),10), E'\n' order by kind,name,md5(detail)) from (
select kind, name, detail from (
  select 'column' kind, c.relname||'.'||a.attname name,
         format_type(a.atttypid,a.atttypmod)||' nn='||a.attnotnull::text||' def='||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||' id='||a.attidentity::text detail
  from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  where c.relnamespace='public'::regnamespace and c.relkind in ('r','v','m','p')
  union all
  select 'relation', c.relname, c.relkind::text||' rls='||c.relrowsecurity::text
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','v','m','p')
  union all
  select 'constraint', conrelid::regclass::text||'.'||conname, pg_get_constraintdef(oid)
  from pg_constraint where connamespace='public'::regnamespace
  union all
  select 'index', indexname::text, indexdef from pg_indexes where schemaname='public'
  union all
  select 'function', p.oid::regprocedure::text, md5(regexp_replace(pg_get_functiondef(p.oid),'\s+',' ','g'))||' secdef='||p.prosecdef::text||' cfg='||coalesce(array_to_string(p.proconfig,','),'')
  from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p')
    and not exists (select 1 from pg_depend dd where dd.objid=p.oid and dd.deptype='e')
  union all
  select 'func_acl', p.oid::regprocedure::text, coalesce(array_to_string(array(select unnest(p.proacl)::text order by 1),' '),'<default>')
  from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p')
    and not exists (select 1 from pg_depend dd where dd.objid=p.oid and dd.deptype='e')
  union all
  select 'policy', tablename||'.'||policyname, cmd||' '||roles::text||' q='||coalesce(qual,'')||' w='||coalesce(with_check,'')
  from pg_policies where schemaname='public'
  union all
  select 'trigger', c.relname||'.'||t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal
  union all
  select 'view', c.relname, md5(regexp_replace(pg_get_viewdef(c.oid),'\s+',' ','g'))
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('v','m')
  union all
  select 'table_acl', c.relname, coalesce(array_to_string(array(select unnest(c.relacl)::text order by 1),' '),'<default>')
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','v','m','p')
) x order by 1,2,3
) z