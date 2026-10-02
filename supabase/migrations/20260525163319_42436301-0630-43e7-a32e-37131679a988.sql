
-- 1. LOGO / Identidade visual
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS logo_url text;

-- 2. Bucket branding (público para leitura)
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "branding public read" ON storage.objects;
CREATE POLICY "branding public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'branding');

DROP POLICY IF EXISTS "branding owner write" ON storage.objects;
CREATE POLICY "branding owner write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'branding' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "branding owner update" ON storage.objects;
CREATE POLICY "branding owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'branding' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "branding owner delete" ON storage.objects;
CREATE POLICY "branding owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'branding' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 3. Tipos enum para avaliações
DO $$ BEGIN
  CREATE TYPE public.assessment_question_type AS ENUM ('multiple_choice', 'true_false', 'fill_blank', 'essay');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.assessment_layout AS ENUM ('one_column', 'two_columns', 'mixed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.assessment_status AS ENUM ('draft', 'ready', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.assessment_submission_status AS ENUM ('pending', 'graded_objective', 'awaiting_review', 'confirmed', 'posted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. assessments
CREATE TABLE IF NOT EXISTS public.assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id uuid NOT NULL,
  created_by uuid NOT NULL,
  title text NOT NULL,
  apostila_generation_id uuid,
  module_name text,
  lessons jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_score numeric NOT NULL DEFAULT 10,
  layout public.assessment_layout NOT NULL DEFAULT 'mixed',
  layout_rationale text,
  diary_assessment_id text,
  version_count int NOT NULL DEFAULT 1 CHECK (version_count BETWEEN 1 AND 3),
  copies_per_version int NOT NULL DEFAULT 1,
  rigor text NOT NULL DEFAULT 'balanced',
  status public.assessment_status NOT NULL DEFAULT 'draft',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assessments_discipline ON public.assessments(discipline_id);

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage assessments" ON public.assessments;
CREATE POLICY "Admins manage assessments" ON public.assessments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Teachers manage own assessments" ON public.assessments;
CREATE POLICY "Teachers manage own assessments" ON public.assessments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

-- 5. assessment_questions (banco mestre de questões da avaliação)
CREATE TABLE IF NOT EXISTS public.assessment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  qtype public.assessment_question_type NOT NULL,
  prompt text NOT NULL,
  options jsonb,
  correct_answer jsonb,
  explanation text,
  rubric jsonb,
  weight numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aq_assessment ON public.assessment_questions(assessment_id);

ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage aq" ON public.assessment_questions;
CREATE POLICY "Admins manage aq" ON public.assessment_questions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Teachers manage aq" ON public.assessment_questions;
CREATE POLICY "Teachers manage aq" ON public.assessment_questions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM assessments a JOIN disciplines d ON d.id = a.discipline_id WHERE a.id = assessment_id AND d.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM assessments a JOIN disciplines d ON d.id = a.discipline_id WHERE a.id = assessment_id AND d.teacher_id = auth.uid()));

-- 6. assessment_versions
CREATE TABLE IF NOT EXISTS public.assessment_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  question_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  option_orders jsonb NOT NULL DEFAULT '{}'::jsonb,
  answer_key jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, version_label)
);

ALTER TABLE public.assessment_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage av" ON public.assessment_versions;
CREATE POLICY "Admins manage av" ON public.assessment_versions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Teachers manage av" ON public.assessment_versions;
CREATE POLICY "Teachers manage av" ON public.assessment_versions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM assessments a JOIN disciplines d ON d.id = a.discipline_id WHERE a.id = assessment_id AND d.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM assessments a JOIN disciplines d ON d.id = a.discipline_id WHERE a.id = assessment_id AND d.teacher_id = auth.uid()));

-- 7. assessment_assignments (folha por aluno)
CREATE TABLE IF NOT EXISTS public.assessment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.assessment_versions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  qr_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  copy_index int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aa_assessment ON public.assessment_assignments(assessment_id);
CREATE INDEX IF NOT EXISTS idx_aa_student ON public.assessment_assignments(student_id);

ALTER TABLE public.assessment_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage aa" ON public.assessment_assignments;
CREATE POLICY "Admins manage aa" ON public.assessment_assignments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Teachers manage aa" ON public.assessment_assignments;
CREATE POLICY "Teachers manage aa" ON public.assessment_assignments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM assessments a JOIN disciplines d ON d.id = a.discipline_id WHERE a.id = assessment_id AND d.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM assessments a JOIN disciplines d ON d.id = a.discipline_id WHERE a.id = assessment_id AND d.teacher_id = auth.uid()));

DROP POLICY IF EXISTS "Students see own assignment" ON public.assessment_assignments;
CREATE POLICY "Students see own assignment" ON public.assessment_assignments
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- 8. assessment_submissions
CREATE TABLE IF NOT EXISTS public.assessment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL UNIQUE REFERENCES public.assessment_assignments(id) ON DELETE CASCADE,
  objective_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  essay_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ocr_raw jsonb,
  ai_feedback jsonb,
  per_question_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_score numeric,
  teacher_comment text,
  final_feedback text,
  status public.assessment_submission_status NOT NULL DEFAULT 'pending',
  graded_at timestamptz,
  posted_at timestamptz,
  posted_diary_entry_id uuid,
  posted_grade_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asub_assignment ON public.assessment_submissions(assignment_id);

ALTER TABLE public.assessment_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage asub" ON public.assessment_submissions;
CREATE POLICY "Admins manage asub" ON public.assessment_submissions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Teachers manage asub" ON public.assessment_submissions;
CREATE POLICY "Teachers manage asub" ON public.assessment_submissions
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM assessment_assignments aa
    JOIN assessments a ON a.id = aa.assessment_id
    JOIN disciplines d ON d.id = a.discipline_id
    WHERE aa.id = assignment_id AND d.teacher_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM assessment_assignments aa
    JOIN assessments a ON a.id = aa.assessment_id
    JOIN disciplines d ON d.id = a.discipline_id
    WHERE aa.id = assignment_id AND d.teacher_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Students see own posted submission" ON public.assessment_submissions;
CREATE POLICY "Students see own posted submission" ON public.assessment_submissions
  FOR SELECT TO authenticated
  USING (
    status = 'posted'
    AND EXISTS (SELECT 1 FROM assessment_assignments aa WHERE aa.id = assignment_id AND aa.student_id = auth.uid())
  );

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_assessments_updated ON public.assessments;
CREATE TRIGGER trg_assessments_updated BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_assessment_submissions_updated ON public.assessment_submissions;
CREATE TRIGGER trg_assessment_submissions_updated BEFORE UPDATE ON public.assessment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
