-- Fix discipline_students RLS: Scoped policies for Admins, Teachers, and Students
DROP POLICY IF EXISTS "discipline_students_all" ON public.discipline_students;
DROP POLICY IF EXISTS "discipline_students_read" ON public.discipline_students;
DROP POLICY IF EXISTS "Admins can manage all discipline_students" ON public.discipline_students;
DROP POLICY IF EXISTS "Teachers can manage students in their disciplines" ON public.discipline_students;
DROP POLICY IF EXISTS "Students can see their own enrollments" ON public.discipline_students;

CREATE POLICY "Admins can manage all discipline_students"
ON public.discipline_students
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Teachers can manage students in their disciplines"
ON public.discipline_students
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.disciplines
    WHERE disciplines.id = discipline_students.discipline_id
      AND disciplines.teacher_id = auth.uid()
  )
);

CREATE POLICY "Students can see their own enrollments"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

-- Fix grade_entries RLS: Enforce discipline ownership for teachers
DROP POLICY IF EXISTS "grade_entries_all" ON public.grade_entries;
DROP POLICY IF EXISTS "grade_entries_teacher_manage" ON public.grade_entries;
DROP POLICY IF EXISTS "Admins manage all grades" ON public.grade_entries;
DROP POLICY IF EXISTS "Teachers manage grades in their disciplines" ON public.grade_entries;
DROP POLICY IF EXISTS "Students view their own grades" ON public.grade_entries;

CREATE POLICY "Admins manage all grades"
ON public.grade_entries
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Teachers manage grades in their disciplines"
ON public.grade_entries
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.disciplines
    WHERE disciplines.id = grade_entries.discipline_id
      AND disciplines.teacher_id = auth.uid()
  )
);

CREATE POLICY "Students view their own grades"
ON public.grade_entries
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

-- Fix invitations RLS: Scope invitation management for gestors to their own institution
DROP POLICY IF EXISTS "Admins manage all invitations" ON public.invitations;
DROP POLICY IF EXISTS "Gestors manage institution invitations" ON public.invitations;

CREATE POLICY "Admins manage all invitations"
ON public.invitations
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Gestors manage institution invitations"
ON public.invitations
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.profile_type = 'institution'
      AND profiles.institution_id = invitations.institution_id
  )
);

-- Fix lab config and simulations visibility: Correct join conditions
DROP POLICY IF EXISTS "Students can see active lab config" ON public.discipline_lab_config;
DROP POLICY IF EXISTS "Students can see simulation list" ON public.discipline_lab_simulations;

CREATE POLICY "Students can see active lab config"
ON public.discipline_lab_config
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.discipline_students
    WHERE discipline_students.discipline_id = discipline_lab_config.discipline_id
      AND discipline_students.student_id = auth.uid()
  )
);

CREATE POLICY "Students can see simulation list"
ON public.discipline_lab_simulations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.discipline_students
    WHERE discipline_students.discipline_id = discipline_lab_simulations.discipline_id
      AND discipline_students.student_id = auth.uid()
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grade_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_lab_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_lab_simulations TO authenticated;

GRANT ALL ON public.discipline_students TO service_role;
GRANT ALL ON public.grade_entries TO service_role;
GRANT ALL ON public.invitations TO service_role;
GRANT ALL ON public.discipline_lab_config TO service_role;
GRANT ALL ON public.discipline_lab_simulations TO service_role;
