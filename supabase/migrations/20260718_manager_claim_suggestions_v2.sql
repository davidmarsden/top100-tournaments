-- Manager claim suggestions v2
-- Treat common club-style prefixes such as VfL as optional and refresh pending claims.

create or replace function public.canonical_manager_claim_club(value text)
returns text
language plpgsql
immutable
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

-- Existing functions call canonical_manager_claim_club dynamically, so no rewrite is
-- required. Re-evaluate pending claims immediately.
update public.manager_portal_claims
set suggested_manager_id = public.find_manager_portal_claim_match(
  claimed_manager_name,
  claimed_club_name
)
where status = 'pending';
