create or replace function public.normalise_manager_claim_text(value text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    lower(translate(coalesce(value, ''),
      'áàâäãåāăąçćčďđéèêëēĕėęěíìîïīĭįłñńňóòôöõøōŏőŕřśšşťţúùûüūŭůűųýÿžźż',
      'aaaaaaaaacccddeeeeeeeeeiiiiiiilnnnooooooooorrsssttuuuuuuuuuyyzzz'
    )),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

create or replace function public.canonical_manager_claim_club(value text)
returns text
language plpgsql
immutable
as $$
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
$$;

create or replace function public.find_manager_portal_claim_match(
  claimed_manager_name text,
  claimed_club_name text
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select distinct te.manager_id
    from public.tournament_entries te
    join public.managers m on m.id = te.manager_id
    join public.teams t on t.id = te.team_id
    where public.normalise_manager_claim_text(coalesce(m.display_name, m.name))
          = public.normalise_manager_claim_text(claimed_manager_name)
      and public.canonical_manager_claim_club(t.name)
          = public.canonical_manager_claim_club(claimed_club_name)
  )
  select case when count(*) = 1 then min(manager_id) else null end
  from candidates;
$$;

create or replace function public.populate_manager_portal_claim_suggestion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.suggested_manager_id := public.find_manager_portal_claim_match(
    new.claimed_manager_name,
    new.claimed_club_name
  );
  return new;
end;
$$;

drop trigger if exists manager_portal_claim_auto_match on public.manager_portal_claims;
create trigger manager_portal_claim_auto_match
before insert or update of claimed_manager_name, claimed_club_name
on public.manager_portal_claims
for each row execute function public.populate_manager_portal_claim_suggestion();

-- Re-check existing pending claims immediately, so administrators do not need
-- to ask managers to submit them again after this migration is installed.
update public.manager_portal_claims
set suggested_manager_id = public.find_manager_portal_claim_match(
  claimed_manager_name,
  claimed_club_name
)
where status = 'pending';

grant execute on function public.find_manager_portal_claim_match(text, text) to authenticated;
