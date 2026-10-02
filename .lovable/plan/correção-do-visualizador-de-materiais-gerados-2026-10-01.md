# Correção do visualizador de materiais gerados

## Objetivo
Restaurar o modal compartilhado que exibe os resultados dos criadores, mantendo intactas as abas Chat/Criadores, os formulários, os dados e toda a lógica do backend.

## Alterações
- Normalizar o conteúdo retornado antes da exibição, incluindo sequências literais `\\n`, JSON e Markdown.
- Renderizar títulos, parágrafos, listas, tabelas e demais formatações com o renderizador seguro já existente no Assistente de IA.
- Restaurar o modo de edição dentro do visualizador, salvando pelo fluxo já existente.
- Restaurar o rodapé com **Editar**, **Enviar/Publicar para o aluno**, **Baixar em PDF** e, somente para slides, **Baixar em PPTX**.
- Reutilizar os diálogos e funções já existentes para publicação e downloads, sem criar lógica paralela.
- Aplicar o mesmo visualizador a Plano de Aula, Apostila, Slides, Estudos de Caso, Ementas e demais resultados que usam esse modal.

## Validação
- Abrir materiais reais de tipos diferentes e confirmar que não aparecem `\\n` nem JSON bruto.
- Testar edição e cancelamento sem perder conteúdo.
- Confirmar o rodapé e os formatos corretos por tipo de material.
- Exercitar ao menos um download e a abertura do envio ao aluno.
- Verificar o resultado em desktop e celular, além dos erros da prévia.

## Limites
- Nenhuma alteração no backend, banco de dados, prompts, abas globais ou formulários dos criadores.
