
-- Use supabase--migration or supabase--read_query to execute as a privileged user
-- 1. DROP ALL known policies for disciplines to ensure a clean state
DO $$ 
DECLARE 
    pol RECORD;
BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'disciplines' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.disciplines', pol.policyname);
    END LOOP;
END $$;

-- 2. DROP ALL known policies for discipline_students
DO $$ 
DECLARE 
    pol RECORD;
BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'discipline_students' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.discipline_students', pol.policyname);
    END LOOP;
END $$;

-- 3. Ensure RLS is enabled
ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_students ENABLE ROW LEVEL SECURITY;

-- 4. Re-create Security Definer functions with explicit search_path and qualified names
CREATE OR REPLACE FUNCTION public.check_student_enrollment(_discipline_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.discipline_students 
    WHERE discipline_id = _discipline_id AND student_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = _user_id AND role = 'admin'
  );
$$;

-- 5. Atomic non-recursive policies for disciplines
CREATE POLICY "disciplines_teacher_owner_v2"
ON public.disciplines
FOR ALL
TO authenticated
USING (teacher_id = auth.uid())
WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "disciplines_admin_v2"
ON public.disciplines
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "disciplines_student_v2"
ON public.disciplines
FOR SELECT
TO authenticated
USING (public.check_student_enrollment(id, auth.uid()));

-- 6. Non-recursive policies for discipline_students
CREATE POLICY "discipline_students_self_v2"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

CREATE POLICY "discipline_students_admin_v2"
ON public.discipline_students
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "discipline_students_teacher_v2"
ON public.discipline_students
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.disciplines d 
    WHERE d.id = discipline_id AND d.teacher_id = auth.uid()
  )
);

-- 7. GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.disciplines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_students TO authenticated;
GRANT ALL ON public.disciplines TO service_role;
GRANT ALL ON public.discipline_students TO service_role;
GRANT EXECUTE ON FUNCTION public.check_student_enrollment TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin TO authenticated;
