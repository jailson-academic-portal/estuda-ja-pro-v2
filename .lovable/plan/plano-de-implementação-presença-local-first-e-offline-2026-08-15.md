# Plano de Implementação: Presença Local-First e Offline

Este plano descreve as alterações necessárias para permitir que o módulo de presença funcione sem conexão com a internet, utilizando cache local e uma fila de sincronização automática.

## Alterações de Infraestrutura (Offline Queue)

- **Aprimorar `src/lib/offline-attendance-queue.ts`**:
    - Adicionar suporte para cache de dados mestre (alunos e sessões).
    - Implementar funções `cacheStudents` e `cacheSessions`.
    - Garantir que a fila de sincronização suporte tentativas persistentes com logs adequados.

## Alterações no Módulo de Presença (`AttendanceModule.tsx`)

- **Persistência de Dados**:
    - Ao carregar dados (`load`), salvar no `localStorage` via `offline-attendance-queue` para uso posterior em modo offline.
    - Se a carga via Supabase falhar por erro de rede, tentar ler do cache local.
- **Remoção de Bloqueios**:
    - Garantir que botões de ação (marcar presença, justificar) não fiquem desabilitados apenas por falta de rede.
- **Fluxo de Ação Offline**:
    - Interceptar chamadas de `confirmAttendance`, `markPresenceBySession` e `submitJustification`.
    - Se `!isOnline()`, enfileirar a ação e mostrar um feedback visual de "Salvo localmente (será enviado ao voltar online)".

## Alterações no Diário de Presença (`AttendanceGrid.tsx`)

- **Cache de Alunos**:
    - Salvar a lista de alunos da disciplina localmente.
- **Edição Offline**:
    - Permitir que o professor altere o status de presença mesmo offline.
    - Salvar essas alterações em uma nova estrutura de fila `OfflineStatusChangeItem`.
    - Sincronizar essas alterações quando a conexão retornar.

## Sincronização e Feedback

- **Sincronização Automática**:
    - O hook `useOfflineAttendance` já possui o listener de `online`, mas vamos garantir que ele cubra todos os novos tipos de itens.
- **Indicador Visual**:
    - Exibir claramente quando há dados pendentes de sincronização no cabeçalho do módulo.

## Detalhes Técnicos

- **Storage**: `localStorage` (como já iniciado no projeto).
- **Detecção Online**: `navigator.onLine` e evento `online` do window.
- **Sincronização**: Iteração sobre a fila e chamada sequencial das `server functions`.
