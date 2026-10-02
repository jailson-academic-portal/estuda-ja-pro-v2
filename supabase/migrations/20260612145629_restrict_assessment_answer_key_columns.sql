-- Prevent students (and any Data API client) from reading assessment answer keys
-- before/while taking an exam. The grader (service_role) bypasses these grants,
-- so objective correction keeps working unchanged.
--
-- Column-level SELECT requires removing the blanket table SELECT first, then
-- re-granting only the non-sensitive columns. answer_key, option_orders and
-- question_order are intentionally excluded from the Data API.

REVOKE SELECT ON public.assessment_assignments FROM authenticated;

GRANT SELECT (
  id,
  assessment_id,
  version_id,
  student_id,
  qr_token,
  copy_index,
  created_at,
  bubble_layout
) ON public.assessment_assignments TO authenticated;
