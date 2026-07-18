create or replace function public.reject_manager_result(
  target_submission_id bigint,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  submission_row public.manager_result_submissions%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select * into submission_row
  from public.manager_result_submissions
  where id = target_submission_id
  for update;

  if not found then
    raise exception 'Result submission not found';
  end if;

  if submission_row.status not in ('pending_confirmation', 'disputed') then
    raise exception 'This submission is no longer awaiting review';
  end if;

  update public.manager_result_submissions
  set status = 'withdrawn',
      resolved_by = auth.uid(),
      resolution_note = nullif(trim(note), ''),
      resolved_at = now(),
      updated_at = now()
  where id = target_submission_id;
end;
$$;

grant execute on function public.reject_manager_result(bigint, text) to authenticated;
