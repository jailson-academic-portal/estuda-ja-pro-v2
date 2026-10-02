# Plano de Correção: Sincronização de Alunos e Limpeza de Duplicidades

A funcionalidade de sincronização será corrigida para garantir que alunos existentes na disciplina, mas sem registro global ou acesso, sejam oficializados corretamente sem duplicar vínculos na disciplina. Além disso, será implementada uma rotina de limpeza automática de duplicidades.

## Alterações

### 1. Backend (`src/backend/students.functions.ts`)
- **Corrigir `syncDisciplineStudents`**:
    - Remover qualquer lógica que pudesse inserir novos registros em `discipline_students`.
    - Focar exclusivamente na criação do usuário no Supabase Auth e no perfil correspondente em `profiles` (usando o mesmo ID).
    - Garantir que o registro seja inserido em `authorized_students` (Cadastro Geral).
- **Nova função `cleanupDisciplineDuplicates`**:
    - Implementar uma função de servidor para identificar e remover vínculos duplicados (mesmo aluno/matrícula na mesma disciplina).
    - Manter apenas um registro por par (disciplina, aluno).

### 2. Frontend (`src/components/discipline/StudentsModule.tsx`)
- **Limpeza Automática**:
    - Chamar a nova função `cleanupDisciplineDuplicates` no `useEffect` de carregamento do módulo.
    - Isso garante que qualquer sujeira de banco de dados seja limpa assim que o professor abrir a aba de alunos.
- **Feedback Visual**:
    - Manter o botão "Sincronizar Turma" com a descrição correta de sua finalidade.

## Detalhes Técnicos
- O vínculo na disciplina é armazenado na tabela `discipline_students`.
- O Cadastro Geral é representado pelas tabelas `profiles` (perfil público) e `authorized_students` (matrículas permitidas).
- A autenticação é gerenciada via `admin.createUser` do Supabase para manter o ID consistente entre Auth e Profile.
