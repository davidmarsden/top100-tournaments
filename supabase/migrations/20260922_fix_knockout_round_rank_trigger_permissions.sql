-- Fix organiser fixture-date updates for knockout-only tournaments.
--
-- guard_advanced_knockout_predecessor_structure() was created as SECURITY INVOKER
-- while its helper public.knockout_round_rank(text) is intentionally executable
-- only by service_role. Ordinary authenticated organisers therefore hit
-- "permission denied for function knockout_round_rank" on any matches UPDATE,
-- including harmless fixture_date changes.
--
-- Keep knockout_round_rank private and run the trigger guard with the same
-- SECURITY DEFINER model used by the other knockout integrity guards.

alter function public.guard_advanced_knockout_predecessor_structure()
  security definer;

alter function public.guard_advanced_knockout_predecessor_structure()
  set search_path = public;
