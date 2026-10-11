-- Historic Youth winners now come from the canonical Top 100 archive API.
-- Remove the temporary local RPC so it cannot expose or misclassify generic
-- Cup/Shield honours from the shared honours table.

drop function if exists public.get_public_youth_winners();
