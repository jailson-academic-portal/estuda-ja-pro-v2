---
name: Security Scan Fixes
description: Documentation of resolved security findings from the 2026-08-04 scan.
type: feature
---
# Security Findings Resolution (2026-08-04)

Load the security issues from the scan results and fix the selected issues.

## Resolved Issues

- **grade_entries_no_owner_delete_update_restriction_check**: Restricted grade modifications in `public.grade_entries` to the discipline's teacher or platform admins.
- **profiles_institution_role_no_select_policy**: Restricted SELECT access on `public.profiles` to ensure users can only view their own profile, unless they are an admin or a manager of the same institution.
- **subscriptions_no_owner_read_policy**: Enforced RLS on `public.subscriptions` so users can only view their own subscription records.
- **idor_content_hijack**: Reinforced RLS on `public.materials` and `public.exercises` to ensure only the creator can modify their content.
- **ssrf_submission_extract**: Secured submission extraction functions by hardening the `search_path` to `public` to prevent environment variable leakage or path hijacking.
- **matricula_login_takeover**: Enforced a UNIQUE constraint on the `matricula` column in the `profiles` table to prevent identity collision and account takeover.

## Implementation Details
- **Migration**: `supabase/migrations/20260804230000_security_scan_fixes.sql`
- **Auth Model**: Used the `has_role` security definer function for role-based policy logic.
- **Hardening**: Set `search_path = public` on all security-critical database functions.
