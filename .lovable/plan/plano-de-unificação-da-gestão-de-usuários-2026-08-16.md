# Plano de Unificação da Gestão de Usuários

Este plano detalha a migração de dados da tabela `authorized_students` para a tabela `profiles`, a unificação das interfaces administrativas em uma única visão central e a limpeza de redundâncias no código.

## Ações imediatas

### 1. Migração de Dados (Backend)
- Criar a função `adminMigrateAuthorizedStudents` em `src/backend/users.functions.ts`.
- Esta função deve:
    1. Buscar todos os registros em `authorized_students`.
    2. Para cada registro, verificar se já existe um perfil em `profiles` com aquela matrícula.
    3. Se não existir, criar o usuário no **Supabase Auth** (usando o e-mail sintético baseado na matrícula) e o perfil em `profiles` com status 'active'.
    4. Sincronizar os dados de instituição se disponíveis.

### 2. Unificação da Interface (Frontend)
- **Dashboard do Administrador** (`src/components/dashboards/AdminDashboard.tsx`):
    - Renomear o título da seção para "Gestão de Alunos".
    - Remover a aba "Matrículas Autorizadas".
    - Manter apenas a aba "Todos os Usuários" (renomeada internamente ou apenas simplificada).
- **Dashboard da Instituição** (`src/components/dashboards/InstitutionDashboard.tsx`):
    - Remover a aba de Matrículas Autorizadas.
- **UsersTab** (`src/components/admin/UsersTab.tsx`):
    - Adicionar um botão discreto de "Sincronizar Matrículas Legadas" que dispara a rotina de migração (uma única vez).
    - Garantir que a coluna de Status esteja visível e reflita os valores 'active', 'inactive', 'pending'.

### 3. Ajustes no Fluxo de Importação e Login
- **Importação de Alunos** (`src/backend/students-import.functions.ts`):
    - Garantir que qualquer importação salve o aluno diretamente em `profiles` e `auth` com status 'active'.
    - Remover qualquer lógica que inseria dados em `authorized_students`.
- **Validação de Matrícula** (`src/backend/enrollment-validation.functions.ts`):
    - Alterar para buscar a validade da matrícula diretamente na tabela `profiles`.
- **Login** (`src/routes/login.tsx`):
    - Ajustar as mensagens de erro e a verificação de existência de perfil para focar apenas na tabela unificada.

### 4. Limpeza e Consolidação
- Remover o arquivo `src/backend/authorized-students.functions.ts`.
- Remover o componente `src/components/admin/AuthorizedStudentsTab.tsx`.
- (Opcional/Segurança) Adicionar uma instrução de memória para que novas tabelas de "allowlist" não sejam criadas, mantendo a arquitetura de "Single Source of Truth" em `profiles`.

## Detalhes técnicos
- As senhas padrão para alunos migrados/importados continuarão sendo baseadas na matrícula (mínimo 6 caracteres).
- O status 'pending' será reservado apenas para auto-cadastro (se aplicável), enquanto importações manuais/via CSV definem 'active' imediatamente.
