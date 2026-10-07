-- =============================================================
-- Setup COMPLETO do módulo de Avaliações Online (do zero)
--
-- Cria o baseline mínimo necessário (institutions, profiles,
-- user_roles, disciplines, discipline_students, attendance_*)
-- MAIS as tabelas do módulo de avaliações (assessments e filhas)
-- MAIS as tabelas de provas online (online_exams, exam_sessions,
-- exam_answers).
--
-- Tabelas criadas (todas com CREATE TABLE IF NOT EXISTS):
--   BASELINE
--     1.  institutions
--     2.  profiles
--     3.  user_roles
--     4.  disciplines
--     5.  discipline_students
--     6.  attendance_sessions
--     7.  attendance_records
--   AVALIAÇÕES
--     8.  assessments
--     9.  assessment_questions
--     10. assessment_versions
--     11. assessment_assignments
--     12. assessment_submissions
--     13. assessment_question_audits
--     14. assessment_control_counters
--   PROVAS ONLINE
--     15. online_exams  (inclui attendance_session_id para vincular
--                         à chamada do Diário Digital)
--     16. exam_sessions
--     17. exam_answers
--
-- Tabelas NÃO criadas (escopo de outros módulos — ex.: materials,
-- exercises, activities, materials, clinical_cases, etc.). Se elas
-- não existirem no seu banco, as telas correspondentes não vão abrir,
-- mas o módulo de avaliações online vai funcionar.
--
-- Regras de negócio:
--   - Provas: a sala só abre se o aluno tiver presença confirmada
--     na CHAMADA ESPECÍFICA do Diário Digital (attendance_session)
--     vinculada à prova via online_exams.attendance_session_id. O
--     próprio aluno registra a presença via QR Code ou código de
--     6 letras no próprio sistema, e a sala é destravada
--     automaticamente.
--   - Troca de respostas: upsert por (session_id, question_id).
--   - Auto-envio: quando o cronômetro zera, dispara submitNow().
--
-- Idempotente: pode rodar mais de uma vez. Após rodar com sucesso,
-- execute também no SQL Editor:
--
--   NOTIFY pgrst, 'reload schema';
-- =============================================================


-- ============================================================
-- 0. ENUMS (todos com DO $$ BEGIN ... EXCEPTION para idempotência)
-- ============================================================

-- BASELINE
DO $$ BEGIN
  CREATE TYPE public.profile_type AS ENUM ('admin', 'institution', 'teacher', 'student');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'institution', 'teacher', 'student', 'gestor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.user_status AS ENUM ('active', 'inactive', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.discipline_status AS ENUM ('active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.attendance_status AS ENUM ('present', 'absent', 'justified', 'no_class');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AVALIAÇÕES
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

-- PROVAS ONLINE
DO $$ BEGIN
  CREATE TYPE public.biometric_kind AS ENUM ('face','fingerprint','iris','voice');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.online_exam_status AS ENUM ('draft','scheduled','open','closed','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.exam_session_status AS ENUM ('not_started','in_progress','submitted','graded','invalidated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================
-- 0.5 DEFESA: garante que a coluna attendance_session_id existe
-- em online_exams ANTES de qualquer CREATE INDEX / POLICY / VIEW /
-- FUNCTION que a referencia. Se a tabela ja foi criada em uma
-- rodada anterior sem essa coluna, este ALTER TABLE resolve.
-- (Idempotente: ADD COLUMN IF NOT EXISTS nao falha se a coluna
-- ja existir.)
--
-- Atencao: nesta fase do script public.attendance_sessions ainda
-- NAO existe (e criada na secao 6), entao adicionamos a coluna
-- SEM FK primeiro. A FK sera adicionada abaixo, na secao 15.5,
-- apos a tabela referenciada existir.
-- ============================================================

ALTER TABLE public.online_exams
  ADD COLUMN IF NOT EXISTS attendance_session_id uuid;

CREATE INDEX IF NOT EXISTS idx_online_exams_attendance_session
  ON public.online_exams (attendance_session_id)
  WHERE attendance_session_id IS NOT NULL;


-- ============================================================
-- 1. public.institutions (BASELINE)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  owner_user_id UUID,
  status public.user_status NOT NULL DEFAULT 'active',
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 2. public.profiles (BASELINE)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  enrollment_number TEXT UNIQUE,
  profile_type public.profile_type NOT NULL DEFAULT 'student',
  institution_id UUID REFERENCES public.institutions(id) ON DELETE SET NULL,
  status public.user_status NOT NULL DEFAULT 'active',
  password_set BOOLEAN NOT NULL DEFAULT true,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_enrollment ON public.profiles(enrollment_number);
CREATE INDEX IF NOT EXISTS idx_profiles_institution ON public.profiles(institution_id);
CREATE INDEX IF NOT EXISTS idx_profiles_type ON public.profiles(profile_type);


-- ============================================================
-- 3. public.user_roles (BASELINE)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);


