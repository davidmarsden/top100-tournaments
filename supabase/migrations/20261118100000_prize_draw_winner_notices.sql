-- Prize draw winners are told personally when the draw is published.
--
-- Until now the winners were only announced on the public tournament page and in Chat, and a
-- winner could miss the prize (a new player pick at the start of the next season).
--
-- 1. prize_draws gains how_to_claim (shown to the winners), emailed_winner_keys (the winners
--    already emailed, so a retry only sends the rest) and winners_emailed_at (set once every
--    winner with an email on file has been sent one).
-- 2. publish_prize_draw(draw, published, how_to_claim): publishing a draw also puts a notice in
--    each winner's Manager Portal inbox (pushed to their phone where they allow it). Notices are
--    keyed per draw and account, so unpublishing and publishing again doesn't repeat them.
-- 3. prize_draw_winner_contacts(draw): officials only. Every winner, with the email on their
--    Manager Portal account (null for a winner added by hand or without an account), for the
--    prize-draw-winners Netlify function, which emails each one; prize_draw_winners_emailed(draw,
--    keys) records who was sent one.
-- Notices and emails link to the draw's own tournament page.

alter table public.prize_draws add column if not exists how_to_claim text;
alter table public.prize_draws add column if not exists emailed_winner_keys text[] not null default '{}';
alter table public.prize_draws add column if not exists winners_emailed_at timestamptz;

-- The public page for a draw: its tournament's page, else the site's default page.
create or replace function public.prize_draw_page_url(p_tournament_id bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'https://tournaments.smtop100.blog/'
    || case when p_tournament_id is null then '' else 'tournaments/' || p_tournament_id end
    || '#prize-draw';
$$;

grant execute on function public.prize_draw_page_url(bigint) to anon, authenticated, service_role;

-- The signature gains p_how_to_claim, so the two-argument version is dropped first. Existing
-- two-argument calls still work through the default.
drop function if exists public.publish_prize_draw(bigint, boolean);

create or replace function public.publish_prize_draw(p_draw_id bigint, p_published boolean, p_how_to_claim text default null)
returns public.prize_draws
language plpgsql
security definer
set search_path = ''
as $$
declare
  draw_row public.prize_draws;
  winner jsonb;
  v_account bigint;
  v_title text;
  v_body text;
begin
  select * into draw_row from public.prize_draws where id = p_draw_id for update;
  if not found then raise exception 'Prize draw not found'; end if;
  if not (public.is_admin() or (draw_row.tournament_id is not null and public.can_manage_tournament(draw_row.tournament_id))) then
    raise exception 'Tournament organiser access required';
  end if;
  if draw_row.voided and p_published then raise exception 'A voided draw cannot be published'; end if;

  -- Only one published draw per tournament + title.
  if p_published then
    update public.prize_draws set published = false
     where id <> p_draw_id and published
       and tournament_id is not distinct from draw_row.tournament_id
       and title = draw_row.title;
  end if;

  update public.prize_draws
     set published = p_published,
         how_to_claim = coalesce(nullif(trim(coalesce(p_how_to_claim, '')), ''), how_to_claim)
   where id = p_draw_id
  returning * into draw_row;

  if p_published then
    v_title := left('You won the ' || draw_row.title, 200);
    v_body := concat_ws(' ',
      'Congratulations! Your prize: ' || coalesce(draw_row.prize, 'see the tournament page') || '.',
      draw_row.how_to_claim);
    for winner in select value from jsonb_array_elements(draw_row.winners) loop
      if winner->>'manager_id' ~ '^[0-9]+$' then
        for v_account in
          select account.id from public.manager_portal_accounts account
          where account.manager_id = (winner->>'manager_id')::bigint and account.active = true
        loop
          perform public.enqueue_manager_notification(v_account, 'admin_alerts', v_title, v_body,
            public.prize_draw_page_url(draw_row.tournament_id),
            'prize-draw:' || draw_row.id || ':account:' || v_account);
        end loop;
      end if;
    end loop;
  end if;

  return draw_row;
end;
$$;

revoke all on function public.publish_prize_draw(bigint, boolean, text) from public, anon;
grant execute on function public.publish_prize_draw(bigint, boolean, text) to authenticated, service_role;

-- Winners and the email on their Manager Portal account (one row per winner; email is null when
-- the winner has no active account).
create or replace function public.prize_draw_winner_contacts(p_draw_id bigint)
returns table (winner_key text, manager_id bigint, name text, club text, email text, already_emailed boolean,
  title text, prize text, how_to_claim text, page_url text, published boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  draw_row public.prize_draws;
begin
  select * into draw_row from public.prize_draws where id = p_draw_id;
  if not found then raise exception 'Prize draw not found'; end if;
  if not (public.is_admin() or (draw_row.tournament_id is not null and public.can_manage_tournament(draw_row.tournament_id))) then
    raise exception 'Tournament organiser access required';
  end if;

  -- Every winner, including names added by hand (no manager record, so no email).
  return query
  select w->>'key', case when w->>'manager_id' ~ '^[0-9]+$' then (w->>'manager_id')::bigint end,
    w->>'name', w->>'club',
    case when w->>'manager_id' ~ '^[0-9]+$' then
      (select account.email
         from public.manager_portal_accounts account
        where account.manager_id = (w->>'manager_id')::bigint and account.active = true
        order by account.id limit 1)
    end,
    (w->>'key') = any (draw_row.emailed_winner_keys),
    draw_row.title, draw_row.prize, draw_row.how_to_claim,
    public.prize_draw_page_url(draw_row.tournament_id), draw_row.published
  from jsonb_array_elements(draw_row.winners) w
  order by (w->>'rank')::int;
end;
$$;

revoke all on function public.prize_draw_winner_contacts(bigint) from public, anon;
grant execute on function public.prize_draw_winner_contacts(bigint) to authenticated, service_role;

-- Records the winners just emailed; winners_emailed_at is set once every winner with an email
-- on file has been sent one.
create or replace function public.prize_draw_winners_emailed(p_draw_id bigint, p_winner_keys text[])
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  draw_row public.prize_draws;
begin
  select * into draw_row from public.prize_draws where id = p_draw_id for update;
  if not found then raise exception 'Prize draw not found'; end if;
  if not (public.is_admin() or (draw_row.tournament_id is not null and public.can_manage_tournament(draw_row.tournament_id))) then
    raise exception 'Tournament organiser access required';
  end if;
  update public.prize_draws
     set emailed_winner_keys = array(select distinct k from unnest(emailed_winner_keys || coalesce(p_winner_keys, '{}')) k)
   where id = p_draw_id
  returning * into draw_row;

  if not exists (
    select 1 from public.prize_draw_winner_contacts(p_draw_id) c
    where c.email is not null and not (c.winner_key = any (draw_row.emailed_winner_keys))
  ) then
    update public.prize_draws set winners_emailed_at = coalesce(winners_emailed_at, now())
     where id = p_draw_id returning * into draw_row;
  end if;
  return draw_row.winners_emailed_at;
end;
$$;

revoke all on function public.prize_draw_winners_emailed(bigint, text[]) from public, anon;
grant execute on function public.prize_draw_winners_emailed(bigint, text[]) to authenticated, service_role;
