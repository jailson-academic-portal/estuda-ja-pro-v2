CREATE INDEX IF NOT EXISTS idx_activity_submissions_student ON public.activity_submissions (student_id);
CREATE INDEX IF NOT EXISTS idx_academic_work_submissions_student ON public.academic_work_submissions (student_id);
CREATE INDEX IF NOT EXISTS idx_exercise_submissions_student ON public.exercise_submissions (student_id);
CREATE INDEX IF NOT EXISTS idx_activities_discipline_status ON public.activities (discipline_id, status);
CREATE INDEX IF NOT EXISTS idx_academic_works_discipline_status ON public.academic_works (discipline_id, status);
CREATE INDEX IF NOT EXISTS idx_exercises_discipline_status ON public.exercises (discipline_id, status);