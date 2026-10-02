# Plan: Build Optimization and File Splitting

The project is currently hitting a production build error (SIGABRT/Exit -1) during the Nitro transformation phase. This is likely caused by the extreme size and complexity of `src/backend/ai-assistant.functions.ts` (approx. 3800 lines), which exhausts memory limits in the build environment. I will split this file into smaller, logical modules to reduce memory pressure and improve maintainability.

## Proposed Changes

### 1. Extract Logic into New Files
- Create `src/backend/lesson-plan.functions.ts` for lesson plan generation logic.
- Create `src/backend/apostila.functions.ts` for apostila generation logic.
- Create `src/backend/slide-creator.functions.ts` for slide generation logic.
- Create `src/backend/exercise-creator.functions.ts` for exercise and assessment generation logic.
- Create `src/backend/case-study.functions.ts` for case study generation.
- Create `src/backend/syllabus-creator.functions.ts` for activity/work syllabus generation.
- Create `src/backend/ai-assistant-core.server.ts` to hold shared internal helpers (sanitization, prompts, logic).

### 2. Refactor `ai-assistant.functions.ts`
- Convert the file into a "thin wrapper" that only exports `createServerFn` declarations.
- Move implementation logic into the new specific function files or imported modules.
- Ensure all imports and type safety are preserved.

### 3. Verify Build
- Run a production-mode build (`bun run build`) to ensure the SIGABRT error is resolved and all routes are correctly generated.

## Technical Details
- **Code Splitting**: Moving logic from one massive file to multiple smaller files reduces the abstract syntax tree (AST) complexity the build tool has to process at once.
- **TanStack Start Compliance**: Every file declaring `createServerFn` will become a thin wrapper, adhering to project guidelines.
- **Dependency Graph**: Careful mapping of imports to avoid circular dependencies during the split.
