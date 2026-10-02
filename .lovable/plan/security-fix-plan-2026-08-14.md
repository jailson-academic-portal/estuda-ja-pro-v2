# Security Fix Plan

This plan addresses several high-priority security findings, including open endpoints, RLS bypasses, and privilege escalation vulnerabilities.

## User-facing changes
- Improved security for student imports and institution branding.
- Stricter access control for grades and enrollment records.
- Enhanced data privacy for lab configurations and simulations.
- No visible UI changes, but the system is now more robust against unauthorized access.

## Technical Details

### 1. Fix Open Endpoints (`src/backend/institution-admin.functions.ts`)
- Add `.middleware([requireSupabaseAuth])` to `importStudentsCSV`.
- Add server-side check to verify the caller is an admin or the teacher of the class/discipline.
- Add `.middleware([requireSupabaseAuth])` to `updateInstitutionBranding`.
- Verify the caller is an admin or the institution owner.

### 2. Tighten Database RLS (SQL Migration)
- **`discipline_students`**: Restrict the `discipline_students_all` policy (or replace it) to only allow:
  - Admins to manage all.
  - The discipline's teacher to manage their own students.
  - Students to view their own enrollments.
- **`grade_entries`**: Tighten the "Teachers manage grades" policy to ensure teachers can only manage grades for disciplines they actually teach.
- **`invitations`**: Scope `invitations_manage` to the user's institution ID for 'gestor' roles.
- **`discipline_lab_config`** & **`discipline_lab_simulations`**: Fix join condition bugs (self-referential column comparison) in student visibility policies.

### 3. Verification
- Verify build success.
- Use Playwright to test that unauthenticated calls to protected server functions return 401.
- Verify that teachers cannot read/write grades for disciplines they do not own via database queries.

## Security Memory
- Update @security-memory to reflect that these endpoints are now protected and RLS policies have been hardened.
