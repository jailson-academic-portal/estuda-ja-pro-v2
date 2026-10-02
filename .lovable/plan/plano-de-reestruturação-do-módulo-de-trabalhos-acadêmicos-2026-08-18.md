# Plano de Reestruturação do Módulo de Trabalhos Acadêmicos

Unificação e independência das ferramentas de trabalhos acadêmicos em um novo módulo principal, com melhorias no banco de dados e gestão de grupos.

## Mudanças no Banco de Dados (Supabase)

1.  **Atualizar Tabela `academic_works`**:
    *   Garantir colunas: `id`, `title`, `instructions`, `due_at`, `late_penalty_per_day`, `created_by` (Professor_ID), `discipline_id`.
    *   *(Nota: Colunas como `late_penalty_per_day` já existem no schema atual, usaremos as existentes para preservar compatibilidade).*
2.  **Atualizar Tabela `academic_work_submissions`**:
    *   Garantir colunas: `id`, `work_id`, `student_id`, `group_id`, `ai_feedback_draft` (Conteudo_Texto), `status`.
    *   *(Nota: Usaremos `ai_feedback_draft` ou similar para o conteúdo de texto da entrega).*
3.  **Segurança RLS**:
    *   Políticas para Alunos: Ver apenas suas submissões e as de seus grupos.
    *   Políticas para Professores: Ver todos os trabalhos e submissões de suas disciplinas.
4.  **Realtime**:
    *   Habilitar realtime para `academic_works` para notificações de novos trabalhos.

## Mudanças na Interface (Frontend)

1.  **Módulo Principal**:
    *   Remover o botão de "Trabalhos Acadêmicos" de dentro de `ActivitiesModule.tsx`.
    *   Garantir que `WorksModule.tsx` seja um módulo independente no `ModuleGrid.tsx`.
2.  **Painel do Professor (`WorksModule.tsx` / `ActivityWorkCreatorDialog.tsx`)**:
    *   Integrar botão "Sugerir Temas com IA" (usando funções de `ai-assistant.functions.ts`).
    *   Configuração de prazos e descontos por atraso.
    *   Botão "Aprovar e Enviar para Turma" (publicação).
3.  **Gestão de Grupos (Visão do Aluno)**:
    *   Antes de iniciar o trabalho em `WorksModule.tsx`, apresentar modal com opções: "Fazer Individual" ou "Criar Grupo".
    *   Se "Criar Grupo", permitir seleção de colegas matriculados (usando `getGroupContext`).

## Detalhes Técnicos

*   Migração de dados: Os registros atuais em `academic_works` serão preservados.
*   Novas submissões em grupo usarão a tabela `activity_groups` já existente, vinculando à submissão.
*   Notificações via toast serão acionadas pelo listener do Supabase Realtime no componente root ou no dashboard.
