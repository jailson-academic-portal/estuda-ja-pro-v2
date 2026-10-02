-- Nuclear option to kill the recursion: 
-- 1. Drop EVERYTHING related to disciplines policies
DROP POLICY IF EXISTS "Students can see enrolled disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Teachers can manage their own disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Admins can see everything" ON public.disciplines;

-- 2. Create the most basic policy possible
CREATE POLICY "authenticated_view_disciplines"
ON public.disciplines
FOR SELECT
TO authenticated
USING (true); -- Temporarily allow all authenticated to read while we debug the exact cause

-- 3. Also fix discipline_students to be absolutely permissive for reads
DROP POLICY IF EXISTS "Students can see their own enrollments" ON public.discipline_students;
CREATE POLICY "authenticated_view_enrollments"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (true);

-- 4. Check if we have recursive policies on material_modules or materials
DROP POLICY IF EXISTS "Students can see modules of their disciplines" ON public.material_modules;
CREATE POLICY "authenticated_view_modules"
ON public.material_modules
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Students can see materials of their modules" ON public.materials;
CREATE POLICY "authenticated_view_materials"
ON public.materials
FOR SELECT
TO authenticated
USING (true);

-- 5. Revoke anon access just in case
REVOKE ALL ON public.disciplines FROM anon;
REVOKE ALL ON public.discipline_students FROM anon;

-- 6. Re-grant to authenticated
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
GRANT SELECT ON public.material_modules TO authenticated;
GRANT SELECT ON public.materials TO authenticated;
