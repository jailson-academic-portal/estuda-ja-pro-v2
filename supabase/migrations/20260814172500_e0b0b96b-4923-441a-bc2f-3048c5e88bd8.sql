-- Clean restoration of RLS policies with SECURITY DEFINER to avoid recursion

-- 1. Create the Security Definer helper again
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

-- 2. Secure Disciplines
-- This is where the infinite recursion was happening.
-- By using a Security Definer function, we bypass the RLS check on discipline_students.
ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "disciplines_select_policy" ON public.disciplines;
CREATE POLICY "disciplines_select_policy"
ON public.disciplines
FOR SELECT
TO authenticated
USING (
  teacher_id = auth.uid() 
  OR public.has_role(auth.uid(), 'admin')
  OR public.check_is_enrolled(id, auth.uid())
);

-- 3. Secure Discipline Students
-- We avoid referencing 'disciplines' here to be absolutely safe.
ALTER TABLE public.discipline_students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "discipline_students_select_policy" ON public.discipline_students;
CREATE POLICY "discipline_students_select_policy"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (
  student_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'teacher') -- Teachers can see all enrollments for now to avoid recursion
);

-- 4. Restore materials policies (they were safe, but let's re-add securely)
ALTER TABLE public.material_modules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "material_modules_select_policy" ON public.material_modules;
CREATE POLICY "material_modules_select_policy"
ON public.material_modules
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.check_is_enrolled(discipline_id, auth.uid())
  OR EXISTS (SELECT 1 FROM public.disciplines WHERE id = discipline_id AND teacher_id = auth.uid())
);

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "materials_select_policy" ON public.materials;
CREATE POLICY "materials_select_policy"
ON public.materials
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.material_modules mm
    WHERE mm.id = module_id
    AND (
      public.check_is_enrolled(mm.discipline_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.disciplines WHERE id = mm.discipline_id AND teacher_id = auth.uid())
    )
  )
);

-- 5. Final grants
GRANT EXECUTE ON FUNCTION public.check_is_enrolled(uuid, uuid) TO authenticated;
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
GRANT SELECT ON public.material_modules TO authenticated;
GRANT SELECT ON public.materials TO authenticated;
