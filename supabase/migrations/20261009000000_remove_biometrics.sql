-- =============================================================================
-- REMOÇÃO DA BIOMETRIA (decisão de Produto)
--
-- OBJETIVO
--   Remover do schema todos os objetos ligados à feature de biometria
--   que está sendo removida da V2: tabelas, colunas em online_exams,
--   enum, funções e trigger. Preserva a regra de negócio atual
--   (liberação da sala via Diário Digital / attendance_session_id).
--
-- DECISÕES DE PROJETO QUE MOTIVAM ESTA MIGRATION
--   * Biometria em pausa (2026-10) e, em seguida, removida do produto.
--   * A migration 20261008120000_create_online_exams_tables.sql
--     mantém as 3 colunas biometric_* em online_exams "por compat"
--     (online_exams.biometric_required, biometric_kind_required,
--      require_face_match). Esta migration encerra esse período de
--     compat.
--   * A migration canônica 0812 NÃO cria exam_sessions.biometric_*,
--     nem a FK de biometric_ref para user_biometrics, nem o enum
--     biometric_verify_result. Esses objetos só existem se 0512
--     (e/ou 0513) também tiverem sido aplicadas.
--   * Origem dos enums (confirmado nas migrations locais):
--       - public.biometric_kind            : criado por 0512 E por 0812
--                                            (existe em A, B, C; ausente em D)
--       - public.biometric_verify_result   : criado apenas por 0512
--                                            (existe em A, B; ausente em C, D)
--   * public.biometric_audit_log é criado apenas por 0513
--     (existe só em B; ausente em A, C, D).
--
-- CONDIÇÕES DE SEGURANÇA (verificar ANTES de aplicar)
--   1. Confirmar que nenhum objeto no BANCO ainda depende das funções
--      public.user_can_use_biometrics,
--      public.student_has_active_biometrics,
--      public.my_biometric_enrollments ou
--      public.guard_biometric_identity. Códigos candidatos no
--      servidor de banco: outras funções SQL/plpgsql, views,
--      triggers, policies RLS (expressões USING/WITH CHECK),
--      defaults de coluna, jobs/agentes, e funções SECURITY
--      DEFINER de outros schemas.
--      A remoção no frontend V2 (online-exams.functions.ts e
--      migration-audit.txt) cobre apenas chamadas do front; NÃO
--      serve como evidência de ausência de dependências no banco.
--      A própria migration faz DROP FUNCTION dessas quatro no
--      passo 2, o que confirma que ao menos o caminho de remoção
--      do schema já as considera removíveis.
--   2. Confirmar o tipo e as FKs das colunas biométricas em
--      public.exam_sessions NO BANCO REAL antes de aplicar.
--      Conforme a migration 20261005120000_online_exams_biometrics.sql
--      (cenários A e B), as três colunas são:
--         biometric_status       public.biometric_verify_result
--                                 (enum, default 'pending')
--         biometric_match_score  numeric(5,2)        (0..100)
--         biometric_ref          uuid REFERENCES
--                                 public.user_biometrics(id)
--                                 ON DELETE SET NULL
--      Portanto biometric_ref é uma FK para user_biometrics.id e
--      é uuid, não text. A justificativa para remover biometric_ref
--      ANTES de dropar public.user_biometrics (passo 3 seguido do
--      passo 4) é eliminar essa FK referenciadora; sem isso, o
--      DROP TABLE de user_biometrics falharia.
--      Esta checagem só faz sentido se public.exam_sessions existir
--      E se public.user_biometrics existir (a FK só existe nos
--      cenários A e B; em C e D não há o que verificar).
--      ANTES de executar a consulta, o DBA deve confirmar
--      previamente a existência de cada objeto:
--         SELECT to_regclass('public.exam_sessions')   IS NOT NULL
--            AND to_regclass('public.user_biometrics') IS NOT NULL;
--      Só rodar a query abaixo se o resultado for TRUE; caso
--      contrário (C, D, ou estado divergente), pular:
--         SELECT conname, conrelid::regclass, pg_get_constraintdef(oid)
--         FROM pg_constraint
--         WHERE conrelid = 'public.exam_sessions'::regclass
--           AND contype = 'f'
--           AND pg_get_constraintdef(oid) ILIKE '%user_biometrics%';
--      O cast ::regclass acima também exige que
--      public.exam_sessions exista; não executar se ausente.
--   3. Confirmar os privilégios (grants) nas tabelas biométricas
--      no banco real. Esta checagem só faz sentido se as tabelas
--      existirem. Conforme as migrations locais:
--         - public.user_biometrics     : criado por 0512 (A, B)
--         - public.biometric_audit_log : criado por 0513 (apenas B)
--      Antes de executar a consulta, o DBA deve confirmar a
--      existência de cada tabela.
--      ATENÇÃO: a query em information_schema.role_table_grants
--      lista privilégios concedidos a roles nomeados, mas NÃO é,
--      por si só, prova completa de privilégios efetivos. Em
--      particular, ela não cobre com segurança os privilégios
--      herdados do PUBLIC nem privilégios default concedidos a
--      roles amplos. Resultado "vazio" nessa view NÃO prova
--      ausência de grants para PUBLIC; a verificação dos
--      privilégios efetivos (incluindo PUBLIC) e a interpretação
--      ficam a cargo do DBA. Se não for possível confirmar uma
--      consulta completa, o método de verificação é decisão do
--      DBA.
--      Modelo sugerido (executar somente se AMBAS as tabelas
--      existirem; ajustar o IN conforme o caso):
--         SELECT grantee, table_schema, table_name, privilege_type
--         FROM information_schema.role_table_grants
--         WHERE table_schema = 'public'
--           AND table_name IN ('user_biometrics', 'biometric_audit_log')
--           AND grantee NOT IN ('service_role', 'postgres');
--      Se user_biometrics existir mas biometric_audit_log não
--      (cenário A): restringir a query a user_biometrics apenas.
--      Se nenhuma das duas existir (C, D): pular.
--   4. Se houver dados em exam_sessions.biometric_status,
--      biometric_match_score ou biometric_ref que precisem ser
--      preservados (apenas cenários A e B, onde essas colunas
--      existem), o DBA deve providenciar backup ANTES de aplicar
--      esta migration. A migration não executa backup internamente;
--      isto é responsabilidade do DBA.
--      O backup deve ser PERSISTENTE e ARMAZENADO FORA DA SESSÃO
--      (por exemplo: COPY para arquivo no storage do DBA, pg_dump
--      da tabela, ou COPY para um schema dedicado de auditoria
--      fora do escopo desta migration). Backup com CREATE TEMP
--      TABLE não é recomendado porque tabelas temporárias existem
--      apenas na sessão corrente e serão perdidas ao final dela.
--      Antes do backup, o DBA deve confirmar que
--      public.exam_sessions existe E que ao menos uma das três
--      colunas biométricas existe (cenário A e B). Em C e D,
--      pular — não há o que preservar.
--      Colunas confirmadas nas migrations locais para o backup
--      (existentes em A, B; ausentes em C, D): id (uuid),
--      biometric_status (enum), biometric_match_score (numeric),
--      biometric_ref (uuid), updated_at (timestamptz).
--   5. Antes de aplicar, o DBA deve confirmar que os enums
--      removidos no passo 6 não têm dependências externas ao
--      conjunto local de migrations. O cast ::regtype falha com
--      erro se o tipo não existir; ANTES de cada consulta, o DBA
--      deve confirmar a existência do enum e pular a verificação
--      se ausente.
--      Confirmação prévia (uma linha por enum, ambas devem retornar
--      TRUE para que a checagem de dependências faça sentido):
--         SELECT to_regtype('public.biometric_kind')          IS NOT NULL;
--         SELECT to_regtype('public.biometric_verify_result') IS NOT NULL;
--      Origem confirmada nas migrations locais:
--         - biometric_kind          : 0512 E 0812 (existe A, B, C;
--                                     ausente em D)
--         - biometric_verify_result : apenas 0512 (existe A, B;
--                                     ausente em C, D)
--      Só então, para cada enum que existir, executar:
--         SELECT 1 FROM pg_depend
--         WHERE refobjid = 'public.biometric_kind'::regtype;
--         -- e/ou:
--         SELECT 1 FROM pg_depend
--         WHERE refobjid = 'public.biometric_verify_result'::regtype;
--      IMPORTANTE: linhas retornadas por pg_depend precisam ser
--      CLASSIFICADAS pelo DBA. O resultado pode incluir
--      dependências internas do próprio PostgreSQL (catálogo,
--      dependências de tipo implícitas) que NÃO significam
--      automaticamente uma dependência externa impeditiva ao
--      DROP TYPE. A interpretação de cada linha retornada é
--      responsabilidade do DBA.
--      Se houver dependentes inesperados impeditivos, o DROP TYPE
--      desta migration falha com a transação revertida; ajustar
--      manualmente antes de reaplicar.
--
-- NÃO USA DROP ... CASCADE: cada DROP é explícito. Os dois enums
-- (public.biometric_kind e public.biometric_verify_result) são
-- removidos via DROP TYPE sem CASCADE — após o DROP das colunas
-- que os referenciam nos passos 3 e 5, eles não têm mais
-- dependentes esperados. Se o DBA encontrar dependentes
-- inesperados na checagem do item 5 acima, o DROP TYPE falha
-- com a transação revertida.
--
-- IDEMPOTENTE: cada DROP é IF EXISTS; cada DROP COLUMN é IF EXISTS;
-- os ALTER TABLE sensíveis à existência da tabela são protegidos por
-- blocos DO com to_regclass. A migration é segura para os cenários:
--   A) só 20261005120000 aplicada
--   B) 20261005120000 + 20261005130000 aplicadas
--   C) só a canônica 20261008120000 aplicada (sem 0512/0513)
--   D) nenhum objeto biométrico presente
-- =============================================================================

