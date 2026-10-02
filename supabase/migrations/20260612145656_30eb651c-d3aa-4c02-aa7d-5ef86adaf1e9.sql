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