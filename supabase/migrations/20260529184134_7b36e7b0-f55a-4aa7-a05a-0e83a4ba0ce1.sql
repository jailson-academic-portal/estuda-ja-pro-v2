-- Fix STUDENT_GRADE_MANIPULATION: students could UPDATE/DELETE their own
-- submission rows, including grading columns (final_score, total_score,
-- rubric_scores, teacher_comment, status, etc.). Replace the permissive
-- ALL policies with read-only (SELECT) access for students. All submission
-- creation and grading already happens server-side via the service role.

-- activity_submissions
DROP POLICY IF EXISTS "Students manage own activity submissions" ON public.activity_submissions;
CREATE POLICY "Students view own activity submissions"
ON public.activity_submissions
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

-- academic_work_submissions
DROP POLICY IF EXISTS "Students manage own work submissions" ON public.academic_work_submissions;
CREATE POLICY "Students view own work submissions"
ON public.academic_work_submissions
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

-- exercise_submissions
DROP POLICY IF EXISTS "Students manage own submissions" ON public.exercise_submissions;
CREATE POLICY "Students view own submissions"
ON public.exercise_submissions
FOR SELECT
TO authenticated
USING (student_id = auth.uid());