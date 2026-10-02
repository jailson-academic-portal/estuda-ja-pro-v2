DROP POLICY IF EXISTS "Authenticated can read courses" ON public.courses;
CREATE POLICY "Staff and enrolled users can read courses" ON public.courses
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'teacher')
  OR public.has_role(auth.uid(), 'institution') OR public.has_role(auth.uid(), 'gestor')
  OR EXISTS (
    SELECT 1 FROM public.disciplines d
    JOIN public.discipline_students ds ON ds.discipline_id = d.id
    WHERE d.course_id = courses.id AND ds.student_id = auth.uid()
  )
);