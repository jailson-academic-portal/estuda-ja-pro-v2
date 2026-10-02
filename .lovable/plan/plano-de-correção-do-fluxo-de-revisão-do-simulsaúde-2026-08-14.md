# Plano de Correção do Fluxo de Revisão do SimulSaúde

O objetivo é corrigir o bug onde o professor, ao tentar revisar uma submissão, não visualiza o diálogo de feedback e recebe uma mensagem de erro ou vê a tela estática, impedindo o ajuste da nota antes da publicação no diário.

## Problemas Identificados
1.  **Falta de Dialog de Revisão**: A função `publishGrade` executa a correção da IA e publica diretamente no diário sem abrir uma interface de conferência para o professor.
2.  **Estado Global vs Local**: O professor não consegue ver o feedback detalhado da IA para decidir se a nota está correta (o feedback fica escondido em um badge pequeno na tabela).
3.  **Nota Fixa de 9.5**: A lógica atual dispara a IA apenas se a nota for nula ou exatamente 9.5, o que pode causar comportamentos inesperados se o professor quiser re-analisar.

## Alterações Técnicas

### 1. Componente Frontend (`src/components/discipline/SimulSaudeModule.tsx`)
- Adicionar um novo estado `reviewModal` para controlar a abertura de um diálogo de revisão detalhado.
- Modificar a função `publishGrade` (renomear para `prepareReview`) para apenas buscar a avaliação da IA e abrir o modal.
- Criar um novo componente interno ou diálogo no final do arquivo: `ClinicalSubmissionReviewDialog`.
    - Exibirá: Nome do aluno, Conduta escolhida, Justificativa original.
    - Exibirá: Feedback da IA completo (Markdown).
    - Permitirá: Edição manual da nota final e do feedback/comentário pelo professor.
    - Botão "Confirmar e Publicar no Diário": Realizará o salvamento final no banco e a integração com o diário.

### 2. Backend Functions (`src/backend/simulsaude-review.functions.ts`)
- Ajustar a função `reviewClinicalSubmission` para ser idempotente e retornar o resultado sem marcar como `released` automaticamente.
- Garantir que o cálculo da nota seja retornado de forma clara para o frontend.

### 3. Melhoria de UX
- Adicionar estados de loading específicos para a geração do feedback da IA no modal.
- Mostrar alertas visuais de similaridade/plágio de forma mais proeminente no modal de revisão.

## User Experience (Não técnico)
- O professor agora verá uma tela de confirmação após clicar em "Revisar".
- Nessa tela, ele poderá ler exatamente o que a IA escreveu e ajustar a nota se achar injusta.
- A nota só irá para o Diário Digital após o professor clicar em um botão de confirmação final nessa nova tela.