-- ============================================================
-- 4. public.disciplines (BASELINE)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.disciplines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id UUID REFERENCES public.institutions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  code TEXT,
  semester TEXT NOT NULL DEFAULT '1',
  year INT NOT NULL DEFAULT EXTRACT(YEAR FROM now())::int,
  syllabus_text TEXT,
  syllabus_file_url TEXT,
  color TEXT NOT NULL DEFAULT 'teal',
  status public.discipline_status NOT NULL DEFAULT 'active',
  class_start_time TEXT,
  class_end_time TEXT,
  week_days TEXT[],
  start_date DATE,
  end_date DATE,
  location TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  group_name TEXT,
  course_id UUID,
  visible_modules JSONB,
  passing_grade NUMERIC(5,2),
  min_score_for_final NUMERIC(5,2),
  min_recovery_grade NUMERIC(5,2),
  recovery_behavior TEXT,
  grading_formula_mf JSONB,
  grading_formula_mp JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disciplines_teacher ON public.disciplines(teacher_id);
CREATE INDEX IF NOT EXISTS idx_disciplines_institution ON public.disciplines(institution_id);


-- ============================================================
-- 5. public.discipline_students (BASELINE)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.discipline_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status public.user_status NOT NULL DEFAULT 'active',
  UNIQUE (discipline_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_ds_discipline ON public.discipline_students(discipline_id);
CREATE INDEX IF NOT EXISTS idx_ds_student ON public.discipline_students(student_id);


-- ============================================================
-- 6. public.attendance_sessions (BASELINE - Diário Digital)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic TEXT,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  code TEXT NOT NULL,
  window_hours INT NOT NULL DEFAULT 48,
  code_window_minutes INT NOT NULL DEFAULT 15,
  starts_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  finalized_by UUID,
  pedagogical_observations TEXT,
  programmatic_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_discipline
  ON public.attendance_sessions(discipline_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_starts_at
  ON public.attendance_sessions(starts_at);


-- ============================================================
-- 7. public.attendance_records (BASELINE - Diário Digital)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.attendance_status NOT NULL DEFAULT 'absent',
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_session
  ON public.attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student
  ON public.attendance_records(student_id);


-- ============================================================
-- 8. public.assessments (AVALIAÇÕES)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id uuid NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  apostila_generation_id uuid,
  module_name text,
  lessons jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_score numeric NOT NULL DEFAULT 10,
  layout public.assessment_layout NOT NULL DEFAULT 'mixed',
  layout_rationale text,
  diary_assessment_id text,
  version_count int NOT NULL DEFAULT 1 CHECK (version_count BETWEEN 1 AND 4),
  copies_per_version int NOT NULL DEFAULT 1,
  rigor text NOT NULL DEFAULT 'balanced',
  status public.assessment_status NOT NULL DEFAULT 'draft',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  assessment_date timestamptz,
  group_dates jsonb,
  application_format text,
  assessment_schedule text,
  control_number text,
  control_year integer,
  control_scope_key text,
  control_sequence integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessments_discipline ON public.assessments(discipline_id);
CREATE UNIQUE INDEX IF NOT EXISTS assessments_control_sequence_key
  ON public.assessments (control_sequence) WHERE control_sequence IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assessments_control_number_key
  ON public.assessments (control_number) WHERE control_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assessments_control_scope_year
  ON public.assessments (control_scope_key, control_year, control_sequence)
  WHERE control_scope_key IS NOT NULL
    AND control_year IS NOT NULL
    AND control_sequence IS NOT NULL;


-- ============================================================
-- 9. public.assessment_questions (AVALIAÇÕES)
-- ============================================================

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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aq_assessment ON public.assessment_questions(assessment_id);


-- ============================================================
-- 10. public.assessment_versions (AVALIAÇÕES)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.assessment_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  question_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  option_orders jsonb NOT NULL DEFAULT '{}'::jsonb,
  answer_key jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, version_label)
);


