-- Re-establish transparent SELECT access for students to their own enrollments

-- 1. Ensure students can see their own discipline associations
DROP POLICY IF EXISTS "Students can see their own enrollments" ON public.discipline_students;
CREATE POLICY "Students can see their own enrollments"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

-- 2. Ensure students can see the disciplines they are enrolled in
DROP POLICY IF EXISTS "Students can see enrolled disciplines" ON public.disciplines;
CREATE POLICY "Students can see enrolled disciplines"
ON public.disciplines
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.discipline_students
    WHERE discipline_students.discipline_id = disciplines.id
      AND discipline_students.student_id = auth.uid()
  ) OR teacher_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
);

-- 3. Ensure clinical cases are visible to enrolled students
DROP POLICY IF EXISTS "Students can view clinical cases of their disciplines" ON public.clinical_cases;
CREATE POLICY "Students can view clinical cases of their disciplines"
ON public.clinical_cases
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.discipline_students
    WHERE discipline_students.discipline_id = clinical_cases.discipline_id
      AND discipline_students.student_id = auth.uid()
  ) OR teacher_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
);

-- 4. Grant missing permissions
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
GRANT SELECT ON public.clinical_cases TO authenticated;
