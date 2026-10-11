-- Finding F13 (docs/supabase-baseline-reconstruction-2026-10-11.md).
-- This project predates Supabase's tighter defaults: every new table, sequence and function in
-- public was automatically granted in full to anon, authenticated and service_role, leaving RLS as
-- the only barrier. Adopt the defaults Supabase now gives new projects (observed on a Preview branch,
-- 11 Oct 2026).
--
-- Affects FUTURE objects only. Existing grants are unchanged.
-- Functions are tightened beyond Supabase's own default (which still lets PUBLIC execute new functions).
-- From now on each migration must GRANT explicitly what the API roles need, e.g.:
--   grant select on public.new_table to anon, authenticated;
--   grant execute on function public.new_rpc(bigint) to authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, service_role;
-- PostgreSQL's built-in default lets PUBLIC (which includes anon) execute every new function, and a
-- schema-scoped rule cannot remove a built-in grant. Only the database-wide form can, so this line
-- covers functions postgres creates in any schema (this project only creates them in public).
alter default privileges for role postgres revoke execute on functions from public;
