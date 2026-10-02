-- Resolve stubborn infinite recursion in disciplines policy by using a Security Definer function

-- 1. Create a security definer function to check enrollment
-- This function executes with the privileges of its owner (superuser), 
-- bypassing RLS checks on the tables it queries and breaking the recursion.
CREATE OR REPLACE FUNCTION public.check_is_enrolled(_discipline_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.discipline_students
    WHERE discipline_id = _discipline_id
      AND student_id = _user_id
  );
$$;

-- 2. Drop the problematic recursive policies
DROP POLICY IF EXISTS "Students can see enrolled disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "discipline_students_read" ON public.discipline_students;
DROP POLICY IF EXISTS "Students can see their own enrollments" ON public.discipline_students;

-- 3. Re-create discipline_students policy (very simple, no recursion possible here)
CREATE POLICY "Students can see their own enrollments"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

-- 4. Re-create disciplines policy using the security definer function
-- This is now safe because the function does not trigger RLS checks.
CREATE POLICY "Students can see enrolled disciplines"
ON public.disciplines
FOR SELECT
TO authenticated
USING (
  teacher_id = auth.uid() 
  OR public.has_role(auth.uid(), 'admin')
  OR public.check_is_enrolled(id, auth.uid())
);

-- 5. Do the same for clinical_cases to be safe
DROP POLICY IF EXISTS "Students can view clinical cases of their disciplines" ON public.clinical_cases;
CREATE POLICY "Students can view clinical cases of their disciplines"
ON public.clinical_cases
FOR SELECT
TO authenticated
USING (
  teacher_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.check_is_enrolled(discipline_id, auth.uid())
);

-- 6. Ensure proper grants
GRANT EXECUTE ON FUNCTION public.check_is_enrolled(uuid, uuid) TO authenticated;
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
GRANT SELECT ON public.clinical_cases TO authenticated;
