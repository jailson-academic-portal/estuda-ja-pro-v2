DROP POLICY IF EXISTS "No direct client access to assessment counters" ON public.assessment_control_counters;
CREATE POLICY "No direct client access to assessment counters" ON public.assessment_control_counters
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);