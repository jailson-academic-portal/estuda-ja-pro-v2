-- COMPLETELY DROP ALL RLS POLICIES FOR CORE TABLES
-- This is a temporary measure to find the source of the recursion.
-- We will restore them one by one.

-- 1. Drop all known policies on disciplines
DROP POLICY IF EXISTS "disciplines_select_policy" ON public.disciplines;
DROP POLICY IF EXISTS "Students can see enrolled disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Teachers can manage their own disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Admins can see everything" ON public.disciplines;
DROP POLICY IF EXISTS "authenticated_view_disciplines" ON public.disciplines;

-- 2. Drop all known policies on discipline_students
DROP POLICY IF EXISTS "discipline_students_select_policy" ON public.discipline_students;
DROP POLICY IF EXISTS "Students can see their own enrollments" ON public.discipline_students;
DROP POLICY IF EXISTS "authenticated_view_enrollments" ON public.discipline_students;

-- 3. Disable RLS and immediately enable it with a single "ALLOW ALL" policy
-- If this still fails, the recursion is coming from a VIEW or TRIGGER.
ALTER TABLE public.disciplines DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_students DISABLE ROW LEVEL SECURITY;

-- 4. Re-grant access
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
