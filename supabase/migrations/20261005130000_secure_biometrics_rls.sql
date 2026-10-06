-- =============================================================
-- Biometria segura: server-side only
--
-- PROBLEMA QUE ESTA MIGRATION CORRIGE
-- A migration anterior concedeu SELECT/INSERT/UPDATE/DELETE sobre
-- public.user_biometrics para `authenticated`, e criou a policy
-- `user_biometrics_own` (USING user_id = auth.uid()). Isso permitia que
-- o proprio aluno, via Data API, lesse a propria linha INCLUDING
-- template_data -- o embedding/template facial -- e ainda inserisse
-- qualquer template sem passar por verificacao do servidor.
--
-- ARQUITETURA ALVO
-- O template biométrico NUNCA trafega para o cliente. O navegador do
-- aluno envia a captura; um backend com service_role processa, extrai o
-- embedding e grava. O cliente recebe apenas metadados de status
-- (existe? quando foi cadastrado?) através de funções SECURITY DEFINER
-- de leitura mínima.
--
-- Idempotente: pode ser executado mais de uma vez.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Corta o acesso direto do cliente à tabela
-- -------------------------------------------------------------
REVOKE ALL ON public.user_biometrics FROM anon, authenticated;

-- Defesa em profundidade: se alguém rodar GRANT SELECT depois,
-- estas colunas continuam inacessíveis ao role authenticated.
REVOKE SELECT (template_data, template_hash) ON public.user_biometrics FROM anon, authenticated;

-- -------------------------------------------------------------
-- 2. Remove as policies que vazavam o template
-- -------------------------------------------------------------
DROP POLICY IF EXISTS user_biometrics_own ON public.user_biometrics;
DROP POLICY IF EXISTS user_biometrics_teacher_read ON public.user_biometrics;
DROP POLICY IF EXISTS user_biometrics_admin_all ON public.user_biometrics;

-- Nenhuma policy para `authenticated` nesta tabela: com RLS ativo e
-- zero policies, todo acesso via anon/authenticated e negado.
-- service_role nao e afetado por RLS.

ALTER TABLE public.user_biometrics ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- 3. Leitura de metadados (sem template) via função SECURITY DEFINER
--    Retorna se o aluno tem biometria cadastrada, para a UI decidir
--    entre "cadastrar biometria" e "iniciar prova".
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_biometric_enrollments()
RETURNS TABLE (
  id           uuid,
  kind         public.biometric_kind,
  is_primary   boolean,
  is_active    boolean,
  quality_score numeric,
  enrolled_at  timestamptz,
  last_verified_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.kind, b.is_primary, b.is_active, b.quality_score,
         b.enrolled_at, b.last_verified_at
  FROM public.user_biometrics b
  WHERE b.user_id = auth.uid()
    AND b.is_active
  ORDER BY b.enrolled_at DESC;
$$;

REVOKE ALL ON FUNCTION public.my_biometric_enrollments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_biometric_enrollments() TO authenticated, service_role;

-- -------------------------------------------------------------
-- 4. Professor: só pode saber SE o aluno tem biometria ativa,
--    nunca ler o template. Ideal para bloquear a prova quando
--    a biometria é exigida.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_has_active_biometrics(_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.discipline_students ds
    JOIN public.disciplines d ON d.id = ds.discipline_id
    WHERE ds.student_id = _student_id
      AND (
        d.teacher_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      )
  )
  AND EXISTS (
    SELECT 1 FROM public.user_biometrics b
    WHERE b.user_id = _student_id AND b.is_active
  );
$$;

REVOKE ALL ON FUNCTION public.student_has_active_biometrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_has_active_biometrics(uuid) TO authenticated, service_role;

-- -------------------------------------------------------------
-- 5. Armadilha contra alteração de identidade
--    Impede que um usuário aponte um template biometrico para
--    outrem alterando user_id.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_biometric_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'user_id de biometria nao pode ser alterado';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_biometric_identity ON public.user_biometrics;
CREATE TRIGGER trg_guard_biometric_identity
  BEFORE UPDATE ON public.user_biometrics
  FOR EACH ROW EXECUTE FUNCTION public.guard_biometric_identity();

-- -------------------------------------------------------------
-- 6. Log de auditoria: toda verificação de biometria fica registrada
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.biometric_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  biometric_id   uuid REFERENCES public.user_biometrics(id) ON DELETE SET NULL,
  action         text NOT NULL,        -- 'enroll' | 'verify' | 'verify_failed' | 'delete'
  result         text,                 -- 'matched' | 'no_match' | 'skipped' | 'ok' | 'error'
  match_score    numeric(5,2),
  context        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biometric_audit_user
  ON public.biometric_audit_log (user_id, created_at DESC);

ALTER TABLE public.biometric_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.biometric_audit_log FROM anon, authenticated;
GRANT ALL ON public.biometric_audit_log TO service_role;

-- -------------------------------------------------------------
-- 7. Limpa o helper antigo (user_can_use_biometrics) que permitiria
--    qualquer um consultar a existencia de biometria de outro user.
-- -------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.user_can_use_biometrics(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_use_biometrics(uuid) TO service_role;

-- =============================================================
-- Fim. Recarregue o cache da API:
--   NOTIFY pgrst, 'reload schema';
-- =============================================================