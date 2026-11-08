-- The scheduled chat-appointments function reads public_appointment_decisions() with the service
-- role, which (unlike anon and authenticated) was never granted it, so every run failed with
-- "permission denied" and no appointment was announced in Top 100 Chat.
grant execute on function public.public_appointment_decisions(integer, text) to service_role;
