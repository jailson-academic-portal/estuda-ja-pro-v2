
-- 1) INVITATIONS: remove client-side SELECT capability; keep INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "Institutions manage own invitations" ON public.invitations;

CREATE POLICY "Institutions insert own invitations" ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND kind = 'teacher');

CREATE POLICY "Institutions update own invitations" ON public.invitations
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Institutions delete own invitations" ON public.invitations
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- 2) STORAGE: tighten syllabi student-read policy to match exact file URL
DROP POLICY IF EXISTS "Students read enrolled syllabi" ON storage.objects;

CREATE POLICY "Students read enrolled syllabi" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'syllabi'
    AND EXISTS (
      SELECT 1
      FROM public.disciplines d
      JOIN public.discipline_students ds ON ds.discipline_id = d.id
      WHERE ds.student_id = auth.uid()
        AND d.syllabus_file_url IS NOT NULL
        AND position('/' || storage.objects.name in d.syllabus_file_url) > 0
    )
  );

-- 3) EXERCISE_QUESTIONS: hide correct_answer/explanation from students
DROP POLICY IF EXISTS "Students view questions of published exercises" ON public.exercise_questions;

CREATE OR REPLACE VIEW public.exercise_questions_student
WITH (security_invoker = off) AS
SELECT eq.id, eq.exercise_id, eq.position, eq.prompt, eq.options, eq.points
FROM public.exercise_questions eq
WHERE EXISTS (
  SELECT 1
  FROM public.exercises e
  JOIN public.discipline_students ds ON ds.discipline_id = e.discipline_id
  WHERE e.id = eq.exercise_id
    AND e.status = 'published'
    AND ds.student_id = auth.uid()
);

GRANT SELECT ON public.exercise_questions_student TO authenticated;

-- 4) ATTENDANCE_SESSIONS: hide check-in code from students
DROP POLICY IF EXISTS "Students see sessions in enrolled disciplines" ON public.attendance_sessions;

CREATE OR REPLACE VIEW public.attendance_sessions_view
WITH (security_invoker = off) AS
SELECT s.id, s.discipline_id, s.teacher_id, s.session_date, s.starts_at,
       s.topic, s.window_hours, s.code_window_minutes, s.created_at,
       s.finalized_at, s.finalized_by,
       CASE
         WHEN s.teacher_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
         THEN s.code
         ELSE NULL
       END AS code
FROM public.attendance_sessions s
WHERE s.teacher_id = auth.uid()
   OR public.has_role(auth.uid(), 'admin')
   OR EXISTS (
     SELECT 1 FROM public.discipline_students ds
     WHERE ds.discipline_id = s.discipline_id AND ds.student_id = auth.uid()
   )
   OR EXISTS (
     SELECT 1 FROM public.disciplines d
     WHERE d.id = s.discipline_id AND d.institution_id = public.current_institution_id()
   );

GRANT SELECT ON public.attendance_sessions_view TO authenticated;
