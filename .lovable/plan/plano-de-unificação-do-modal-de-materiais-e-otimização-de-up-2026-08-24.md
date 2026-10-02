# Plano de Unificação do Modal de Materiais e Otimização de Upload

O objetivo é simplificar a criação de materiais didáticos, unificando o upload de arquivos externos no modal principal de materiais e corrigindo problemas de timeout ao processar arquivos pesados.

## Alterações de UI/UX
- **Remoção de botões duplicados**: No cabeçalho da listagem de materiais, o botão "Enviar Arquivo Externo" será removido, mantendo apenas o botão "+ Material".
- **Unificação do Modal**: O modal de "+ Material" será atualizado para incluir:
    - Campo de Categoria/Seção: Select com opções 'Apostilas', 'Material Complementar', 'Artigos', 'Exercícios', 'Slides'.
    - Campo de Anexo: Suporte para upload de PDF, DOCX e PPTX diretamente para o storage.
- **Fluxo de Upload**: O upload do binário será realizado primeiro no Supabase Storage e, somente após o sucesso, a referência será salva no banco de dados.

## Alterações Técnicas
- **Refatoração do `MaterialsModule`**: Remoção do `ExternalMaterialUploadDialog` e simplificação do cabeçalho.
- **Refatoração do `MaterialEditorDialog`**: 
    - Adição de suporte a arquivos (PDF, DOCX, PPTX).
    - Implementação de lógica de upload em duas etapas (Storage primeiro, depois DB).
    - Inclusão do seletor de categorias.
- **Segurança e Performance**:
    - Garantia de que arquivos binários não sejam passados via Base64 em queries SQL (prevenindo timeouts).
    - Uso das funções de backend existentes (`uploadMaterialFile` e `saveMaterial`) de forma orquestrada no frontend.

## Detalhes de Implementação
1. Editar `src/components/discipline/MaterialsModule.tsx` para remover o botão duplicado e o diálogo de upload externo.
2. Atualizar o componente `MaterialEditorDialog` (que está no mesmo arquivo ou arquivo separado, a verificar) para suportar os novos campos e o fluxo de upload.
3. Ajustar `src/backend/materials.functions.ts` para aceitar a nova estrutura de metadados se necessário.
4. Validar o fluxo completo com arquivos de diferentes tamanhos (até 50MB).
