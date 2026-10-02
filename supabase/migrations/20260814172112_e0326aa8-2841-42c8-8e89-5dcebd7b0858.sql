-- Fix infinite recursion in disciplines policy and discipline_students

-- 1. Correct the disciplines policy to avoid recursion
-- The previous policy used EXISTS(SELECT 1 FROM discipline_students ...) 
-- and discipline_students likely had a policy that referenced disciplines.
DROP POLICY IF EXISTS "Students can see enrolled disciplines" ON public.disciplines;
CREATE POLICY "Students can see enrolled disciplines"
ON public.disciplines
FOR SELECT
TO authenticated
USING (
  teacher_id = auth.uid() 
  OR public.has_role(auth.uid(), 'admin')
  OR id IN (
    SELECT discipline_id 
    FROM public.discipline_students 
    WHERE student_id = auth.uid()
  )
);

-- 2. Ensure discipline_students policy is non-recursive
-- It should only check student_id = auth.uid() or be manageable by teachers/admins
DROP POLICY IF EXISTS "Students can see their own enrollments" ON public.discipline_students;
CREATE POLICY "Students can see their own enrollments"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

-- 3. Clean up other potentially recursive policies
DROP POLICY IF EXISTS "Students can view clinical cases of their disciplines" ON public.clinical_cases;
CREATE POLICY "Students can view clinical cases of their disciplines"
ON public.clinical_cases
FOR SELECT
TO authenticated
USING (
  teacher_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR discipline_id IN (
    SELECT discipline_id 
    FROM public.discipline_students 
    WHERE student_id = auth.uid()
  )
);

-- 4. Re-grant select access
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
GRANT SELECT ON public.clinical_cases TO authenticated;
