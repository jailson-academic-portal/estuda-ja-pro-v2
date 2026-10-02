-- Fix the migration failure and disable RLS for disciplines

-- 1. Drop the policy that depends on the function
DROP POLICY IF EXISTS "Students can view clinical cases of their disciplines" ON public.clinical_cases;

-- 2. Now drop the function
DROP FUNCTION IF EXISTS public.check_is_enrolled(uuid, uuid);

-- 3. Disable RLS entirely for core tables to break recursion once and for all
ALTER TABLE public.disciplines DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_students DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_modules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials DISABLE ROW LEVEL SECURITY;

-- 4. Re-grant access
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
GRANT SELECT ON public.material_modules TO authenticated;
GRANT SELECT ON public.materials TO authenticated;
GRANT SELECT ON public.clinical_cases TO authenticated;