-- ============================================================
-- 11. public.assessment_assignments (AVALIAÇÕES)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.assessment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.assessment_versions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  qr_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  copy_index int NOT NULL DEFAULT 1,
  group_number int,
  bubble_layout jsonb,
  question_order text[],
  option_orders jsonb,
  answer_key jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aa_assessment ON public.assessment_assignments(assessment_id);
CREATE INDEX IF NOT EXISTS idx_aa_student ON public.assessment_assignments(student_id);


-- ============================================================
-- 12. public.assessment_submissions (AVALIAÇÕES)
-- ============================================================

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


-- ============================================================
-- 13. public.assessment_question_audits (AVALIAÇÕES)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.assessment_question_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.assessment_questions(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  position integer NOT NULL,
  concept text,
  lesson_tag text,
  status text NOT NULL,
  message text,
  concept_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  declared_level text,
  detected_level text,
  suggested_prompt text,
  resolution text NOT NULL DEFAULT 'pending',
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aqa_assessment
  ON public.assessment_question_audits(assessment_id, resolution);


-- ============================================================
-- 14. public.assessment_control_counters (AVALIAÇÕES)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.assessment_control_counters (
  scope_key text NOT NULL,
  control_year integer NOT NULL,
  next_sequence integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, control_year)
);


-- ============================================================
-- 15. public.online_exams (PROVAS ONLINE)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.online_exams (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id         uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  discipline_id         uuid NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  created_by            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  instructions          text,
  status                public.online_exam_status NOT NULL DEFAULT 'draft',

  time_limit_minutes    integer NOT NULL DEFAULT 60 CHECK (time_limit_minutes BETWEEN 1 AND 600),
  max_score             numeric NOT NULL DEFAULT 10,
  randomize_questions   boolean NOT NULL DEFAULT false,
  randomize_options     boolean NOT NULL DEFAULT false,

  opens_at              timestamptz,
  closes_at             timestamptz,

  -- Colunas "dormant" da era biometrica (em pausa). Mantidas para
  -- nao quebrar selects legados; o servidor grava sempre false/null.
  biometric_required      boolean NOT NULL DEFAULT false,
  biometric_kind_required public.biometric_kind,
  require_face_match      boolean NOT NULL DEFAULT false,

  -- Vínculo explícito com uma chamada do Diário Digital. Quando
  -- preenchida, a presença NESTA chamada (status='present') é o
  -- que libera a prova. Quando nula, fallback para a busca por
  -- janela temporal (provas legadas).
  attendance_session_id   uuid REFERENCES public.attendance_sessions(id) ON DELETE SET NULL,

  max_attempts          integer NOT NULL DEFAULT 1 CHECK (max_attempts >= 1),
  proctoring_enabled    boolean NOT NULL DEFAULT false,
  tab_switch_limit      integer,
  allow_resume          boolean NOT NULL DEFAULT true,

  config                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT online_exams_window_chk
    CHECK (closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at)
);

CREATE INDEX IF NOT EXISTS idx_online_exams_discipline
  ON public.online_exams (discipline_id);
CREATE INDEX IF NOT EXISTS idx_online_exams_assessment
  ON public.online_exams (assessment_id);
CREATE INDEX IF NOT EXISTS idx_online_exams_status
  ON public.online_exams (status);
CREATE INDEX IF NOT EXISTS idx_online_exams_open_window
  ON public.online_exams (opens_at, closes_at)
  WHERE status IN ('scheduled','open');
CREATE INDEX IF NOT EXISTS idx_online_exams_attendance_session
  ON public.online_exams (attendance_session_id)
  WHERE attendance_session_id IS NOT NULL;

-- Defesa: se a tabela ja existia (sem a coluna nova), garante
-- que attendance_session_id existe antes de qualquer policy ou
-- funcao que a referencia.
-- (Ja adicionada na secao 0.5. Aqui garantimos a FK constraint
-- porque agora public.attendance_sessions ja existe.)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'online_exams_attendance_session_id_fkey'
      AND conrelid = 'public.online_exams'::regclass
  ) THEN
    ALTER TABLE public.online_exams
      ADD CONSTRAINT online_exams_attendance_session_id_fkey
      FOREIGN KEY (attendance_session_id)
      REFERENCES public.attendance_sessions(id)
      ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_online_exams_attendance_session
  ON public.online_exams (attendance_session_id)
  WHERE attendance_session_id IS NOT NULL;


