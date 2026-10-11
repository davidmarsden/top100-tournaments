-- Keep public directory reads simple without overlapping permissive SELECT policies.
drop policy if exists "Public read active game world clubs" on public.game_world_clubs;
drop policy if exists "Platform admins manage game world clubs" on public.game_world_clubs;

create policy "Anon reads active game world clubs"
  on public.game_world_clubs for select
  to anon
  using (active = true);

create policy "Authenticated reads game world clubs"
  on public.game_world_clubs for select
  to authenticated
  using (active = true or (select public.is_admin()));

create policy "Platform admins insert game world clubs"
  on public.game_world_clubs for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "Platform admins update game world clubs"
  on public.game_world_clubs for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Platform admins delete game world clubs"
  on public.game_world_clubs for delete
  to authenticated
  using ((select public.is_admin()));
