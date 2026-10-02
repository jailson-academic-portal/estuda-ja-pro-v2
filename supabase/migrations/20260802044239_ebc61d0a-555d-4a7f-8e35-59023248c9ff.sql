-- Implement RLS and Teacher Isolation (Multi-tenancy)

-- 1. Disciplinas
ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Professors can manage their own disciplines" ON public.disciplines;
CREATE POLICY "Professors can manage their own disciplines"
ON public.disciplines
FOR ALL
TO authenticated
USING (teacher_id = auth.uid())
WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Students can see disciplines they are enrolled in" ON public.disciplines;
CREATE POLICY "Students can see disciplines they are enrolled in"
ON public.disciplines
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.discipline_students
    WHERE discipline_id = public.disciplines.id
    AND student_id = auth.uid()
  )
);

-- 2. Modulos (material_modules)
ALTER TABLE public.material_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Professors can manage their own modules" ON public.material_modules;
CREATE POLICY "Professors can manage their own modules"
ON public.material_modules
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.disciplines
    WHERE id = public.material_modules.discipline_id
    AND teacher_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Students can see modules of their disciplines" ON public.material_modules;
CREATE POLICY "Students can see modules of their disciplines"
ON public.material_modules
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.discipline_students
    WHERE discipline_id = public.material_modules.discipline_id
    AND student_id = auth.uid()
  )
);

-- 3. Aulas (materials)
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Professors can manage their own materials" ON public.materials;
CREATE POLICY "Professors can manage their own materials"
ON public.materials
FOR ALL
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Students can see materials of their disciplines" ON public.materials;
CREATE POLICY "Students can see materials of their disciplines"
ON public.materials
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.discipline_students
    WHERE discipline_id = public.materials.discipline_id
    AND student_id = auth.uid()
  )
);

-- 4. Casos Práticos (clinical_cases)
ALTER TABLE public.clinical_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage their own clinical cases" ON public.clinical_cases;
CREATE POLICY "Teachers can manage their own clinical cases"
ON public.clinical_cases
FOR ALL
TO authenticated
USING (teacher_id = auth.uid())
WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Students can see clinical cases of their disciplines" ON public.clinical_cases;
CREATE POLICY "Students can see clinical cases of their disciplines"
ON public.clinical_cases
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.discipline_students
    WHERE discipline_id = public.clinical_cases.discipline_id
    AND student_id = auth.uid()
  )
);

-- 5. Avaliações (assessments)
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage their own assessments" ON public.assessments;
CREATE POLICY "Teachers can manage their own assessments"
ON public.assessments
FOR ALL
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Students can see assessments of their disciplines" ON public.assessments;
CREATE POLICY "Students can see assessments of their disciplines"
ON public.assessments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.discipline_students
    WHERE discipline_id = public.assessments.discipline_id
    AND student_id = auth.uid()
  )
);

-- 6. Diário de Notas (grade_entries / attendance_sessions)
ALTER TABLE public.grade_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage their own grade entries" ON public.grade_entries;
CREATE POLICY "Teachers can manage their own grade entries"
ON public.grade_entries
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.disciplines
    WHERE id = public.grade_entries.discipline_id
    AND teacher_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Teachers can manage their own attendance sessions" ON public.attendance_sessions;
CREATE POLICY "Teachers can manage their own attendance sessions"
ON public.attendance_sessions
FOR ALL
TO authenticated
USING (teacher_id = auth.uid())
WITH CHECK (teacher_id = auth.uid());

-- Ensure grants are correct
GRANT SELECT, INSERT, UPDATE, DELETE ON public.disciplines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_modules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.materials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinical_cases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grade_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_sessions TO authenticated;