-- ============================================================
-- 16. public.exam_sessions (PROVAS ONLINE)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.exam_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id           uuid NOT NULL REFERENCES public.online_exams(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attempt_number    integer NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  status            public.exam_session_status NOT NULL DEFAULT 'not_started',

  access_token      text NOT NULL UNIQUE
                    DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),

  started_at        timestamptz,
  last_activity_at  timestamptz,
  submitted_at      timestamptz,
  graded_at         timestamptz,
  expires_at        timestamptz,

  tab_switches      integer NOT NULL DEFAULT 0,
  fullscreen_exits  integer NOT NULL DEFAULT 0,
  focus_lost_count  integer NOT NULL DEFAULT 0,
  integrity_flags   jsonb NOT NULL DEFAULT '{}'::jsonb,
  identity_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  score             numeric,
  final_feedback    text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT exam_sessions_unique_attempt UNIQUE (exam_id, student_id, attempt_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS exam_sessions_one_active_per_student
  ON public.exam_sessions (exam_id, student_id)
  WHERE status IN ('not_started','in_progress');
CREATE INDEX IF NOT EXISTS idx_exam_sessions_student
  ON public.exam_sessions (student_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_exam
  ON public.exam_sessions (exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_status
  ON public.exam_sessions (status);


-- ============================================================
-- 17. public.exam_answers (PROVAS ONLINE)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.exam_answers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  question_id       uuid NOT NULL REFERENCES public.assessment_questions(id) ON DELETE CASCADE,

  answer            jsonb,
  is_blank          boolean NOT NULL DEFAULT true,
  flagged           boolean NOT NULL DEFAULT false,
  points_awarded    numeric,
  max_points        numeric,
  is_correct        boolean,
  auto_score        numeric,
  manual_score      numeric,
  grader_comment    text,
  answered_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT exam_answers_unique_per_question UNIQUE (session_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_answers_session
  ON public.exam_answers (session_id);
CREATE INDEX IF NOT EXISTS idx_exam_answers_question
  ON public.exam_answers (question_id);


-- ============================================================
-- 18. FUNCOES AUXILIARES
-- ============================================================

-- 18.1 Trigger helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 18.2 has_role (SECURITY DEFINER, checa em user_roles)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 18.3 current_institution_id
CREATE OR REPLACE FUNCTION public.current_institution_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT institution_id FROM public.profiles WHERE id = auth.uid()
$$;

-- 18.4 handle_new_user (cria profile+role ao signup)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.profile_type;
  v_name TEXT;
  v_enrollment TEXT;
BEGIN
  v_type := COALESCE((NEW.raw_user_meta_data->>'profile_type')::public.profile_type, 'student');
  v_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.email, '');
  v_enrollment := NEW.raw_user_meta_data->>'enrollment_number';

  INSERT INTO public.profiles (id, name, email, enrollment_number, profile_type, password_set)
  VALUES (NEW.id, v_name, NEW.email, v_enrollment, v_type, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_type::text::public.app_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 18.5 reserve_assessment_control (gera numero de controle MM+NNNN+YY)
CREATE OR REPLACE FUNCTION public.reserve_assessment_control(
  _discipline_id uuid,
  _module_name text,
  _issued_at timestamptz DEFAULT now()
)
RETURNS TABLE(control_sequence integer, control_number text, control_year integer, control_scope_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_institution_id uuid;
  v_year integer := EXTRACT(YEAR FROM _issued_at)::integer;
  v_month text := to_char(_issued_at, 'MM');
  v_yy text := to_char(_issued_at, 'YY');
  v_module text := lower(regexp_replace(coalesce(nullif(trim(_module_name), ''), 'sem-modulo'), '\s+', ' ', 'g'));
  v_scope text;
  v_seq integer;
  v_number text;
  v_guard integer := 0;
BEGIN
  SELECT d.institution_id INTO v_institution_id
    FROM public.disciplines d WHERE d.id = _discipline_id;

  v_scope := concat_ws(':', coalesce(v_institution_id::text, 'sem-instituicao'),
                              _discipline_id::text, md5(v_module));

  PERFORM pg_advisory_xact_lock(hashtext(v_scope), v_year);

  INSERT INTO public.assessment_control_counters(scope_key, control_year, next_sequence)
  VALUES (v_scope, v_year, 1)
  ON CONFLICT (scope_key, control_year) DO NOTHING;

  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 10000 THEN
      RAISE EXCEPTION 'ASSESSMENT_CONTROL_EXHAUSTED: nao foi possivel reservar numero de avaliacao unico';
    END IF;

    UPDATE public.assessment_control_counters
       SET next_sequence = next_sequence + 1, updated_at = now()
     WHERE scope_key = v_scope AND control_year = v_year
     RETURNING next_sequence - 1 INTO v_seq;

    v_number := v_month || lpad(v_seq::text, 4, '0') || v_yy;

    IF NOT EXISTS (
      SELECT 1 FROM public.assessments a WHERE a.control_number = v_number
    ) THEN
      control_sequence := v_seq;
      control_number := v_number;
      control_year := v_year;
      control_scope_key := v_scope;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) TO service_role;

-- 18.6 is_exam_owner / can_view_exam_session (autorizacao para online_exams)
CREATE OR REPLACE FUNCTION public.is_exam_owner(_session_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.exam_sessions s
    WHERE s.id = _session_id AND s.student_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.can_view_exam_session(_session_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exam_sessions s
    JOIN public.online_exams e ON e.id = s.exam_id
    WHERE s.id = _session_id
      AND (
        s.student_id = _user_id
        OR EXISTS (SELECT 1 FROM public.disciplines d
                   WHERE d.id = e.discipline_id AND d.teacher_id = _user_id)
        OR public.has_role(_user_id, 'admin'::public.app_role)
      )
  )
$$;

REVOKE ALL ON FUNCTION public.is_exam_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_exam_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_exam_owner(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_exam_session(uuid, uuid) TO authenticated, service_role;

-- 18.7 discipline_institution_id (helper usado em algumas policies)
CREATE OR REPLACE FUNCTION public.discipline_institution_id(_discipline_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT institution_id FROM public.disciplines WHERE id = _discipline_id
$$;

GRANT EXECUTE ON FUNCTION public.discipline_institution_id(uuid) TO authenticated, service_role;


-- ============================================================
-- 19. TRIGGERS DE updated_at
-- ============================================================

-- Tabelas com updated_at
DROP TRIGGER IF EXISTS trg_disciplines_updated_at ON public.disciplines;
CREATE TRIGGER trg_disciplines_updated_at BEFORE UPDATE ON public.disciplines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_attendance_sessions_updated_at ON public.attendance_sessions;
CREATE TRIGGER trg_attendance_sessions_updated_at BEFORE UPDATE ON public.attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_attendance_records_updated_at ON public.attendance_records;
CREATE TRIGGER trg_attendance_records_updated_at BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_assessments_updated ON public.assessments;
CREATE TRIGGER trg_assessments_updated BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_assessment_questions_updated ON public.assessment_questions;
CREATE TRIGGER trg_assessment_questions_updated BEFORE UPDATE ON public.assessment_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_assessment_versions_updated ON public.assessment_versions;
CREATE TRIGGER trg_assessment_versions_updated BEFORE UPDATE ON public.assessment_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_assessment_assignments_updated ON public.assessment_assignments;
CREATE TRIGGER trg_assessment_assignments_updated BEFORE UPDATE ON public.assessment_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_assessment_submissions_updated ON public.assessment_submissions;
CREATE TRIGGER trg_assessment_submissions_updated BEFORE UPDATE ON public.assessment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_assessment_question_audits_updated ON public.assessment_question_audits;
CREATE TRIGGER trg_assessment_question_audits_updated BEFORE UPDATE ON public.assessment_question_audits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_online_exams_updated_at ON public.online_exams;
CREATE TRIGGER trg_online_exams_updated_at BEFORE UPDATE ON public.online_exams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_exam_sessions_updated_at ON public.exam_sessions;
CREATE TRIGGER trg_exam_sessions_updated_at BEFORE UPDATE ON public.exam_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_exam_answers_updated_at ON public.exam_answers;
CREATE TRIGGER trg_exam_answers_updated_at BEFORE UPDATE ON public.exam_answers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ============================================================
-- 20. GRANTS
-- ============================================================

-- BASELINE
GRANT SELECT, INSERT, UPDATE, DELETE ON public.institutions         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.disciplines         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records  TO authenticated;

-- AVALIAÇÕES
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessments                 TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_questions       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_versions        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_assignments     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_submissions     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_question_audits TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.assessment_control_counters TO authenticated;

-- PROVAS ONLINE
GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_exams   TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.exam_sessions  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_answers    TO authenticated;

-- service_role
GRANT ALL ON public.institutions, public.profiles, public.user_roles,
  public.disciplines, public.discipline_students,
  public.attendance_sessions, public.attendance_records,
  public.assessments, public.assessment_questions, public.assessment_versions,
  public.assessment_assignments, public.assessment_submissions,
  public.assessment_question_audits, public.assessment_control_counters,
  public.online_exams, public.exam_sessions, public.exam_answers
  TO service_role;

REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.disciplines FROM anon;
REVOKE SELECT ON public.assessments FROM anon;


-- ============================================================
-- 21. RLS — BASELINE (institutions / profiles / user_roles / disciplines)
-- ============================================================

ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_students ENABLE ROW LEVEL SECURITY;

-- institutions
DROP POLICY IF EXISTS "Admins manage institutions" ON public.institutions;
CREATE POLICY "Admins manage institutions" ON public.institutions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Institution sees itself" ON public.institutions;
CREATE POLICY "Institution sees itself" ON public.institutions
  FOR SELECT TO authenticated
  USING (id = public.current_institution_id());

DROP POLICY IF EXISTS "Teachers see their institution" ON public.institutions;
CREATE POLICY "Teachers see their institution" ON public.institutions
  FOR SELECT TO authenticated
  USING (id = public.current_institution_id());

-- profiles
DROP POLICY IF EXISTS "Users see their own profile" ON public.profiles;
CREATE POLICY "Users see their own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "Admins see all profiles" ON public.profiles;
CREATE POLICY "Admins see all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Institutions see profiles in their institution" ON public.profiles;
CREATE POLICY "Institutions see profiles in their institution" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'institution')
         AND institution_id = public.current_institution_id());

DROP POLICY IF EXISTS "Teachers see students in their disciplines" ON public.profiles;
CREATE POLICY "Teachers see students in their disciplines" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'teacher')
         AND EXISTS (
           SELECT 1 FROM public.discipline_students ds
           JOIN public.disciplines d ON d.id = ds.discipline_id
           WHERE ds.student_id = profiles.id AND d.teacher_id = auth.uid()
         ));

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "Admins update profiles" ON public.profiles;
CREATE POLICY "Admins update profiles" ON public.profiles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins insert profiles" ON public.profiles;
CREATE POLICY "Admins insert profiles" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins delete profiles" ON public.profiles;
CREATE POLICY "Admins delete profiles" ON public.profiles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- user_roles
DROP POLICY IF EXISTS "Users see own roles" ON public.user_roles;
CREATE POLICY "Users see own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage all roles" ON public.user_roles;
CREATE POLICY "Admins manage all roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- disciplines
DROP POLICY IF EXISTS "Admins manage disciplines" ON public.disciplines;
CREATE POLICY "Admins manage disciplines" ON public.disciplines
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Teachers manage own disciplines" ON public.disciplines;
CREATE POLICY "Teachers manage own disciplines" ON public.disciplines
  FOR ALL TO authenticated
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Institutions see their disciplines" ON public.disciplines;
CREATE POLICY "Institutions see their disciplines" ON public.disciplines
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'institution')
         AND institution_id = public.current_institution_id());

DROP POLICY IF EXISTS "Students see enrolled disciplines" ON public.disciplines;
CREATE POLICY "Students see enrolled disciplines" ON public.disciplines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.discipline_students ds
                  WHERE ds.discipline_id = disciplines.id
                    AND ds.student_id = auth.uid()));

