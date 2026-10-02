# Plano de Sincronização de Alunos "Fantasmas"

Este plano detalha a implementação da funcionalidade de "Sincronizar Turma" para oficializar alunos antigos no sistema global, garantindo que eles tenham acesso ao Auth e registros no Cadastro Geral sem perder seu histórico de notas e presenças.

## Alterações Técnicas

### Backend (Server Functions)
- Criar a função `syncDisciplineStudents` em `src/backend/students.functions.ts`.
- Esta função irá:
    1. Validar as permissões do professor/admin.
    2. Buscar todos os alunos vinculados à disciplina na tabela `discipline_students`.
    3. Para cada aluno, verificar se ele existe na tabela `profiles` e se possui um usuário no `Auth`.
    4. Se o aluno estiver em um estado "fantasma" (por exemplo, ID existe mas perfil está incompleto ou sem Auth):
        - Criar o usuário no Supabase Auth usando a matrícula como senha inicial (ou a lógica de padronização existente).
        - Atualizar/Criar o registro na tabela `profiles`.
        - Sincronizar com a tabela `authorized_students`.
    5. Retornar um resumo da operação (quantos foram sincronizados, erros, etc.).

### Frontend (Componentes)
- Modificar `src/components/discipline/StudentsModule.tsx`:
    - Adicionar um novo botão "Sincronizar Turma" ao lado do botão "Adicionar aluno".
    - Implementar a lógica de clique que invoca `syncDisciplineStudents`.
    - Exibir um feedback visual (toast) com o resultado da sincronização.
    - Adicionar um diálogo de confirmação para explicar o que a ação faz.

## Regras de Segurança e Integridade
- **Preservação de ID**: O ID do aluno (`student_id` em `discipline_students`) não será alterado.
- **Não Duplicação**: A verificação será feita pela matrícula para evitar a criação de múltiplos perfis para o mesmo aluno.
- **RLS**: A função utilizará o `supabaseAdmin` internamente para realizar as operações de Auth, mas será protegida por verificação de propriedade da disciplina.

## UX
- O botão terá um ícone de atualização (`RefreshCw` ou similar).
- O texto do botão será "Sincronizar Turma".
- Um toast informará: "Sincronização concluída: X alunos oficializados".
