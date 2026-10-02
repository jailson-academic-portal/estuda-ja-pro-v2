-- Finding 1: disciplines "Students see enrolled disciplines" should be authenticated-only
DROP POLICY IF EXISTS "Students see enrolled disciplines" ON public.disciplines;
CREATE POLICY "Students see enrolled disciplines"
  ON public.disciplines
  FOR SELECT
  TO authenticated
  USING (public.is_discipline_student(id, auth.uid()));

-- Finding 1 & 3: remove residual anonymous read grants (all policies are authenticated-scoped)
REVOKE SELECT ON public.disciplines FROM anon;
REVOKE SELECT ON public.profiles FROM anon;