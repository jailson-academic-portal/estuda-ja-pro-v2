DROP POLICY IF EXISTS "Teachers manage assessment counters" ON public.assessment_control_counters;
DROP POLICY IF EXISTS "Admins manage assessment counters" ON public.assessment_control_counters;

REVOKE ALL ON public.assessment_control_counters FROM anon;
REVOKE ALL ON public.assessment_control_counters FROM authenticated;
GRANT ALL ON public.assessment_control_counters TO service_role;

REVOKE ALL ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) TO service_role;