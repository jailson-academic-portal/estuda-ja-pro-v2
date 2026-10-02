# Sanitização de Tópicos e Questões em Exercícios e Avaliações

## Objetivo
Eliminar termos genéricos ("Disciplina", "Módulo", "Gestão,?"), pontuação quebrada e prefixos duplicados ("A) A)") na geração de exercícios e avaliações, aplicando sanitização na entrada (tópicos injetados no prompt), nos prompts da IA e na saída (texto persistido das questões).

## 1. Novos helpers em `src/lib/text-sanitize.ts`
Estender o arquivo existente (que já tem `sanitizeConceptTopic`) com:

- **`sanitizeAssessmentTopic(rawTopic)`** — exatamente como especificado:
  - Remove pontuação/caracteres soltos no início e fim (`Gestão,?` → `Gestão`), colapsa espaços.
  - Bloqueia placeholders genéricos (`disciplina`, `módulo`, `matéria`, `assunto`, `conteúdo`, `sem-modulo`, `geral`, `tópico`, etc.) retornando `""` para forçar fallback ao conteúdo real da lição/apostila.
  - `sanitizeConceptTopic` existente passa a delegar para ele (ou coexistir) sem quebrar os usos atuais em `payload-prompt.server.ts`, `difficulty-guard.server.ts`, `assessments.functions.ts`, `ai-assistant-core.server.ts` e `AIAssistantModule.tsx`.

- **`sanitizeGeneratedQuestionText(text)`** — exatamente como especificado:
  - Remove espaço antes de pontuação (`termo ?` → `termo?`), vírgula colada em interrogação (`Gestão,?` → `Gestão?`), interrogações duplicadas, e faz trim.

- **`dedupeOptionPrefixes(text)`** — remove prefixos de alternativa redundantes/repetidos (ex: `A) A) Farmácia` → `Farmácia` ou `A) Farmácia`, conforme o formato usado nas opções), reutilizando a lógica de `stripOptionPrefix` já existente.

## 2. Sanitização na entrada dos prompts (geradores)
- **Exercícios** (`ai-assistant-core.server.ts`, system prompt `exercise_list` e pontos de montagem de prompt em `payload-prompt.server.ts` / `AIAssistantModule.tsx`): aplicar `sanitizeAssessmentTopic(topic)` antes de injetar o tópico no prompt; entradas que virarem `""` caem no fallback do conteúdo real da lição/apostila.
- **Avaliações** (`assessments.functions.ts`): aplicar `sanitizeAssessmentTopic` em `module_name` e nos títulos das lições (`lessons`/`topics`, incluindo o join em `TÓPICOS DO PLANO DE AULA` na linha ~551 e o conceito na linha ~1097).

## 3. Reforço nos system prompts (`ai-assistant-core.server.ts`)
- **`exercise_list`**: adicionar a regra — "PROIBIDO usar rótulos estruturais genéricos como 'Disciplina', 'Módulo' ou fragmentos com pontuação malformada (ex: 'Gestão,?'). Toda questão deve focar em fatos técnicos, mecanismos e conceitos aplicados."
- **`quiz`** (avaliações formais): adicionar — "O enunciado deve ser formal, direto e contextualizado. Elimine ruídos de OCR e pontuações quebradas no enunciado e nas alternativas."

## 4. Pós-processamento antes de persistir
- **Exercícios** — `saveExercise` em `src/backend/exercises.functions.ts` (linhas ~112-120): passar `prompt`, cada item de `options` e `explanation` por `sanitizeGeneratedQuestionText` + `dedupeOptionPrefixes` ao montar as linhas de `exercise_questions`.
- **Avaliações** — pipeline de questões em `src/backend/assessments.functions.ts` (a partir da linha ~1517) e nos inserts de `assessment_questions`: aplicar as mesmas sanitizações ao texto final de `prompt`, `options` e `explanation`, antes do replace de placeholders e do insert.

## 5. Verificação
- Typecheck (`tsgo`) e checagem de `build-errors.log`.
- Revisão visual de uma geração de exercício e de avaliação para confirmar ausência de `,?`, espaços antes de pontuação e prefixos duplicados.

## Arquivos tocados
- `src/lib/text-sanitize.ts` (novos helpers)
- `src/backend/ai-assistant-core.server.ts` (prompts + sanitização de entrada)
- `src/backend/generators/payload-prompt.server.ts` (sanitização de tópicos/lições)
- `src/backend/assessments.functions.ts` (entrada e pós-processamento)
- `src/backend/exercises.functions.ts` (pós-processamento no save)
- `src/components/discipline/AIAssistantModule.tsx` (sanitização de tópicos na montagem do payload)
