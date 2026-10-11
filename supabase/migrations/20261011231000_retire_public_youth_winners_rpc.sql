-- Finding F4 (docs/supabase-baseline-reconstruction-2026-10-11.md).
-- 20260718_remove_unused_public_youth_winners_rpc.sql was written to retire this RPC but was never
-- applied to production, so it is still executable by anon and authenticated.
-- Historic Youth winners come from the canonical Top 100 archive API instead.
-- Checked before removal (11 Oct 2026): no caller in top100-tournaments or top100-manager-lab,
-- and zero calls in production's API logs over the previous 24 hours (45,962 requests).
drop function if exists public.get_public_youth_winners();
