-- =============================================================
-- UNIQUE em online_exams(assessment_id) + remocao da RPC legada
--
-- MOTIVO:
--   O frontend (saveOnlineExamConfig em online-exams.functions.ts)
--   estava chamando a RPC upsert_online_exam_config para tentar
--   escapar do erro "Could not find the function ... in the schema
--   cache" do PostgREST. O cache seguia quebrado mesmo apos reload
--   manual no Supabase. Decidido abandonar a RPC e voltar ao
--   upsert JS padrao do Supabase.
--
--   Para isso a tabela precisa de UNIQUE em assessment_id (uma
--   assessment so pode ter UMA prova online). O indice comum
--   idx_online_exams_assessment e substituido por um UNIQUE INDEX
--   com o mesmo nome para nao quebrar referencias.
--
-- O QUE ESTA MIGRATION FAZ:
--   1. Substitui o indice comum idx_online_exams_assessment por
--      um UNIQUE INDEX equivalente. A coluna ja tinha um indice
--      simples, entao o UNIQUE INDEX e construido sem custo extra
--      significativo (tabela de baixa cardinalidade).
--   2. Remove a funcao public.upsert_online_exam_config (19 args)
--      que o backend nao usa mais.
--   3. Recarrega o cache do PostgREST.
--
-- IDEMPOTENTE: pode rodar mais de uma vez sem efeito.
-- =============================================================

-- 1. UNIQUE em assessment_id
--    O indice antigo (nao-unique) precisa sair para que o
--    novo UNIQUE INDEX possa usar o mesmo nome. Usamos DROP IF
--    EXISTS para nao falhar em banco novo (onde idx_online_exams_assessment
--    nao foi criado separadamente porque ja vem UNIQUE na migration
--    inicial).
--
--    Defesa: se por algum motivo ja existem DUAS linhas para o
--    mesmo assessment_id (estado inconsistente legado), o
--    CREATE UNIQUE INDEX abaixo quebra. NAO apagamos as
--    duplicatas automaticamente (cada prova pode ter exam_sessions
--    e exam_answers vinculados via FK ON DELETE CASCADE — apaga-las
--    destruiria tentativas de alunos). Em vez disso, abortamos
--    com RAISE EXCEPTION e instruimos o operador a resolver
--    manualmente antes de aplicar esta migration.
DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT count(*) INTO v_dup_count
  FROM (
    SELECT assessment_id
    FROM public.online_exams
    GROUP BY assessment_id
    HAVING count(*) > 1
  ) d;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      '[uniq_online_exams_assessment] Existem % assessment_id com mais de uma prova online (linhas duplicadas). Resolva antes de rodar esta migration: apague manualmente as duplicadas (DELETE FROM public.online_exams WHERE id IN (...)) preservando a prova correta e suas exam_sessions/exam_answers. Em seguida reaplique esta migration.',
      v_dup_count
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

DROP INDEX IF EXISTS public.idx_online_exams_assessment;
CREATE UNIQUE INDEX IF NOT EXISTS idx_online_exams_assessment
  ON public.online_exams (assessment_id);

-- 2. Remove a RPC que o backend deixou de chamar
DROP FUNCTION IF EXISTS public.upsert_online_exam_config(
  uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  integer, numeric, integer, uuid, boolean, text, boolean, integer,
  boolean, jsonb, text
) CASCADE;

-- 3. Recarrega o cache de schema do PostgREST para que o cliente
--    Supabase enxergue a nova constraint e pare de reclamar.
NOTIFY pgrst, 'reload schema';
