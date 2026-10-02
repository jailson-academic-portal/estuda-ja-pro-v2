
-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE public.attendance_status AS ENUM ('present', 'absent', 'justified');
CREATE TYPE public.justification_reason AS ENUM ('work_shift', 'student_illness', 'family_illness', 'variable_schedule', 'personal_emergency');
CREATE TYPE public.justification_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.exercise_type AS ENUM ('multiple_choice', 'true_false', 'fill_blanks', 'short_answer', 'column_matching');
CREATE TYPE public.activity_subtype AS ENUM ('case_study', 'practical_report', 'care_plan', 'pharmaceutical_plan', 'free_activity');
CREATE TYPE public.submission_status AS ENUM ('draft', 'submitted', 'ai_corrected', 'teacher_reviewed', 'released');
CREATE TYPE public.publish_status AS ENUM ('draft', 'published');
CREATE TYPE public.notification_kind AS ENUM (
  'justification_decision',
  'attendance_session_open',
  'new_material',
  'new_exercise',
  'new_activity',
  'new_work',
  'feedback_available',
  'grade_published'
);

-- ============================================================
-- DISCIPLINE SETTINGS
-- ============================================================
CREATE TABLE public.discipline_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL UNIQUE REFERENCES public.disciplines(id) ON DELETE CASCADE,
  justified_counts_as_presence BOOLEAN NOT NULL DEFAULT true,
  min_attendance_percent NUMERIC(5,2) NOT NULL DEFAULT 75,
  attendance_window_hours INTEGER NOT NULL DEFAULT 48,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.discipline_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage settings in own disciplines" ON public.discipline_settings
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students view settings in enrolled disciplines" ON public.discipline_settings
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = discipline_settings.discipline_id AND ds.student_id = auth.uid()));

CREATE POLICY "Admins manage all settings" ON public.discipline_settings
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions see settings" ON public.discipline_settings
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()));

-- ============================================================
-- ATTENDANCE SESSIONS + RECORDS
-- ============================================================
CREATE TABLE public.attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL,
  topic TEXT,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  code TEXT NOT NULL,
  window_hours INTEGER NOT NULL DEFAULT 48,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attendance_sessions_discipline ON public.attendance_sessions(discipline_id);
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

-- Teacher-only code visibility is enforced at the application layer (server functions strip the code for students).
CREATE POLICY "Teachers manage own attendance sessions" ON public.attendance_sessions
FOR ALL TO authenticated
USING (teacher_id = auth.uid())
WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "Students see sessions in enrolled disciplines" ON public.attendance_sessions
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = attendance_sessions.discipline_id AND ds.student_id = auth.uid()));

CREATE POLICY "Admins manage all attendance sessions" ON public.attendance_sessions
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions see attendance sessions" ON public.attendance_sessions
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()));

CREATE TABLE public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  status public.attendance_status NOT NULL DEFAULT 'absent',
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);
CREATE INDEX idx_attendance_records_session ON public.attendance_records(session_id);
CREATE INDEX idx_attendance_records_student ON public.attendance_records(student_id);
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage records in own sessions" ON public.attendance_records
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = session_id AND s.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = session_id AND s.teacher_id = auth.uid()));

CREATE POLICY "Students see own records" ON public.attendance_records
FOR SELECT TO authenticated
USING (student_id = auth.uid());

CREATE POLICY "Admins manage all records" ON public.attendance_records
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions see records" ON public.attendance_records
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.attendance_sessions s JOIN public.disciplines d ON d.id = s.discipline_id
  WHERE s.id = session_id AND d.institution_id = public.current_institution_id()
));

-- ============================================================
-- JUSTIFICATIONS
-- ============================================================
CREATE TABLE public.justifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  reason public.justification_reason NOT NULL,
  description TEXT,
  attachment_url TEXT,
  status public.justification_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);
CREATE INDEX idx_justifications_session ON public.justifications(session_id);
ALTER TABLE public.justifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students manage own justifications" ON public.justifications
FOR ALL TO authenticated
USING (student_id = auth.uid())
WITH CHECK (student_id = auth.uid());

CREATE POLICY "Teachers manage justifications in own sessions" ON public.justifications
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = session_id AND s.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = session_id AND s.teacher_id = auth.uid()));

CREATE POLICY "Admins manage all justifications" ON public.justifications
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions see justifications" ON public.justifications
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.attendance_sessions s JOIN public.disciplines d ON d.id = s.discipline_id
  WHERE s.id = session_id AND d.institution_id = public.current_institution_id()
));

-- ============================================================
-- MATERIALS
-- ============================================================
CREATE TABLE public.material_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.material_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own material modules" ON public.material_modules
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students view modules in enrolled disciplines" ON public.material_modules
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = material_modules.discipline_id AND ds.student_id = auth.uid()));

