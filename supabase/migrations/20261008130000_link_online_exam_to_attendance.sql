-- =============================================================
-- Vinculo explicito entre prova online e chamada do Diario Digital
--
-- Regra de negocio (2026-10):
--   O professor cria o Diario Digital (attendance_sessions) e
--   vincula a Prova Online a essa chamada especifica. A sala so
--   e liberada se o aluno registrou presenca (status='present')
--   NESTA chamada, via QR Code ou codigo de 6 letras.
--
--   Antes desta migration, a liberacao usava uma busca por
--   "qualquer chamada da disciplina dentro da janela da prova"
--   (presenca por contexto temporal). Agora a presenca e
--   vinculada por ID explicito.
--
--   Para provas antigas (sem attendance_session_id), a busca
--   por janela temporal continua valendo como fallback.
-- =============================================================

ALTER TABLE public.online_exams
  ADD COLUMN IF NOT EXISTS attendance_session_id uuid
  REFERENCES public.attendance_sessions(id) ON DELETE SET NULL;

-- Indice para o JOIN usado em getOnlineExamAccess
-- (LEFT JOIN attendance_sessions ar ON ar.id = oe.attendance_session_id)
CREATE INDEX IF NOT EXISTS idx_online_exams_attendance_session
  ON public.online_exams (attendance_session_id)
  WHERE attendance_session_id IS NOT NULL;

-- =============================================================
-- Fim. Recarregue o cache da API do Supabase apos aplicar:
--   NOTIFY pgrst, 'reload schema';
-- =============================================================