-- discipline_students
DROP POLICY IF EXISTS "Admins manage enrollments" ON public.discipline_students;
CREATE POLICY "Admins manage enrollments" ON public.discipline_students
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Teachers manage enrollments in own disciplines" ON public.discipline_students;
CREATE POLICY "Teachers manage enrollments in own disciplines" ON public.discipline_students
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.disciplines d
                 WHERE d.id = discipline_id AND d.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d
                      WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

DROP POLICY IF EXISTS "Students see own enrollments" ON public.discipline_students;
CREATE POLICY "Students see own enrollments" ON public.discipline_students
  FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Institutions see enrollments" ON public.discipline_students;
CREATE POLICY "Institutions see enrollments" ON public.discipline_students
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.disciplines d
                 WHERE d.id = discipline_id
                   AND d.institution_id = public.current_institution_id()));


-- ============================================================
-- 22. RLS — BASELINE (attendance_sessions / attendance_records)
-- ============================================================

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

-- attendance_sessions
DROP POLICY IF EXISTS "Teachers manage own attendance sessions" ON public.attendance_sessions;
CREATE POLICY "Teachers manage own attendance sessions" ON public.attendance_sessions
  FOR ALL TO authenticated
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Students see sessions in enrolled disciplines" ON public.attendance_sessions;
CREATE POLICY "Students see sessions in enrolled disciplines" ON public.attendance_sessions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.discipline_students ds
                 WHERE ds.discipline_id = attendance_sessions.discipline_id
                   AND ds.student_id = auth.uid()));