CREATE POLICY "Admins manage all material modules" ON public.material_modules
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions see material modules" ON public.material_modules
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()));

CREATE TABLE public.materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.material_modules(id) ON DELETE CASCADE,
  discipline_id UUID NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT,
  file_url TEXT,
  status public.publish_status NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'manual',
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own materials" ON public.materials
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students view published materials" ON public.materials
FOR SELECT TO authenticated
USING (
  status = 'published'
  AND EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = materials.discipline_id AND ds.student_id = auth.uid())
);

CREATE POLICY "Admins manage all materials" ON public.materials
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions see materials" ON public.materials
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()));

-- ============================================================
-- EXERCISES
-- ============================================================
CREATE TABLE public.exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic TEXT,
  type public.exercise_type NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ,
  rubric JSONB,
  status public.publish_status NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own exercises" ON public.exercises
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students view published exercises" ON public.exercises
FOR SELECT TO authenticated
USING (
  status = 'published'
  AND EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = exercises.discipline_id AND ds.student_id = auth.uid())
);

CREATE POLICY "Admins manage all exercises" ON public.exercises
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions see exercises" ON public.exercises
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()));

CREATE TABLE public.exercise_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL,
  -- Generic options array. Shape depends on exercise type:
  -- multiple_choice: [{ id, text, correct: bool }]
  -- true_false: [{ value: true|false, correct }]
  -- fill_blanks: [{ accepted_answers: [string] }]
  -- column_matching: { left: [...], right: [...], pairs: [[leftId,rightId]] }
  options JSONB,
  correct_answer JSONB,
  explanation TEXT,
  points NUMERIC NOT NULL DEFAULT 1
);
ALTER TABLE public.exercise_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own questions" ON public.exercise_questions
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.exercises e JOIN public.disciplines d ON d.id = e.discipline_id WHERE e.id = exercise_id AND d.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.exercises e JOIN public.disciplines d ON d.id = e.discipline_id WHERE e.id = exercise_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students view questions of published exercises" ON public.exercise_questions
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.exercises e
  JOIN public.discipline_students ds ON ds.discipline_id = e.discipline_id
  WHERE e.id = exercise_id AND e.status = 'published' AND ds.student_id = auth.uid()
));

CREATE POLICY "Admins manage questions" ON public.exercise_questions
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.exercise_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  score NUMERIC,
  max_score NUMERIC,
  feedback JSONB,
  status public.submission_status NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  UNIQUE (exercise_id, student_id)
);
ALTER TABLE public.exercise_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students manage own submissions" ON public.exercise_submissions
FOR ALL TO authenticated
USING (student_id = auth.uid())
WITH CHECK (student_id = auth.uid());

CREATE POLICY "Teachers manage submissions in own exercises" ON public.exercise_submissions
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.exercises e JOIN public.disciplines d ON d.id = e.discipline_id WHERE e.id = exercise_id AND d.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.exercises e JOIN public.disciplines d ON d.id = e.discipline_id WHERE e.id = exercise_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Admins manage all submissions" ON public.exercise_submissions
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- ACTIVITIES
-- ============================================================
CREATE TABLE public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  subtype public.activity_subtype NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT,
  cover_config JSONB,         -- institution, course, fields required
  format_config JSONB,        -- font_family, font_size, line_spacing, margins
  structure_config JSONB,     -- expected sections array
  allow_attachments BOOLEAN NOT NULL DEFAULT false,
  max_attachments INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ,
  rubric JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of { id, name, weight, description }
  status public.publish_status NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own activities" ON public.activities
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students view published activities" ON public.activities
FOR SELECT TO authenticated
USING (
  status = 'published'
  AND EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = activities.discipline_id AND ds.student_id = auth.uid())
);

CREATE POLICY "Admins manage all activities" ON public.activities
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions see activities" ON public.activities
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()));

CREATE TABLE public.activity_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  file_url TEXT NOT NULL,
  attachments JSONB,
  ai_report JSONB,
  teacher_comment TEXT,
  rubric_scores JSONB,
  total_score NUMERIC,
  status public.submission_status NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  UNIQUE (activity_id, student_id)
);
ALTER TABLE public.activity_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students manage own activity submissions" ON public.activity_submissions
FOR ALL TO authenticated
USING (student_id = auth.uid())
WITH CHECK (student_id = auth.uid());

CREATE POLICY "Teachers manage activity submissions in own disciplines" ON public.activity_submissions
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.activities a JOIN public.disciplines d ON d.id = a.discipline_id WHERE a.id = activity_id AND d.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.activities a JOIN public.disciplines d ON d.id = a.discipline_id WHERE a.id = activity_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Admins manage all activity submissions" ON public.activity_submissions
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- ACADEMIC WORKS
-- ============================================================
CREATE TABLE public.academic_works (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  instructions TEXT,
  cover_config JSONB,
  format_config JSONB,
  structure_config JSONB,
  due_at TIMESTAMPTZ,
  rubric JSONB NOT NULL DEFAULT '[]'::jsonb,
  status public.publish_status NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.academic_works ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own works" ON public.academic_works
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students view published works" ON public.academic_works
FOR SELECT TO authenticated
USING (
  status = 'published'
  AND EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = academic_works.discipline_id AND ds.student_id = auth.uid())
);

