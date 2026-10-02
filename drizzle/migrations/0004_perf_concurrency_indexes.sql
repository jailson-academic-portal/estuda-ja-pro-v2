-- Non-destructive performance indexes for high-concurrency assessment days
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON public.profiles (lower(email));
CREATE INDEX IF NOT EXISTS idx_profiles_enrollment_number ON public.profiles (enrollment_number);

CREATE INDEX IF NOT EXISTS idx_assessments_created_by ON public.assessments (created_by);
CREATE INDEX IF NOT EXISTS idx_assessments_discipline_created_by ON public.assessments (discipline_id, created_by);

CREATE INDEX IF NOT EXISTS idx_assessment_assignments_assessment_student ON public.assessment_assignments (assessment_id, student_id);
CREATE INDEX IF NOT EXISTS idx_assessment_assignments_student ON public.assessment_assignments (student_id);
CREATE INDEX IF NOT EXISTS idx_assessment_submissions_assignment ON public.assessment_submissions (assignment_id);

CREATE INDEX IF NOT EXISTS idx_activity_submissions_activity_student ON public.activity_submissions (activity_id, student_id);
CREATE INDEX IF NOT EXISTS idx_academic_work_submissions_work_student ON public.academic_work_submissions (work_id, student_id);
CREATE INDEX IF NOT EXISTS idx_exercise_submissions_exercise_student ON public.exercise_submissions (exercise_id, student_id);
CREATE INDEX IF NOT EXISTS idx_discipline_students_student ON public.discipline_students (student_id);
CREATE INDEX IF NOT EXISTS idx_grade_entries_discipline_student ON public.grade_entries (discipline_id, student_id);