-- 1) Trigger da função guard_biometric_identity. Removido ANTES da
--    função para garantir que não fique trigger órfão. O IF EXISTS
--    do DROP TRIGGER só protege o nome do trigger; a tabela precisa
--    existir. Guarda via to_regclass para os cenários C e D em que
--    public.user_biometrics ainda não foi criada.
DO $$
BEGIN
  IF to_regclass('public.user_biometrics') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_guard_biometric_identity ON public.user_biometrics;
  END IF;
END $$;

-- 2) Funções. guard_biometric_identity é dropada primeiro (logo após
--    o trigger que a segurava) para preservar a ordem trigger →
--    função. As outras três funções não dependem de trigger nem entre
--    si; a ordem entre elas é por simetria com o header.
DROP FUNCTION IF EXISTS public.guard_biometric_identity();
DROP FUNCTION IF EXISTS public.user_can_use_biometrics(uuid);
DROP FUNCTION IF EXISTS public.student_has_active_biometrics(uuid);
DROP FUNCTION IF EXISTS public.my_biometric_enrollments();

-- 3) Colunas biométricas de exam_sessions. DEVEM sair antes de
--    user_biometrics para eliminar a FK biometric_ref que aponta
--    para user_biometrics.id (uuid, ON DELETE SET NULL), herdada
--    da migration 0512. Sem essa ordem, o DROP TABLE do passo 4
--    falharia por dependência.
--    biometric_status referencia o enum biometric_verify_result,
--    removido no passo 6; remover a coluna antes do DROP TYPE.
--    O bloco IF EXISTS sobre a tabela cobre cenários em que
--    exam_sessions ainda não existe; o IF EXISTS sobre cada coluna
--    cobre o cenário C (canônica 0812 não cria essas colunas) e D.
--    Sem CASCADE.
DO $$
BEGIN
  IF to_regclass('public.exam_sessions') IS NOT NULL THEN
    ALTER TABLE public.exam_sessions DROP COLUMN IF EXISTS biometric_ref;
    ALTER TABLE public.exam_sessions DROP COLUMN IF EXISTS biometric_status;
    ALTER TABLE public.exam_sessions DROP COLUMN IF EXISTS biometric_match_score;
  END IF;
