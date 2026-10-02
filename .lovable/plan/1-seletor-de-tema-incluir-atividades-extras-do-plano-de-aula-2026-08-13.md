## 1. Seletor de tema — incluir "Atividades Extras" do plano de aula

No `ActivityWorkCreatorDialog.tsx`, além dos temas de Estudos de Caso / Trabalhos Acadêmicos, extrair também do plano de aula a seção **Atividades Extras** (Seminários, Debates, Visitas Técnicas, Estudos de caso, Aulas práticas, Workshops) e agrupá-los no dropdown de tema:

- Grupo "Trabalhos acadêmicos sugeridos" (mantém).
- Grupo **novo** "Atividades extras sugeridas" com os itens do plano.
- Opção "Digitar outro tema" (mantém).

Parser: identifica o bloco "Atividades Extras" / "Atividades extras" no markdown do plano e captura cada bullet como um item de tema. Nada muda no fluxo de geração — o tema escolhido continua entrando no prompt como hoje.

## 2. Catálogo customizável (Admin) por professor

**Objetivo:** permitir que o Admin adicione novos itens ao catálogo global (tipos de atividade extra, tipos de trabalho acadêmico, tipos de questão, temas de pesquisa) e libere cada item para **professores específicos**, sem afetar os demais.

### Modelo de dados (uma migração)

Tabela `catalog_items`:
- `kind`: enum (`activity_subtype`, `work_subtype`, `question_type`, `research_theme`)
- `code` (slug estável), `label`, `description`, `prompt_hint` (texto opcional injetado no prompt de IA quando esse item é usado)
- `is_active`, `created_by` (admin), timestamps

Tabela `catalog_item_grants`:
- `catalog_item_id` → `catalog_items.id`
- `teacher_id` → `profiles.id`
- unique `(catalog_item_id, teacher_id)`

RLS: apenas Admin pode inserir/editar/excluir; professores leem só os itens ativos que estejam liberados para eles (via `catalog_item_grants`). GRANTs + RLS na mesma migração.

### Backend (server functions)

Novo `src/backend/catalog.functions.ts`:
- `adminListCatalogItems({ kind? })` — Admin lista tudo.
- `adminUpsertCatalogItem(...)` / `adminDeleteCatalogItem(id)`.
- `adminListTeachers()` (ou reaproveitar existente) + `adminSetItemGrants({ item_id, teacher_ids })`.
- `listCatalogItemsForTeacher({ kind })` — usado nos criadores, retorna só itens liberados para `context.userId`.

Nos criadores existentes (Atividade/Trabalho, Exercícios, Avaliações), mesclar os itens do catálogo aos enums fixos atuais. Quando um item de catálogo tiver `prompt_hint`, esse texto é anexado ao prompt do respectivo criador de IA.

### UI Admin

Nova aba "Catálogo" em `src/routes/index.tsx` do painel Admin (ou nova rota `/admin/catalog`), com sub-abas por `kind`. Cada linha permite editar rótulo/descrição/prompt_hint e abrir um dialog "Liberar para professores" com lista de professores marcáveis.

## 3. Criador de Exercícios — igualar ao Criador de Avaliações

Em `AIAssistantModule.tsx` (bloco do Criador de Exercícios) e em `src/backend/exercises.functions.ts`:

- **Padrões de Qualidade**: iniciar com **todas** as opções marcadas por padrão (Evitar repetição, Clareza e precisão, Distratores plausíveis, Contexto específico, Estrutura V/F, Estrutura Lacunas).
- **Dificuldade por Tipo de Questão**: remover o modo atual (um select por tipo) e trocar pelo mesmo componente usado no Criador de Avaliações — **Distribuição por Tipo de Questão** com contagem numérica por tipo (Múltipla Escolha, Discursiva, V/F em bloco de 5, Completar Lacunas em bloco de 5, Aplicação de Conceitos, Comparação e Contraste, Cálculo, Associação em bloco de 5) e "Formato da resposta" (Gabarito Direto) onde couber, com contador "Soma atual: X / Y".
- Backend do exercício passa a aceitar o mesmo shape de distribuição das avaliações; parser da IA reaproveita o pipeline já existente.

## Detalhes técnicos

- Migração: `catalog_items` + `catalog_item_grants` com GRANTs (`authenticated`, `service_role`), RLS e políticas via `has_role(auth.uid(),'admin')` para escrita, e leitura de itens ativos filtrada pelos grants do usuário.
- `has_role` já existe no projeto — reaproveitar.
- Nenhum enum do Postgres é alterado (evita migração destrutiva); catálogo é totalmente por linha.
- Ordem de entrega: (1) migração, (2) backend + telas Admin, (3) integração nos criadores, (4) ajustes do Criador de Exercícios (independente, pode ir em paralelo).

## Pergunta antes de executar

Confirma que os itens do catálogo do Admin ficam **globais mas com liberação individual por professor** (ou seja, um item criado pelo Admin só aparece para os professores marcados)? Se preferir liberação por instituição inteira em vez de por professor, ajusto a tabela de grants.
