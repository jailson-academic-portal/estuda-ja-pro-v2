# Plano de Refatoração de Segurança e Auditoria de Backend

Este plano aborda a correção definitiva de problemas de segurança identificados no backend modularizado, focando em autorização, proteção de dados sensíveis e robustez das funções de IA.

## 1. Autorização e Contexto de Sessão (Server Functions)

### Ações
- Refatorar `ai-assistant.functions.ts` para garantir que todas as funções utilizem `zod` para validação e `requireSupabaseAuth` para autenticação.
- Adicionar verificações de permissão (`assertTeacherOrAdmin`) em todos os endpoints de geração de IA que não a possuíam ou que usavam validações genéricas.
- Implementar proteção nas funções de listagem e deleção para garantir que um usuário só acesse suas próprias gerações ou gerações da disciplina onde tem autoridade.

## 2. Prevenção de Vazamento de Dados Sensíveis (Data Masking)

### Ações
- **Módulo de Exercícios**: Revisar `getStudentExerciseSubmission` para ocultar `correct_answer` e `explanation` até que a submissão seja liberada (`released_at`) ou que o professor decida mostrar o feedback.
- **Módulo de Frequência**: Garantir que o `code` de 6 letras da chamada não seja retornado em listagens acessíveis por alunos.
- **Módulo de Avaliações**: Revisar `grader.functions.ts` para que gabaritos e critérios de correção IA não vazem em respostas de API destinadas a alunos.

## 3. Validação de Entrada e Tratamento de Erros (IA Generators)

### Ações
- Atualizar `src/backend/generators/*.server.ts` para incluir validação de schema rigorosa nos parâmetros de entrada antes de chamar a API de IA.
- Implementar blocos `try/catch` robustos em torno de chamadas de IA e parsing de JSON (`callAIJson`), com fallbacks que retornam mensagens de erro amigáveis ou estruturas vazias seguras, evitando crashes do servidor.
- Sanitizar saídas da IA para remover possíveis injeções de markdown ou scripts indesejados.

## Detalhes Técnicos
- **Segurança RLS**: As funções continuarão usando `supabaseAdmin` onde necessário para lógica de sistema, mas com validação de permissão em nível de aplicação via `assertTeacherOrAdmin`.
- **Zod**: Substituir validações `(input: any) => input` por schemas Zod detalhados em todos os `createServerFn`.
- **Build**: Garantir que a modularização se mantenha intacta para evitar erros de memória (OOM) no Nitro.

## Arquivos Afetados
- `src/backend/ai-assistant.functions.ts`
- `src/backend/generators/*.server.ts`
- `src/backend/exercises.functions.ts`
- `src/backend/attendance.functions.ts`
- `src/backend/grader.functions.ts`
