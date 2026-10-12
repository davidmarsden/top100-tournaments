-- Finding F9 (docs/supabase-baseline-reconstruction-2026-10-11.md).
-- Ships the claim-matching fix from 20260718_manager_claim_suggestions_v2.sql, which was never
-- applied to production: treat VfL/VfB/SV/RCD/RC/FK/SK as optional club prefixes (and VfL/VfB/SV as
-- suffixes), and map Wolfsburg's names together.
--
-- Checked against production (11 Oct 2026): 8 team/club names change key, and the only new matches
-- are two names of the same club (Espanyol/RCD Espanyol, Hamburger/Hamburger SV, Partizan/FK Partizan,
-- Wolfsburg/VfL Wolfsburg). No expression index or generated column uses this function.
-- The original script also re-evaluated pending claims; there are none, so that step is omitted
-- (it would also fire the admin-notification trigger).
-- search_path matches the hardening applied to production by 20260824171251.
create or replace function public.canonical_manager_claim_club(value text)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog', 'public'
as $$
declare
  club text := public.normalise_manager_claim_text(value);
begin
  club := regexp_replace(club, '^(fc|ac|as|ssc|sc|cf|vfl|vfb|sv|rcd|rc|fk|sk) ', '');
  club := regexp_replace(club, ' (fc|cf|vfl|vfb|sv)$', '');

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
    when club in ('wolfsburg', 'wolfsburg youth') then 'wolfsburg'
    else club
  end;
end;
$$;
