
-- Helper functions to break RLS recursion between disciplines <-> discipline_students
CREATE OR REPLACE FUNCTION public.is_discipline_teacher(_discipline_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.disciplines WHERE id = _discipline_id AND teacher_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.is_discipline_student(_discipline_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.discipline_students WHERE discipline_id = _discipline_id AND student_id = _user_id)
$$;

-- Replace recursive policies on discipline_students
DROP POLICY IF EXISTS "Teachers manage enrollments in own disciplines" ON public.discipline_students;
CREATE POLICY "Teachers manage enrollments in own disciplines"
ON public.discipline_students
FOR ALL
USING (public.is_discipline_teacher(discipline_id, auth.uid()))
WITH CHECK (public.is_discipline_teacher(discipline_id, auth.uid()));

-- Replace recursive policy on disciplines
DROP POLICY IF EXISTS "Students see enrolled disciplines" ON public.disciplines;
CREATE POLICY "Students see enrolled disciplines"
ON public.disciplines
FOR SELECT
USING (public.is_discipline_student(id, auth.uid()));
