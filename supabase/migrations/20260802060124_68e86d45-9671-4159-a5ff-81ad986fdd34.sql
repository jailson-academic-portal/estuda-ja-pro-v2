CREATE OR REPLACE FUNCTION public.discipline_institution_id(_discipline_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT institution_id FROM public.disciplines WHERE id = _discipline_id
$$;

REVOKE ALL ON FUNCTION public.discipline_institution_id(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.discipline_institution_id(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Students can see disciplines they are enrolled in" ON public.disciplines;

CREATE POLICY "Students can see disciplines they are enrolled in"
ON public.disciplines FOR SELECT
TO authenticated
USING (public.is_discipline_student(id, auth.uid()));

DROP POLICY IF EXISTS "Institutions see enrollments in their disciplines" ON public.discipline_students;

CREATE POLICY "Institutions see enrollments in their disciplines"
ON public.discipline_students FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'institution'::app_role)
  AND public.discipline_institution_id(discipline_id) = public.current_institution_id()
);