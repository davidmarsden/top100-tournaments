-- A removed entry stays withdrawn until the removal is cleared: officials can't put it back to
-- waiting, offer it a club or mark it appointed while removed_at is set ("Allow back on the list"
-- first). Otherwise it would regain a place and could hold a club while still shown as removed.

create or replace function public.update_waiting_list_entry(p_id bigint, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removing boolean := p_fields ? 'removed' and (p_fields->>'removed')::boolean;
  v_clearing boolean := p_fields ? 'removed' and not (p_fields->>'removed')::boolean;
  v_removed_at timestamptz;
begin
  if not public.is_top100_official() then raise exception 'Only Top 100 officials can update the waiting list.'; end if;
  if p_fields ? 'status' and p_fields->>'status' not in ('waiting', 'offered', 'appointed', 'withdrawn', 'lapsed') then
    raise exception 'Unknown status.';
  end if;
  select removed_at into v_removed_at from public.waiting_list_entries where id = p_id;
  if v_removed_at is not null and not v_clearing and p_fields ? 'status' and p_fields->>'status' in ('waiting', 'offered', 'appointed') then
    raise exception 'This person was removed from the list. Allow them back on the list first.';
  end if;
  update public.waiting_list_entries entry set
    status = case
      when v_removing then 'withdrawn'
      when p_fields ? 'status' then p_fields->>'status'
      else entry.status end,
    removed_at = case
      when v_removing then coalesce(entry.removed_at, now())
      when v_clearing then null
      else entry.removed_at end,
    preferred_club_ids = case when v_removing then '{}' else entry.preferred_club_ids end,
    manager_id = case when p_fields ? 'managerId' then (p_fields->>'managerId')::bigint else entry.manager_id end,
    sm_manager_id = case when p_fields ? 'smManagerId' then nullif(btrim(p_fields->>'smManagerId'), '') else entry.sm_manager_id end,
    gold = case when p_fields ? 'gold' then (p_fields->>'gold')::boolean else entry.gold end,
    game_worlds = case when p_fields ? 'gameWorlds' then (p_fields->>'gameWorlds')::integer else entry.game_worlds end,
    admin_notes = case when p_fields ? 'adminNotes' then nullif(btrim(p_fields->>'adminNotes'), '') else entry.admin_notes end,
    offer_club = case when v_removing then null when p_fields ? 'offerClub' then nullif(btrim(p_fields->>'offerClub'), '') else entry.offer_club end,
    offer_deadline = case when v_removing then null when p_fields ? 'offerDeadline' then (p_fields->>'offerDeadline')::timestamptz else entry.offer_deadline end,
    updated_at = now()
  where entry.id = p_id;
  if not found then raise exception 'No such waiting list entry.'; end if;
end;
$$;
