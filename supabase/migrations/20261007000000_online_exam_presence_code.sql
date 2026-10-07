-- =============================================================
-- Código de Presença para Avaliações Online
--
-- Substitui (na UI) a checagem biométrica por um PIN curto (4-6
-- caracteres) que o professor dita na lousa. A biometria é mantida
-- no banco (em pausa, não removida) e a UI deixa de oferecê-la.
--
-- O código NUNCA é gravado em texto puro: armazenamos apenas
-- SHA-256 hex do PIN. A comparação é constant-time no servidor.
-- =============================================================

-- 1) Colunas
ALTER TABLE public.online_exams
  ADD COLUMN IF NOT EXISTS presence_code_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.online_exams
  ADD COLUMN IF NOT EXISTS presence_code_hash text;

-- 2) CHECK: hash só pode existir se a feature estiver ligada
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'online_exams_presence_code_chk'
      AND conrelid = 'public.online_exams'::regclass
  ) THEN
    ALTER TABLE public.online_exams
      ADD CONSTRAINT online_exams_presence_code_chk
      CHECK (presence_code_hash IS NULL OR presence_code_required = true);
  END IF;
END $$;

-- 3) Indice auxiliar (filtrado) para localizar provas com código ativo
CREATE INDEX IF NOT EXISTS idx_online_exams_presence_code_required
  ON public.online_exams (id)
  WHERE presence_code_required = true;

-- 4) Grants inalterados (já cobertos pelas policies existentes).
--    Nenhuma policy nova é necessária: o hash é lido apenas por
--    server fns autenticadas que checam manualmente a permissão
--    (is_discipline_teacher / student enrollment).

-- =============================================================
-- Fim. Recarregue o cache da API do Supabase após aplicar:
--   NOTIFY pgrst, 'reload schema';
-- =============================================================
