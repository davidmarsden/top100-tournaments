-- The Gold and last-login fields are settled: the Manager List's customerGoldMember
-- and customerLastOnline. customerMembershipStatus is 1 for every manager, Gold or
-- not, so it never counts. The alerts page no longer asks administrators to
-- confirm fields, so the choice is recorded here for every database.
insert into public.manager_signal_fields (key, kind, confirmed, confirmed_at)
values
  ('managerList:customerGoldMember', 'gold', true, now()),
  ('managerList:customerLastOnline', 'login', true, now()),
  ('managerList:customerMembershipStatus', 'gold', false, now())
on conflict (key) do update set confirmed = excluded.confirmed
where public.manager_signal_fields.confirmed is distinct from excluded.confirmed;
