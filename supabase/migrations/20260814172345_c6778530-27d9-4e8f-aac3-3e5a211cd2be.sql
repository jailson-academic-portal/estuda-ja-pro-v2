-- Restore secure RLS for core tables without the infinite recursion bug

-- 1. Enable RLS back for everyone
ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

-- 2. Drop the 'true' policies we added for debugging
DROP POLICY IF EXISTS "authenticated_view_disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "authenticated_view_enrollments" ON public.discipline_students;
DROP POLICY IF EXISTS "authenticated_view_modules" ON public.material_modules;
DROP POLICY IF EXISTS "authenticated_view_materials" ON public.materials;

-- 3. Re-create the check_is_enrolled function (Security Definer)
-- This was the key to breaking the recursion.
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

-- 4. Secure Disciplines (Non-recursive)
CREATE POLICY "disciplines_select_policy"
ON public.disciplines
FOR SELECT
TO authenticated
USING (
  teacher_id = auth.uid() 
  OR public.has_role(auth.uid(), 'admin')
  OR public.check_is_enrolled(id, auth.uid())
);

-- 5. Secure Discipline Students (Non-recursive)
CREATE POLICY "discipline_students_select_policy"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (
  student_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.disciplines 
    WHERE id = discipline_id AND teacher_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

-- 6. Secure Material Modules
CREATE POLICY "material_modules_select_policy"
ON public.material_modules
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.disciplines 
    WHERE id = discipline_id 
    AND (teacher_id = auth.uid() OR public.check_is_enrolled(id, auth.uid()))
  )
  OR public.has_role(auth.uid(), 'admin')
);

-- 7. Secure Materials
CREATE POLICY "materials_select_policy"
ON public.materials
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.material_modules mm
    JOIN public.disciplines d ON d.id = mm.discipline_id
    WHERE mm.id = module_id
    AND (d.teacher_id = auth.uid() OR public.check_is_enrolled(d.id, auth.uid()))
  )
  OR public.has_role(auth.uid(), 'admin')
);

-- 8. Grants
GRANT EXECUTE ON FUNCTION public.check_is_enrolled(uuid, uuid) TO authenticated;
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
GRANT SELECT ON public.material_modules TO authenticated;
GRANT SELECT ON public.materials TO authenticated;
