-- PR #73 public completion hardening.
-- Expose only a boolean indicating whether a public knockout-only Final is
-- genuinely resolved. Result-submission rows remain private.

create or replace function public.public_knockout_final_resolved(target_tournament_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tournaments t
    where t.id = target_tournament_id
      and t.tournament_structure = 'knockout_only'
      and public.tournament_shell_is_public(t.id)
      and exists (
        select 1
        from public.matches m
        where m.tournament_id = t.id
          and m.stage = 'knockout'
          and m.round = 'Final'
          and m.status in ('played', 'forfeit')
          and m.winner_entry_id is not null
      )
      and not exists (
        select 1
        from public.manager_result_submissions s
        join public.matches m on m.id = s.match_id
        where m.tournament_id = t.id
          and m.stage = 'knockout'
          and m.round = 'Final'
          and s.status in (
            'pending_confirmation',
            'disputed',
            'pending_admin_check',
            'opponent_confirmed',
            'appealed'
          )
      )
  );
$$;

revoke all on function public.public_knockout_final_resolved(bigint) from public;
grant execute on function public.public_knockout_final_resolved(bigint) to anon, authenticated, service_role;