CREATE POLICY "Admins manage all works" ON public.academic_works
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions see works" ON public.academic_works
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()));

CREATE TABLE public.academic_work_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id UUID NOT NULL REFERENCES public.academic_works(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  file_url TEXT NOT NULL,
  abnt_report JSONB,
  content_report JSONB,
  teacher_comment TEXT,
  rubric_scores JSONB,
  total_score NUMERIC,
  status public.submission_status NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  UNIQUE (work_id, student_id)
);
ALTER TABLE public.academic_work_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students manage own work submissions" ON public.academic_work_submissions
FOR ALL TO authenticated
USING (student_id = auth.uid())
WITH CHECK (student_id = auth.uid());

CREATE POLICY "Teachers manage work submissions in own disciplines" ON public.academic_work_submissions
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.academic_works w JOIN public.disciplines d ON d.id = w.discipline_id WHERE w.id = work_id AND d.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.academic_works w JOIN public.disciplines d ON d.id = w.discipline_id WHERE w.id = work_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Admins manage all work submissions" ON public.academic_work_submissions
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- GRADES
-- ============================================================
CREATE TABLE public.grade_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL UNIQUE REFERENCES public.disciplines(id) ON DELETE CASCADE,
  -- assessments: [{ id, name, weight }]
  assessments JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- formula: 'weighted_average' (default) or custom expression in future
  formula TEXT NOT NULL DEFAULT 'weighted_average',
  passing_average NUMERIC NOT NULL DEFAULT 6,
  recovery_min NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.grade_structures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers see structures of own disciplines" ON public.grade_structures
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students view grade structure" ON public.grade_structures
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = grade_structures.discipline_id AND ds.student_id = auth.uid()));

CREATE POLICY "Admins manage all structures" ON public.grade_structures
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions manage structures" ON public.grade_structures
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()))
WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()));

CREATE TABLE public.grade_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  assessment_id TEXT NOT NULL,
  score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discipline_id, student_id, assessment_id)
);
ALTER TABLE public.grade_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage grades in own disciplines" ON public.grade_entries
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students view own grades" ON public.grade_entries
FOR SELECT TO authenticated
USING (student_id = auth.uid());

CREATE POLICY "Admins manage all grades" ON public.grade_entries
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions see grades" ON public.grade_entries
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()));

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  kind public.notification_kind NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  data JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, read_at);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own notifications" ON public.notifications
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users update own notifications" ON public.notifications
FOR UPDATE TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users delete own notifications" ON public.notifications
FOR DELETE TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins manage all notifications" ON public.notifications
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- TIMESTAMP TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_discipline_settings_upd BEFORE UPDATE ON public.discipline_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_attendance_records_upd BEFORE UPDATE ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_justifications_upd BEFORE UPDATE ON public.justifications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_materials_upd BEFORE UPDATE ON public.materials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_exercises_upd BEFORE UPDATE ON public.exercises FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_activities_upd BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_works_upd BEFORE UPDATE ON public.academic_works FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_grade_structures_upd BEFORE UPDATE ON public.grade_structures FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_grade_entries_upd BEFORE UPDATE ON public.grade_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('materials', 'materials', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('justifications', 'justifications', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('submissions', 'submissions', false) ON CONFLICT (id) DO NOTHING;

-- Materials: teachers manage in their discipline folder; students read published material files
CREATE POLICY "Teachers manage materials files" ON storage.objects
FOR ALL TO authenticated
USING (
  bucket_id = 'materials'
  AND EXISTS (
    SELECT 1 FROM public.disciplines d
    WHERE d.id::text = (storage.foldername(name))[1] AND d.teacher_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'materials'
  AND EXISTS (
    SELECT 1 FROM public.disciplines d
    WHERE d.id::text = (storage.foldername(name))[1] AND d.teacher_id = auth.uid()
  )
);

CREATE POLICY "Students read materials in enrolled disciplines" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'materials'
  AND EXISTS (
    SELECT 1 FROM public.discipline_students ds
    WHERE ds.discipline_id::text = (storage.foldername(name))[1] AND ds.student_id = auth.uid()
  )
);

-- Justifications: students upload their own (folder = student_id), teachers read in their disciplines via service role server functions.
CREATE POLICY "Students upload own justifications" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'justifications'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Students read own justifications" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'justifications'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Submissions: students upload to their folder; teachers read in their disciplines via service role.
CREATE POLICY "Students upload own submissions" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'submissions'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Students read own submissions" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'submissions'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
