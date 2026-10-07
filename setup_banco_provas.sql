-- =============================================================
-- Avaliações Online (criação completa do zero)
--
-- Cria 3 tabelas + 3 enums + triggers + funções de autorização
-- + grants + policies RLS para o módulo de provas online.
--
-- Regra de negócio: a sala só é liberada se o aluno tiver PRESENÇA
-- confirmada no Diário Digital (attendance_records.status='present')
-- em uma aula (attendance_session) da mesma disciplina cuja starts_at
-- caia dentro da janela opens_at..closes_at da prova.
--
-- Tudo é idempotente (IF NOT EXISTS / DROP IF EXISTS) — pode ser
-- executado mais de uma vez sem erro. Após rodar este arquivo,
-- execute também o comando:
--
--   NOTIFY pgrst, 'reload schema';
--
-- para que o PostgREST atualize o cache do schema.
-- =============================================================

-- ============================================================
-- 0. ENUMS
-- ============================================================

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
-- 1. TABELA public.online_exams
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

  -- Colunas "dormant" da era biométrica (em pausa). Mantidas para não
  -- quebrar tipos no código legado; o servidor grava sempre false/null.
  biometric_required      boolean NOT NULL DEFAULT false,
  biometric_kind_required public.biometric_kind,
  require_face_match      boolean NOT NULL DEFAULT false,

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

-- ============================================================
-- 2. TABELA public.exam_sessions
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
-- 3. TABELA public.exam_answers
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
-- 4. TRIGGERS DE updated_at
-- ============================================================

DROP TRIGGER IF EXISTS trg_online_exams_updated_at ON public.online_exams;
CREATE TRIGGER trg_online_exams_updated_at
  BEFORE UPDATE ON public.online_exams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_exam_sessions_updated_at ON public.exam_sessions;
CREATE TRIGGER trg_exam_sessions_updated_at
  BEFORE UPDATE ON public.exam_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_exam_answers_updated_at ON public.exam_answers;
CREATE TRIGGER trg_exam_answers_updated_at
  BEFORE UPDATE ON public.exam_answers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 5. FUNÇÕES DE AUTORIZAÇÃO (SECURITY DEFINER, evitam recursão RLS)
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_exam_owner(_session_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exam_sessions s
    WHERE s.id = _session_id AND s.student_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_exam_session(_session_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.exam_sessions s
    JOIN public.online_exams e ON e.id = s.exam_id
    WHERE s.id = _session_id
      AND (
        s.student_id = _user_id
        OR public.is_discipline_teacher(e.discipline_id, _user_id)
        OR public.has_role(_user_id, 'admin'::public.app_role)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_exam_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_exam_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_exam_owner(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_exam_session(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 6. GRANTS
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_exams    TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.exam_sessions   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_answers     TO authenticated;
GRANT ALL ON public.online_exams    TO service_role;
GRANT ALL ON public.exam_sessions   TO service_role;
GRANT ALL ON public.exam_answers     TO service_role;

-- ============================================================
-- 7. RLS — public.online_exams
-- ============================================================

ALTER TABLE public.online_exams ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.online_exams FROM anon;

DROP POLICY IF EXISTS online_exams_teacher_manage ON public.online_exams;
CREATE POLICY online_exams_teacher_manage ON public.online_exams
  FOR ALL TO authenticated
  USING (public.is_discipline_teacher(discipline_id, auth.uid()))
  WITH CHECK (public.is_discipline_teacher(discipline_id, auth.uid()));

DROP POLICY IF EXISTS online_exams_student_read ON public.online_exams;
CREATE POLICY online_exams_student_read ON public.online_exams
  FOR SELECT TO authenticated
  USING (
    status IN ('open','closed')
    AND public.is_discipline_student(discipline_id, auth.uid())
  );

DROP POLICY IF EXISTS online_exams_admin_all ON public.online_exams;
CREATE POLICY online_exams_admin_all ON public.online_exams
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 8. RLS — public.exam_sessions
-- ============================================================

ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.exam_sessions FROM anon;

DROP POLICY IF EXISTS exam_sessions_student_all ON public.exam_sessions;
CREATE POLICY exam_sessions_student_all ON public.exam_sessions
  FOR ALL TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS exam_sessions_teacher_read ON public.exam_sessions;
CREATE POLICY exam_sessions_teacher_read ON public.exam_sessions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.online_exams e
      WHERE e.id = exam_sessions.exam_id
        AND public.is_discipline_teacher(e.discipline_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS exam_sessions_admin_all ON public.exam_sessions;
CREATE POLICY exam_sessions_admin_all ON public.exam_sessions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 9. RLS — public.exam_answers
-- ============================================================

ALTER TABLE public.exam_answers ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.exam_answers FROM anon;

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
-- Depois de rodar este arquivo com sucesso, execute o comando
-- abaixo no SQL Editor (uma única linha) para recarregar o cache
-- do PostgREST:
--
--   NOTIFY pgrst, 'reload schema';
-- =============================================================