DROP POLICY IF EXISTS "Admins manage all attendance sessions" ON public.attendance_sessions;
CREATE POLICY "Admins manage all attendance sessions" ON public.attendance_sessions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Institutions see attendance sessions" ON public.attendance_sessions;
CREATE POLICY "Institutions see attendance sessions" ON public.attendance_sessions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.disciplines d
                 WHERE d.id = discipline_id
                   AND d.institution_id = public.current_institution_id()));

-- attendance_records
DROP POLICY IF EXISTS "Students manage own attendance" ON public.attendance_records;
CREATE POLICY "Students manage own attendance" ON public.attendance_records
  FOR ALL TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "Teachers see attendance in own disciplines" ON public.attendance_records;
CREATE POLICY "Teachers see attendance in own disciplines" ON public.attendance_records
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.attendance_sessions a
                 JOIN public.disciplines d ON d.id = a.discipline_id
                 WHERE a.id = attendance_records.session_id
                   AND d.teacher_id = auth.uid()));

DROP POLICY IF EXISTS "Admins manage all attendance records" ON public.attendance_records;
CREATE POLICY "Admins manage all attendance records" ON public.attendance_records
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- ============================================================
-- 23. RLS — AVALIAÇÕES (assessments + filhas)
-- ============================================================

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_question_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_control_counters ENABLE ROW LEVEL SECURITY;

