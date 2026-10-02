## Plano de Modernização da Grade de Frequência

Este plano descreve as melhorias visuais e de interação na aba "Frequência (Grade)" do Diário Digital, mantendo a integridade da lógica de dados existente.

### 1. Ordenação das Datas
- Ajustar o componente `AttendanceGrid.tsx` para garantir que as colunas de datas no cabeçalho sigam uma ordem cronológica crescente (da mais antiga para a mais recente).
- A lógica atual já usa `sort`, mas verificaremos a consistência com os dados do Supabase.

### 2. Edição de Data no Cabeçalho
- Adicionar um ícone de `Pencil` (lápis) ao lado de cada data no cabeçalho da tabela.
- Implementar a funcionalidade para que, ao clicar no ícone, o diálogo de edição da chamada correspondente seja aberto (integrando com o `AttendanceModule.tsx`).

### 3. Melhoria Visual das Presenças
- Alterar a cor do badge 'P' (Presente) para verde (`bg-green-600`) tanto na legenda quanto nas células da tabela.
- Manter o padrão visual de badges consistente com o sistema de cores atual.

### 4. Troca Rápida de Status (Popover/Dropdown)
- Tornar os badges de status clicáveis.
- Implementar um `DropdownMenu` ou `Popover` que exiba as 4 opções de status (Presente, Falta, Justificada, Sem Aula).
- Ao selecionar uma opção, disparar a função `handleCycle` (ou similar) para atualizar o banco de dados e a UI imediatamente.

### 5. Ajuste de Nomenclatura (SD -> SA)
- Alterar todos os rótulos de interface que exibem "SD" para "SA" (Sem Aula).
- O valor interno no banco de dados (`no_class`) permanecerá inalterado para manter a compatibilidade com a lógica do servidor.

### Detalhes Técnicos
- Arquivos afetados: `src/components/discipline/AttendanceGrid.tsx`, `src/components/discipline/AttendanceModule.tsx`.
- Componentes de UI: `DropdownMenu`, `Popover`, `Badge`, `Button`, `Pencil`.
- Lógica de salvamento: Manter uso de `cycleAttendanceStatus` e `updateAttendanceSession`.