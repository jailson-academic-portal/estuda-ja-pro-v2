-- =============================================================
-- Rollback: Código de Presença
--
-- A feature de Código de Presença por prova foi substituída pela
-- integração com o Diário Digital (attendance_sessions / attendance_records).
-- O aluno só inicia a prova se a presença estiver marcada para a
-- aula correspondente — sem PIN isolado.
--
-- Esta migration desfaz as colunas adicionadas em
-- 20261007000000_online_exam_presence_code.sql, caso tenham sido
-- aplicadas. Idempotente: tudo via DROP IF EXISTS.
-- =============================================================

ALTER TABLE public.online_exams DROP CONSTRAINT IF EXISTS online_exams_presence_code_chk;

DROP INDEX IF EXISTS public.idx_online_exams_presence_code_required;

ALTER TABLE public.online_exams DROP COLUMN IF EXISTS presence_code_hash;
ALTER TABLE public.online_exams DROP COLUMN IF EXISTS presence_code_required;

-- =============================================================
-- Fim. Recarregue o cache da API do Supabase:
--   NOTIFY pgrst, 'reload schema';
-- =============================================================