-- assessments
DROP POLICY IF EXISTS "Admins manage assessments" ON public.assessments;
CREATE POLICY "Admins manage assessments" ON public.assessments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Teachers manage own assessments" ON public.assessments;
CREATE POLICY "Teachers manage own assessments" ON public.assessments
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Students see assessments of their disciplines" ON public.assessments;
CREATE POLICY "Students see assessments of their disciplines" ON public.assessments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.discipline_students ds
                 WHERE ds.discipline_id = assessments.discipline_id
                   AND ds.student_id = auth.uid()));

-- assessment_questions
DROP POLICY IF EXISTS "Admins manage aq" ON public.assessment_questions;
CREATE POLICY "Admins manage aq" ON public.assessment_questions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Teachers manage aq" ON public.assessment_questions;
CREATE POLICY "Teachers manage aq" ON public.assessment_questions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assessments a
                 WHERE a.id = assessment_id AND a.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assessments a
                      WHERE a.id = assessment_id AND a.created_by = auth.uid()));

DROP POLICY IF EXISTS "Students see own discipline questions" ON public.assessment_questions;
CREATE POLICY "Students see own discipline questions" ON public.assessment_questions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assessments a
                 JOIN public.discipline_students ds ON ds.discipline_id = a.discipline_id
                 WHERE a.id = assessment_id AND ds.student_id = auth.uid()));

-- assessment_versions
DROP POLICY IF EXISTS "Admins manage av" ON public.assessment_versions;
CREATE POLICY "Admins manage av" ON public.assessment_versions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Teachers manage av" ON public.assessment_versions;
CREATE POLICY "Teachers manage av" ON public.assessment_versions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assessments a
                 WHERE a.id = assessment_id AND a.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assessments a
                      WHERE a.id = assessment_id AND a.created_by = auth.uid()));

-- assessment_assignments
DROP POLICY IF EXISTS "Admins manage aa" ON public.assessment_assignments;
CREATE POLICY "Admins manage aa" ON public.assessment_assignments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Teachers manage aa" ON public.assessment_assignments;
CREATE POLICY "Teachers manage aa" ON public.assessment_assignments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assessments a
                 WHERE a.id = assessment_id AND a.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assessments a
                      WHERE a.id = assessment_id AND a.created_by = auth.uid()));

DROP POLICY IF EXISTS "Students see own assignment" ON public.assessment_assignments;
CREATE POLICY "Students see own assignment" ON public.assessment_assignments
  FOR SELECT TO authenticated USING (student_id = auth.uid());

-- assessment_submissions
DROP POLICY IF EXISTS "Admins manage asub" ON public.assessment_submissions;
CREATE POLICY "Admins manage asub" ON public.assessment_submissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Teachers manage asub" ON public.assessment_submissions;
CREATE POLICY "Teachers manage asub" ON public.assessment_submissions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assessment_assignments aa
                 WHERE aa.id = assignment_id
                   AND EXISTS (SELECT 1 FROM public.assessments a
                               WHERE a.id = aa.assessment_id
                                 AND a.created_by = auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assessment_assignments aa
                      WHERE aa.id = assignment_id
                        AND EXISTS (SELECT 1 FROM public.assessments a
                                    WHERE a.id = aa.assessment_id
                                      AND a.created_by = auth.uid())));

