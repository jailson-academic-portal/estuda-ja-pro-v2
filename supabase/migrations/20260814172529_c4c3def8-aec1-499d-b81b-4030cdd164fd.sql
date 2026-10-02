-- Identify the source of recursion in the 'disciplines' table
-- Let's check for any dependent objects that could be triggering RLS back on disciplines

-- 1. Drop the check_is_enrolled function just in case
DROP POLICY IF EXISTS "disciplines_select_policy" ON public.disciplines CASCADE;
DROP POLICY IF EXISTS "material_modules_select_policy" ON public.material_modules CASCADE;
DROP POLICY IF EXISTS "materials_select_policy" ON public.materials CASCADE;
DROP FUNCTION IF EXISTS public.check_is_enrolled(uuid, uuid) CASCADE;

-- 2. Check for policies on OTHER tables that might join to disciplines
-- such as profiles, institutions, or anything else referenced in a policy
DROP POLICY IF EXISTS "Profiles are viewable by owner and admin" ON public.profiles;
CREATE POLICY "Profiles are viewable by owner and admin"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 3. The simplest possible SECURE policy for disciplines
-- Only teacher or admin, NO enrollment check for now to identify if this is the trigger
CREATE POLICY "disciplines_secure_base"
ON public.disciplines
FOR SELECT
TO authenticated
USING (
  teacher_id = auth.uid() 
  OR public.has_role(auth.uid(), 'admin')
);

-- 4. The simplest possible SECURE policy for discipline_students
CREATE POLICY "discipline_students_secure_base"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (
  student_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
);

-- 5. Re-grant
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;
