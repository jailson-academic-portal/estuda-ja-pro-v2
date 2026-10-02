# Plano: unificar a correção do SimulSaúde com Estudo de Caso

## Resultado esperado
- O professor corrigirá casos do SimulSaúde na mesma tela validada de Estudo de Caso, com as etapas 1. IA, 2. Rubrica, 3. Feedback, 4. Nota e 5. Revisão.
- A tela manterá os cálculos visuais da rubrica, edição manual, seleção do diário e ações de PDF existentes no componente original.
- O aluno continuará limitado a um envio por caso; o professor poderá liberar um novo envio pela mesma ação “Permitir Reenvio”.

## Implementação
- Tornar o componente de correção de Estudo de Caso reutilizável por uma fonte de submissão clínica, sem duplicar JSX ou criar estilos.
- Criar um adaptador no SimulSaúde que converta caso, resposta, aluno, rubrica, feedback, nota e status para os dados esperados pelo componente compartilhado.
- Conectar as ações compartilhadas às operações já existentes do SimulSaúde para sugerir com IA, salvar/publicar a correção no diário e permitir reenvio.
- Remover do SimulSaúde somente o modal de correção duplicado, preservando cards, consultas, criação de casos e visão do aluno.

## Validação
- Conferir as cinco etapas, cálculos da rubrica e botões de PDF na visão do professor.
- Confirmar que valores editados pelo professor são os publicados.
- Confirmar bloqueio do segundo envio e o desbloqueio após “Permitir Reenvio”.
- Validar em desktop e celular, além da compilação automática.