DROP POLICY IF EXISTS "Students see own posted submission" ON public.assessment_submissions;
CREATE POLICY "Students see own posted submission" ON public.assessment_submissions
  FOR SELECT TO authenticated
  USING (status = 'posted'
         AND EXISTS (SELECT 1 FROM public.assessment_assignments aa
                     WHERE aa.id = assignment_id AND aa.student_id = auth.uid()));

-- assessment_question_audits
DROP POLICY IF EXISTS "Admins manage audits" ON public.assessment_question_audits;
CREATE POLICY "Admins manage audits" ON public.assessment_question_audits
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Teachers read own assessment audits" ON public.assessment_question_audits;
CREATE POLICY "Teachers read own assessment audits" ON public.assessment_question_audits
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assessments a
                 WHERE a.id = assessment_id
                   AND (a.created_by = auth.uid()
                        OR public.has_role(auth.uid(), 'admin'))));

-- assessment_control_counters
DROP POLICY IF EXISTS "Admins manage assessment counters" ON public.assessment_control_counters;
CREATE POLICY "Admins manage assessment counters" ON public.assessment_control_counters
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated read counters" ON public.assessment_control_counters;
CREATE POLICY "Authenticated read counters" ON public.assessment_control_counters
  FOR SELECT TO authenticated USING (true);


-- ============================================================
-- 24. RLS — PROVAS ONLINE (online_exams / exam_sessions / exam_answers)
-- ============================================================

ALTER TABLE public.online_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_answers ENABLE ROW LEVEL SECURITY;

-- online_exams
DROP POLICY IF EXISTS online_exams_admin_all ON public.online_exams;
CREATE POLICY online_exams_admin_all ON public.online_exams
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS online_exams_teacher_manage ON public.online_exams;
CREATE POLICY online_exams_teacher_manage ON public.online_exams
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.disciplines d
                 WHERE d.id = discipline_id AND d.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d
                      WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

DROP POLICY IF EXISTS online_exams_student_read ON public.online_exams;
CREATE POLICY online_exams_student_read ON public.online_exams
  FOR SELECT TO authenticated
  USING (status IN ('open','closed')
         AND EXISTS (SELECT 1 FROM public.discipline_students ds
                     WHERE ds.discipline_id = online_exams.discipline_id
                       AND ds.student_id = auth.uid()));

-- exam_sessions
DROP POLICY IF EXISTS exam_sessions_student_all ON public.exam_sessions;
CREATE POLICY exam_sessions_student_all ON public.exam_sessions
  FOR ALL TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS exam_sessions_teacher_read ON public.exam_sessions;
CREATE POLICY exam_sessions_teacher_read ON public.exam_sessions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.online_exams e
                 JOIN public.disciplines d ON d.id = e.discipline_id
                 WHERE e.id = exam_sessions.exam_id
                   AND d.teacher_id = auth.uid()));

DROP POLICY IF EXISTS exam_sessions_admin_all ON public.exam_sessions;
CREATE POLICY exam_sessions_admin_all ON public.exam_sessions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- exam_answers
DROP POLICY IF EXISTS exam_answers_student_all ON public.exam_answers;
CREATE POLICY exam_answers_student_all ON public.exam_answers
  FOR ALL TO authenticated
  USING (public.is_exam_owner(session_id, auth.uid()))
  WITH CHECK (public.is_exam_owner(session_id, auth.uid()));

DROP POLICY IF EXISTS exam_answers_grader_read ON public.exam_answers;
CREATE POLICY exam_answers_grader_read ON public.exam_answers
  FOR SELECT TO authenticated
  USING (public.can_view_exam_session(session_id, auth.uid()));

DROP POLICY IF EXISTS exam_answers_grader_update ON public.exam_answers;
CREATE POLICY exam_answers_grader_update ON public.exam_answers
  FOR UPDATE TO authenticated
  USING (public.can_view_exam_session(session_id, auth.uid()))
  WITH CHECK (public.can_view_exam_session(session_id, auth.uid()));


-- =============================================================
-- FIM.
-- Apos rodar este arquivo com sucesso, execute no SQL Editor:
--
--   NOTIFY pgrst, 'reload schema';
--
-- (uma unica linha)
-- =============================================================
