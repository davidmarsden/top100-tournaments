-- Notification triggers for the Top 100 app; trigger functions are in
-- 20261022191520_top100_app_notification_functions.sql and
-- 20261022192854_top100_app_wake_push_dispatcher_fn.sql.
set local lock_timeout = '5s';

create trigger notify_managers_of_match_change
after insert or update of fixture_date, home_entry_id, away_entry_id, status, home_score, away_score
on public.matches
for each row
execute function public.notify_managers_of_match_change();

create trigger notify_opponent_of_arrangement_action
after insert on public.manager_match_arrangement_events
for each row
execute function public.notify_opponent_of_arrangement_action();

create trigger notify_managers_of_match_comment
after insert on public.match_comments
for each row
execute function public.notify_managers_of_match_comment();

create trigger wake_push_dispatcher
after insert on public.manager_notifications
referencing new table as inserted
for each statement
execute function public.wake_push_dispatcher();
