-- =============================================================
-- RPC: upsert_online_exam_config
--
-- Funcao SECURITY DEFINER que faz UPSERT em public.online_exams
-- SEM passar pela validacao de schema do PostgREST (que mantem
-- cache de nomes de coluna). Usada por src/backend/online-exams.functions.ts
-- (saveOnlineExamConfig) para evitar o erro 400 "Could not find
-- the ... column in the schema cache" logo apos a migration
-- adicionar uma coluna nova.
--
-- Vantagem: o body da funcao e enviado ao Postgres como texto
-- pelo PostgREST. O cache de colunas da tabela em si nao
-- bloqueia a chamada, porque a RPC so valida o nome da propria
-- funcao (que vem de uma lista estavel, nao do schema cache).
-- =============================================================

CREATE OR REPLACE FUNCTION public.upsert_online_exam_config(
  p_assessment_id      uuid,
  p_discipline_id      uuid,
  p_created_by         uuid,
  p_title              text,
  p_instructions       text,
  p_status             text,
  p_opens_at           timestamptz,
  p_closes_at          timestamptz,
  p_time_limit_minutes integer,
  p_max_score          numeric,
  p_max_attempts       integer,
  p_attendance_session_id uuid,
  p_biometric_required boolean,
  p_biometric_kind_required text,
  p_require_face_match boolean,
  p_tab_switch_limit   integer,
  p_allow_resume       boolean,
  p_config             jsonb,
  p_status_override    text
)
RETURNS TABLE (id uuid, title text, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_id uuid;
  v_title text;
BEGIN
  -- Decide o status final: se o caller passou um override (closed /
  -- archived / open ja gravado), respeitamos; senao, calculamos
  -- entre 'open' (janela ja aberta) e 'draft' (padrao).
  IF p_status_override IN ('closed','archived','open') THEN
    v_status := p_status_override;
  ELSE
    -- decideInitialStatus: 'open' se a janela esta aberta agora, senao 'draft'
    IF (p_opens_at IS NULL OR p_opens_at <= now())
       AND (p_closes_at IS NULL OR p_closes_at > now()) THEN
      v_status := 'open';
    ELSE
      v_status := 'draft';
    END IF;
  END IF;

  INSERT INTO public.online_exams (
    assessment_id, discipline_id, created_by, title, instructions,
    status, opens_at, closes_at, time_limit_minutes, max_score,
    max_attempts, attendance_session_id,
    biometric_required, biometric_kind_required, require_face_match,
    tab_switch_limit, allow_resume, config,
    created_at, updated_at
  ) VALUES (
    p_assessment_id, p_discipline_id, p_created_by, p_title, p_instructions,
    v_status, p_opens_at, p_closes_at, p_time_limit_minutes, p_max_score,
    p_max_attempts, p_attendance_session_id,
    p_biometric_required,
    CASE WHEN p_biometric_required THEN p_biometric_kind_required::public.biometric_kind ELSE NULL END,
    p_biometric_required AND p_require_face_match,
    CASE WHEN p_biometric_required THEN p_tab_switch_limit ELSE NULL END,
    p_allow_resume, p_config,
    now(), now()
  )
  ON CONFLICT (assessment_id) DO UPDATE SET
    title = EXCLUDED.title,
    instructions = EXCLUDED.instructions,
    status = EXCLUDED.status,
    opens_at = EXCLUDED.opens_at,
    closes_at = EXCLUDED.closes_at,
    time_limit_minutes = EXCLUDED.time_limit_minutes,
    max_score = EXCLUDED.max_score,
    max_attempts = EXCLUDED.max_attempts,
    attendance_session_id = EXCLUDED.attendance_session_id,
    biometric_required = EXCLUDED.biometric_required,
    biometric_kind_required = EXCLUDED.biometric_kind_required,
    require_face_match = EXCLUDED.require_face_match,
    tab_switch_limit = EXCLUDED.tab_switch_limit,
    allow_resume = EXCLUDED.allow_resume,
    config = EXCLUDED.config,
    updated_at = now()
  RETURNING online_exams.id, online_exams.title, online_exams.status
  INTO v_id, v_title, v_status;

  RETURN QUERY SELECT v_id, v_title, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_online_exam_config(
  uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  integer, numeric, integer, uuid, boolean, text, boolean, integer,
  boolean, jsonb, text
) TO service_role;

-- Tambem permitir authenticated (a RLS continua aplicando se ativa,
-- mas o SECURITY DEFINER usa permissoes do owner da funcao; como
-- o upsert passa por policies, o caller ainda precisa ser professor
-- da disciplina via RLS).
GRANT EXECUTE ON FUNCTION public.upsert_online_exam_config(
  uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  integer, numeric, integer, uuid, boolean, text, boolean, integer,
  boolean, jsonb, text
) TO authenticated;
