# Plan: Standardize "Generate Assessment" Handbook Selection

The goal is to ensure the handbook selection dropdown in the Assessment Wizard ONLY shows valid handbooks (apostilas) and provides clear feedback when none are found.

## Proposed Changes

### Backend Logic
- **`src/backend/assessments.functions.ts`**
  - Update `listAssessmentApostilas` to explicitly filter for items where `tool = 'apostila'`.
  - Add secondary title-based filtering to ensure legacy items named "Slides", "Exercícios", etc., are excluded even if their tool type is ambiguous.

### Frontend Component
- **`src/components/discipline/AssessmentsModule.tsx`**
  - Refine the render logic for the `apostilaId` selector.
  - Implement a final client-side filter to catch any edge cases (e.g., items with "Plano de Aula" in title).
  - Add an empty state message: "Nenhuma apostila encontrada para esta disciplina" when the list is empty.

## Technical Details
- Filter criteria: `tipo === 'apostila'` and title does not contain restricted keywords.
- Restricted keywords: "Slides", "Exercícios", "Estudo de Caso", "Ementa", "Plano de Aula".
- The dropdown will use `SelectItem` from shadcn/ui or standard `<option>` as appropriate for the existing implementation.
