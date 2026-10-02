-- Remove blanket table-level read access so the time-limited check-in code
-- cannot be read directly from the base table via the Data API.
REVOKE SELECT ON public.attendance_sessions FROM authenticated;
REVOKE SELECT ON public.attendance_sessions FROM anon;

-- Re-grant column-level read access to every column EXCEPT "code".
-- Teachers/admins still obtain the code via the masked view (owner-privileged)
-- and the teacher reveal server function (service role).
GRANT SELECT (
  id,
  discipline_id,
  teacher_id,
  topic,
  session_date,
  window_hours,
  created_at,
  code_window_minutes,
  starts_at,
  finalized_at,
  finalized_by
) ON public.attendance_sessions TO authenticated;
