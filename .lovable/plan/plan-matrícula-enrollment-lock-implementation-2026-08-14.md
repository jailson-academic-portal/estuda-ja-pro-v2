# Plan: Matrícula Enrollment Lock Implementation

Implement a mandatory enrollment check for student authentication (Login and Signup) to prevent unauthorized account creation.

## Proposed Changes

### 1. Security Logic in Server Functions
- Create `src/backend/enrollment-validation.functions.ts` to host the verification logic.
- Implement `validateEnrollment` server function:
    - Queries `authorized_students` table using `supabaseAdmin`.
    - Returns boolean status and associated metadata (name, institution).
    - Ensures the check happens on the server to prevent RLS/client-side bypass.

### 2. Update Student Login flow
- Modify `src/routes/login.tsx`:
    - In `MatriculaForm.onSubmit`, call `validateEnrollment` before proceeding.
    - If the matrícula is not found:
        - Abort the login/signup process.
        - Display a clear error toast: "Acesso negado. Sua matrícula não foi encontrada. Por favor, procure seu professor para liberar o seu acesso."
    - Remove the automatic `signUp` fallback for unknown matrículas.

### 3. Update Student Signup flow
- Modify `src/routes/signup.tsx`:
    - Ensure `verifyMatricula` uses the new `validateEnrollment` server function.
    - Enforce strict blocking if the student is not in the `authorized_students` list.
    - Maintain the requirement that students must have a pre-provisioned entry to register.

### 4. Edge Function Hardening (Optional/Cleanup)
- The `matricula-login` edge function will remain as a helper for deterministic password resolution but will be secondary to the primary enrollment check in the UI routes.

## Technical Details
- **Tables**: `authorized_students` (Source of truth for allowed matrículas).
- **Security**: Server-side validation via `createServerFn` and `supabaseAdmin` ensures students cannot spoof enrollment checks.
- **Feedback**: Immediate UI feedback via `sonner` toasts.

## User Interface
- No major layout changes.
- New error state for the "Acesso negado" message.