END $$;

-- 4) Tabelas (ordem: biometric_audit_log primeiro; depois
--    user_biometrics, já sem FK referenciadora após o passo 3).
DROP TABLE IF EXISTS public.biometric_audit_log;
DROP TABLE IF EXISTS public.user_biometrics;

-- 5) Colunas em public.online_exams. Mesma proteção via to_regclass
--    para cenários em que a tabela ainda não existe. A ordem das
--    colunas importa: biometric_kind_required referencia o enum
--    biometric_kind e deve sair antes do DROP TYPE no passo 6.
DO $$
BEGIN
  IF to_regclass('public.online_exams') IS NOT NULL THEN
    ALTER TABLE public.online_exams DROP COLUMN IF EXISTS biometric_kind_required;
    ALTER TABLE public.online_exams DROP COLUMN IF EXISTS biometric_required;
    ALTER TABLE public.online_exams DROP COLUMN IF EXISTS require_face_match;
  END IF;
END $$;

-- 6) Enums (sem CASCADE: as únicas referências esperadas eram as
--    colunas removidas nos passos 3 e 5). DROP TYPE
--    biometric_verify_result depende do DROP COLUMN biometric_status
--    no passo 3. DROP TYPE biometric_kind depende do DROP COLUMN
--    biometric_kind_required no passo 5. Se houver dependentes
--    inesperados impeditivos (ver item 5 do cabeçalho — linhas de
--    pg_depend precisam ser CLASSIFICADAS pelo DBA, pois podem
--    incluir dependências internas do PostgreSQL que não são
--    impeditivas), a transação é revertida; o DBA deve ajustar
--    manualmente.
DROP TYPE IF EXISTS public.biometric_kind;
DROP TYPE IF EXISTS public.biometric_verify_result;
